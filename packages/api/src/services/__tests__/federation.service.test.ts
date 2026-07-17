/**
 * Federation Service — resolveAndUpsert fast + eventually-fresh tests.
 *
 * Covers the Bluesky-style refresh contract:
 *  - A FRESH cached federated user is returned immediately with NO remote
 *    WebFinger / actor fetch / avatar download (never blocks the caller).
 *  - A STALE cached user is still returned immediately, but schedules a
 *    background refresh that re-fetches the actor, downloads the avatar, writes
 *    the new file id to the user, and invalidates the user cache.
 *  - The background refresh is throttled (storm guard): a second resolve within
 *    the min-interval does not launch another refresh.
 *  - A failing background refresh never throws out of resolveAndUpsert.
 *
 * The storm guard uses module-level state keyed by actor URI, which persists
 * across tests in this file. Each test therefore uses a UNIQUE handle/actor so
 * the in-flight set and last-attempt map never collide between cases.
 */

const mockUserFindOne = jest.fn();
const mockUserFindById = jest.fn();
const mockUserUpdateOne = jest.fn();
const mockUserFindOneAndUpdate = jest.fn();
const mockCacheInvalidate = jest.fn();
const mockAssetFileContentExists = jest.fn();
const mockAssetUploadFileDirect = jest.fn();
const mockAssetDeleteFile = jest.fn();

process.env.AWS_ACCESS_KEY_ID ||= 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test-secret-key';
process.env.AWS_S3_BUCKET ||= 'test-bucket';

// federation.service registers a Mongoose model (FederationKeyPair) at import
// time. Stub mongoose so that registration is a no-op and `mongoose.models`
// exists — we never touch the key-pair collection in these tests.
jest.mock('mongoose', () => {
  class Schema {}
  return {
    __esModule: true,
    default: {
      Schema,
      models: {},
      model: jest.fn(() => ({})),
    },
    Schema,
    models: {},
    model: jest.fn(() => ({})),
  };
});

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findOne: mockUserFindOne,
    findById: mockUserFindById,
    updateOne: mockUserUpdateOne,
    findOneAndUpdate: mockUserFindOneAndUpdate,
  },
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: mockCacheInvalidate },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// AssetService / S3 are reached when federated avatar storage is verified or
// repaired. Keep the mock stateful so tests can exercise both usable and
// missing local storage without touching AWS.
jest.mock('../assetService', () => ({
  __esModule: true,
  AssetService: class {
    fileContentExists(...args: unknown[]) {
      return mockAssetFileContentExists(...args);
    }

    uploadFileDirect(...args: unknown[]) {
      return mockAssetUploadFileDirect(...args);
    }

    deleteFile(...args: unknown[]) {
      return mockAssetDeleteFile(...args);
    }
  },
}));
jest.mock('../s3Service', () => ({
  __esModule: true,
  createS3Service: jest.fn(() => ({})),
}));

// All outbound federation traffic now goes through @oxyhq/core/server's
// DNS-pinned safeFetch. Mock it so tests drive the response (and assert the
// SSRF guard rejects private/non-https targets) without real network I/O.
const mockSafeFetch = jest.fn();
class FakeSsrfRejection extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SsrfRejection';
  }
}
jest.mock('@oxyhq/core/server', () => ({
  __esModule: true,
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  SsrfRejection: FakeSsrfRejection,
}));

import { Readable } from 'stream';
import { federationService } from '../federation.service';

/**
 * Build a fake SafeFetchResult whose `.response` is a real Node Readable stream
 * (what safeFetch yields), so the service's streaming/byte-cap readers run for
 * real against controlled bytes.
 */
function makeSafeFetchResult(
  status: number,
  headers: Record<string, string>,
  body: Buffer | string = Buffer.alloc(0),
): {
  status: number;
  headers: Record<string, string>;
  finalUrl: string;
  response: Readable & { destroy: () => void };
} {
  const buffer = typeof body === 'string' ? Buffer.from(body) : body;
  const stream = Readable.from([buffer]) as Readable & { destroy: () => void };
  return { status, headers, finalUrl: 'https://cdn.example/final', response: stream };
}

const DOMAIN = 'mastodon.social';
const NEW_AVATAR_URL = 'https://cdn.example/avatar-new.png';

interface CachedUser {
  _id: { toString(): string };
  type: string;
  username: string;
  avatar?: string;
  updatedAt: Date;
  accountStatus?: string;
  federation?: { actorUri?: string; domain?: string };
}

let actorCounter = 0;

interface Fixture {
  handle: string;
  actorUri: string;
  userId: string;
}

function nextFixture(): Fixture {
  actorCounter += 1;
  const local = `alice${actorCounter}`;
  return {
    handle: `${local}@${DOMAIN}`,
    actorUri: `https://${DOMAIN}/users/${local}`,
    userId: `user-${actorCounter}`,
  };
}

function mockFindOneReturning(user: CachedUser | null): void {
  const lean = jest.fn().mockResolvedValue(user);
  const select = jest.fn().mockReturnValue({ lean });
  mockUserFindOne.mockReturnValueOnce({ select });
}

function cachedUser(fx: Fixture, ageMs: number, overrides: Partial<CachedUser> = {}): CachedUser {
  return {
    _id: { toString: () => fx.userId },
    type: 'federated',
    username: fx.handle,
    avatar: 'stored-file-id',
    updatedAt: new Date(Date.now() - ageMs),
    federation: { actorUri: fx.actorUri, domain: DOMAIN },
    ...overrides,
  };
}

const FRESH_AGE_MS = 60 * 1000; // 1 minute — well under the 24h stale window
const STALE_AGE_MS = 48 * 60 * 60 * 1000; // 48h — older than STALE_MS (24h)

function mockUploadedFile(fileId: string) {
  return {
    _id: { toString: () => fileId },
  };
}

function resetAssetMocks(): void {
  mockAssetFileContentExists.mockResolvedValue(true);
  mockAssetUploadFileDirect.mockResolvedValue(mockUploadedFile('uploaded-file-id'));
  mockAssetDeleteFile.mockResolvedValue(undefined);
}

/** Let any scheduled fire-and-forget background refresh settle. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

describe('FederationService.resolveAndUpsert (fast + eventually-fresh)', () => {
  let webfingerSpy: jest.SpyInstance;
  let actorSpy: jest.SpyInstance;
  let avatarSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    resetAssetMocks();
    webfingerSpy = jest.spyOn(federationService, 'resolveWebFingerResource');
    actorSpy = jest.spyOn(federationService, 'fetchActorProfile');
    avatarSpy = jest.spyOn(federationService, 'downloadAndStoreAvatar')
      .mockResolvedValue({ fileId: 'new-file-id', notModified: false });
    mockUserUpdateOne.mockResolvedValue({ acknowledged: true });
  });

  afterEach(() => {
    webfingerSpy.mockRestore();
    actorSpy.mockRestore();
    avatarSpy.mockRestore();
  });

  it('returns a fresh cached user immediately without any remote I/O', async () => {
    const fx = nextFixture();
    webfingerSpy.mockResolvedValue({ actorUri: fx.actorUri, subjectAcct: fx.handle });
    actorSpy.mockResolvedValue(null);

    const cached = cachedUser(fx, FRESH_AGE_MS);
    mockFindOneReturning(cached);

    const result = await federationService.resolveAndUpsert(fx.handle);
    await flushMicrotasks();

    expect(result).toBe(cached);
    expect(mockAssetFileContentExists).toHaveBeenCalledWith('stored-file-id');
    expect(webfingerSpy).not.toHaveBeenCalled();
    expect(actorSpy).not.toHaveBeenCalled();
    expect(avatarSpy).not.toHaveBeenCalled();
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
    expect(mockCacheInvalidate).not.toHaveBeenCalled();
  });

  it('returns an archived cached user without scheduling background refresh', async () => {
    const fx = nextFixture();
    const cached = cachedUser(fx, STALE_AGE_MS, { accountStatus: 'archived' });
    mockFindOneReturning(cached);

    const result = await federationService.resolveAndUpsert(fx.handle);
    await flushMicrotasks();

    expect(result).toBe(cached);
    expect(webfingerSpy).not.toHaveBeenCalled();
    expect(actorSpy).not.toHaveBeenCalled();
    expect(avatarSpy).not.toHaveBeenCalled();
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
    expect(mockCacheInvalidate).not.toHaveBeenCalled();
  });

  it('returns the stale user immediately and runs a background refresh that updates avatar/name/bio + invalidates cache', async () => {
    const fx = nextFixture();
    webfingerSpy.mockResolvedValue({ actorUri: fx.actorUri, subjectAcct: fx.handle });
    actorSpy.mockResolvedValue({
      actorUri: fx.actorUri,
      domain: DOMAIN,
      username: fx.handle,
      displayName: 'Alice Updated',
      avatarUrl: NEW_AVATAR_URL,
      bio: 'fresh bio',
    });

    const cached = cachedUser(fx, STALE_AGE_MS);
    mockFindOneReturning(cached);

    const result = await federationService.resolveAndUpsert(fx.handle);
    expect(result).toBe(cached); // returned synchronously, before the refresh resolves

    await flushMicrotasks();

    expect(actorSpy).toHaveBeenCalledWith(fx.actorUri, fx.handle);
    expect(avatarSpy).toHaveBeenCalledWith(
      NEW_AVATAR_URL,
      'stored-file-id',
      {
        etag: undefined,
        lastModified: undefined,
      },
      fx.userId,
    );

    const updateArgs = mockUserUpdateOne.mock.calls[0];
    expect(updateArgs[0]).toEqual({ _id: cached._id });
    expect(updateArgs[1].$set).toMatchObject({
      'name.first': 'Alice Updated',
      bio: 'fresh bio',
      description: 'fresh bio',
      avatar: 'new-file-id',
    });
    expect(mockCacheInvalidate).toHaveBeenCalledWith(fx.userId);
  });

  it('returns a fresh cached user but refreshes in the background when its stored avatar object is missing', async () => {
    const fx = nextFixture();
    mockAssetFileContentExists.mockResolvedValue(false);
    webfingerSpy.mockResolvedValue({ actorUri: fx.actorUri, subjectAcct: fx.handle });
    actorSpy.mockResolvedValue({
      actorUri: fx.actorUri,
      domain: DOMAIN,
      username: fx.handle,
      displayName: 'Alice Repaired',
      avatarUrl: NEW_AVATAR_URL,
      bio: 'repaired bio',
    });

    const cached = cachedUser(fx, FRESH_AGE_MS);
    mockFindOneReturning(cached);

    const result = await federationService.resolveAndUpsert(fx.handle);
    expect(result).toBe(cached);

    await flushMicrotasks();

    expect(mockAssetFileContentExists).toHaveBeenCalledWith('stored-file-id');
    expect(actorSpy).toHaveBeenCalledWith(fx.actorUri, fx.handle);
    expect(avatarSpy).toHaveBeenCalledWith(
      NEW_AVATAR_URL,
      'stored-file-id',
      {
        etag: undefined,
        lastModified: undefined,
      },
      fx.userId,
    );
    expect(mockCacheInvalidate).toHaveBeenCalledWith(fx.userId);
  });

  it('throttles repeated background refreshes for the same actor (storm guard)', async () => {
    const fx = nextFixture();
    webfingerSpy.mockResolvedValue({ actorUri: fx.actorUri, subjectAcct: fx.handle });
    actorSpy.mockResolvedValue({
      actorUri: fx.actorUri,
      domain: DOMAIN,
      username: fx.handle,
      displayName: 'Alice',
      avatarUrl: NEW_AVATAR_URL,
      bio: 'bio',
    });

    mockFindOneReturning(cachedUser(fx, STALE_AGE_MS));
    await federationService.resolveAndUpsert(fx.handle);
    await flushMicrotasks();
    expect(actorSpy).toHaveBeenCalledTimes(1);

    // Second resolve within REFRESH_MIN_INTERVAL_MS must NOT launch another refresh.
    mockFindOneReturning(cachedUser(fx, STALE_AGE_MS));
    await federationService.resolveAndUpsert(fx.handle);
    await flushMicrotasks();
    expect(actorSpy).toHaveBeenCalledTimes(1);
  });

  it('does the first-time blocking fetch when no cached user exists', async () => {
    const fx = nextFixture();
    webfingerSpy.mockResolvedValue({ actorUri: fx.actorUri, subjectAcct: fx.handle });
    actorSpy.mockResolvedValue({
      actorUri: fx.actorUri,
      domain: DOMAIN,
      username: fx.handle,
      displayName: 'Alice',
      avatarUrl: NEW_AVATAR_URL,
      bio: 'bio',
    });

    mockFindOneReturning(null);
    const created = { _id: { toString: () => fx.userId }, username: fx.handle, type: 'federated' };
    const select = jest.fn().mockResolvedValue(created);
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select });

    const result = await federationService.resolveAndUpsert(fx.handle);

    expect(webfingerSpy).toHaveBeenCalledWith(fx.handle);
    expect(actorSpy).toHaveBeenCalledWith(fx.actorUri, fx.handle);
    expect(avatarSpy).toHaveBeenCalledWith(NEW_AVATAR_URL, undefined, undefined, fx.userId);
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledWith(
      { 'federation.actorUri': fx.actorUri },
      expect.objectContaining({
        $set: expect.objectContaining({
          'federation.lastResolvedAt': expect.any(Date),
        }),
        $unset: expect.objectContaining({
          'federation.unavailableAt': '',
          'federation.unavailableReason': '',
        }),
      }),
      expect.anything(),
    );
    expect(mockUserUpdateOne).toHaveBeenCalledWith(
      { _id: created._id },
      { $set: expect.objectContaining({ avatar: 'new-file-id' }) },
    );
    expect(mockCacheInvalidate).toHaveBeenCalledWith(fx.userId);
    expect(result).toBe(created);
  });

  it('keeps the canonical WebFinger handle when the actor is served from www', async () => {
    const handle = 'mosseri@threads.net';
    const actorUri = 'https://www.threads.net/ap/users/mosseri/';
    const userId = 'threads-user-1';

    webfingerSpy.mockResolvedValue({ actorUri, subjectAcct: handle });
    actorSpy.mockResolvedValue({
      actorUri,
      domain: 'threads.net',
      username: handle,
      displayName: 'Adam Mosseri',
      avatarUrl: undefined,
      bio: 'Threads profile',
    });

    mockFindOneReturning(null);
    const created = { _id: { toString: () => userId }, username: handle, type: 'federated' };
    const select = jest.fn().mockResolvedValue(created);
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select });

    const result = await federationService.resolveAndUpsert('@mosseri@threads.net');

    expect(webfingerSpy).toHaveBeenCalledWith(handle);
    expect(actorSpy).toHaveBeenCalledWith(actorUri, handle);
    expect(mockUserFindOne).toHaveBeenCalledWith({
      type: 'federated',
      'federation.domain': 'threads.net',
      username: handle,
    });
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledWith(
      { 'federation.actorUri': actorUri },
      expect.objectContaining({
        $set: expect.objectContaining({
          type: 'federated',
          username: handle,
          'federation.actorUri': actorUri,
          'federation.domain': 'threads.net',
          'federation.lastResolvedAt': expect.any(Date),
        }),
        $unset: expect.objectContaining({
          'federation.unavailableAt': '',
          'federation.unavailableReason': '',
        }),
      }),
      expect.anything(),
    );
    expect(result).toBe(created);
  });

  it('ignores a WebFinger subject that does not resolve back to the same actor', async () => {
    const requestedHandle = 'attacker@evil.example';
    const spoofedHandle = 'victim@trusted.example';
    const actorUri = 'https://evil.example/users/attacker';
    const userId = 'evil-user-spoof';

    webfingerSpy.mockImplementation(async (acct: string) => {
      if (acct === requestedHandle) {
        return { actorUri, subjectAcct: spoofedHandle };
      }
      if (acct === spoofedHandle) {
        return { actorUri: 'https://trusted.example/users/victim', subjectAcct: spoofedHandle };
      }
      return null;
    });
    actorSpy.mockResolvedValue({
      actorUri,
      domain: 'evil.example',
      username: requestedHandle,
      displayName: 'Evil Attacker',
      avatarUrl: undefined,
      bio: 'not a trusted.example user',
    });

    mockFindOneReturning(null);
    const created = { _id: { toString: () => userId }, username: requestedHandle, type: 'federated' };
    const select = jest.fn().mockResolvedValue(created);
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select });

    const result = await federationService.resolveAndUpsert(requestedHandle);

    expect(webfingerSpy).toHaveBeenCalledWith(requestedHandle);
    expect(webfingerSpy).toHaveBeenCalledWith(spoofedHandle);
    expect(actorSpy).toHaveBeenCalledWith(actorUri, requestedHandle);
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledWith(
      { 'federation.actorUri': actorUri },
      expect.objectContaining({
        $set: expect.objectContaining({
          username: requestedHandle,
          'federation.domain': 'evil.example',
        }),
      }),
      expect.anything(),
    );
    expect(result).toBe(created);
  });

  it('uses the WebFinger subject when the requested handle is a www alias', async () => {
    const requestedHandle = 'mosseri@www.threads.net';
    const canonicalHandle = 'mosseri@threads.net';
    const actorUri = 'https://www.threads.net/ap/users/mosseri/';
    const userId = 'threads-user-alias';

    webfingerSpy.mockResolvedValue({ actorUri, subjectAcct: canonicalHandle });
    actorSpy.mockResolvedValue({
      actorUri,
      domain: 'threads.net',
      username: canonicalHandle,
      displayName: 'Adam Mosseri',
      avatarUrl: undefined,
      bio: 'Threads profile',
    });

    mockFindOneReturning(null);
    const created = { _id: { toString: () => userId }, username: canonicalHandle, type: 'federated' };
    const select = jest.fn().mockResolvedValue(created);
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select });

    const result = await federationService.resolveAndUpsert(`@${requestedHandle}`);

    expect(webfingerSpy).toHaveBeenCalledWith(requestedHandle);
    expect(actorSpy).toHaveBeenCalledWith(actorUri, canonicalHandle);
    expect(mockUserFindOne).toHaveBeenCalledWith({
      type: 'federated',
      'federation.domain': 'www.threads.net',
      username: requestedHandle,
    });
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledWith(
      { 'federation.actorUri': actorUri },
      expect.objectContaining({
        $set: expect.objectContaining({
          type: 'federated',
          username: canonicalHandle,
          'federation.actorUri': actorUri,
          'federation.domain': 'threads.net',
          'federation.lastResolvedAt': expect.any(Date),
        }),
        $unset: expect.objectContaining({
          'federation.unavailableAt': '',
          'federation.unavailableReason': '',
        }),
      }),
      expect.anything(),
    );
    expect(result).toBe(created);
  });

  it('never throws out of resolveAndUpsert when the background refresh rejects', async () => {
    const fx = nextFixture();
    webfingerSpy.mockResolvedValue({ actorUri: fx.actorUri, subjectAcct: fx.handle });
    actorSpy.mockRejectedValue(new Error('remote down'));

    const cached = cachedUser(fx, STALE_AGE_MS);
    mockFindOneReturning(cached);

    await expect(federationService.resolveAndUpsert(fx.handle)).resolves.toBe(cached);
    await flushMicrotasks();

    expect(mockCacheInvalidate).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------
  // Own-domain guard: `<localpart>@oxy.so` is a NON-ENTITY. On Oxy's own apex
  // the only valid identity is the bare local handle (`nate`); the
  // domain-qualified form `@nate@oxy.so` must never resolve and must never be
  // surfaced, so it can't look like a second representation of the local user.
  // Resolution short-circuits to null BEFORE any DB lookup, WebFinger/actor
  // fetch, or upsert.
  // ----------------------------------------------------------------------

  it('returns null for an own-domain handle without any DB lookup, WebFinger, or upsert', async () => {
    // No findOne mock is primed: the guard must short-circuit before touching
    // the DB. If any DB/network work ran, these assertions would fail.
    const result = await federationService.resolveAndUpsert('nate@oxy.so');

    expect(result).toBeNull();
    expect(mockUserFindOne).not.toHaveBeenCalled();
    expect(webfingerSpy).not.toHaveBeenCalled();
    expect(actorSpy).not.toHaveBeenCalled();
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('short-circuits an own-domain handle regardless of a leading @ or letter case', async () => {
    const result = await federationService.resolveAndUpsert('@NATE@oxy.so');

    expect(result).toBeNull();
    expect(mockUserFindOne).not.toHaveBeenCalled();
    expect(webfingerSpy).not.toHaveBeenCalled();
    expect(actorSpy).not.toHaveBeenCalled();
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

/**
 * scheduleAvatarRefresh — off-request-path avatar download.
 *
 * The in-memory throttle map (_lastAvatarAttemptAt) is keyed by user id and
 * persists across tests in this process, so each test uses a UNIQUE user id to
 * avoid cross-test coalescing.
 */
describe('FederationService.scheduleAvatarRefresh (off request path)', () => {
  let avatarUserCounter = 0;

  function mockFindByIdReturning(user: unknown): void {
    const lean = jest.fn().mockResolvedValue(user);
    const select = jest.fn().mockReturnValue({ lean });
    mockUserFindById.mockReturnValueOnce({ select });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockSafeFetch.mockReset();
    resetAssetMocks();
    mockUserUpdateOne.mockResolvedValue({ acknowledged: true });
  });

  it('skips the forced re-download when lastAvatarFetchedAt is within the throttle window', async () => {
    avatarUserCounter += 1;
    const userId = `throttle-user-${avatarUserCounter}`;
    const avatarSpy = jest.spyOn(federationService, 'downloadAndStoreAvatar')
      .mockResolvedValue({ fileId: 'should-not-be-used', notModified: false });

    // Persisted authority: avatar was fetched 1 minute ago — inside the 5min window.
    mockFindByIdReturning({
      _id: { toString: () => userId },
      avatar: 'stored-file-id',
      federation: { lastAvatarFetchedAt: new Date(Date.now() - 60 * 1000) },
    });

    federationService.scheduleAvatarRefresh(
      userId,
      'https://cdn.example/avatar.png',
      'stored-file-id',
      { force: true },
    );
    await flushMicrotasks();

    // Forced refresh inside the window is a no-op: no download, no write.
    expect(avatarSpy).not.toHaveBeenCalled();
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
    expect(mockCacheInvalidate).not.toHaveBeenCalled();

    avatarSpy.mockRestore();
  });

  it('on 304 Not Modified: skips re-upload but advances lastAvatarFetchedAt and invalidates cache', async () => {
    avatarUserCounter += 1;
    const userId = `notmod-user-${avatarUserCounter}`;
    const avatarUrl = 'https://cdn.example/avatar-304.png';

    // No spy on downloadAndStoreAvatar — exercise the REAL conditional-request
    // logic against a mocked safeFetch that returns 304 for a conditional request.
    mockSafeFetch.mockImplementation((_url: string, init?: { headers?: Record<string, string> }) => {
      // The stored validators must be replayed as conditional headers.
      expect(init?.headers?.['If-None-Match']).toBe('"etag-v1"');
      expect(init?.headers?.['If-Modified-Since']).toBe('Wed, 21 Oct 2025 07:28:00 GMT');
      return Promise.resolve(makeSafeFetchResult(304, {}));
    });

    // Stale by time so a forced refresh actually runs, but with stored validators.
    mockFindByIdReturning({
      _id: { toString: () => userId },
      avatar: 'stored-file-id',
      federation: {
        lastAvatarFetchedAt: new Date(Date.now() - 10 * 60 * 1000), // 10min ago, outside window
        avatarETag: '"etag-v1"',
        avatarLastModified: 'Wed, 21 Oct 2025 07:28:00 GMT',
      },
    });

    federationService.scheduleAvatarRefresh(userId, avatarUrl, 'stored-file-id', { force: true });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);

    // 304 → no avatar field change, but lastAvatarFetchedAt advances. The $set
    // key is a literal Mongoose dot-path string (not a nested object), so we
    // check own-key presence rather than toHaveProperty (which walks dots).
    const updateArgs = mockUserUpdateOne.mock.calls[0];
    const updateSet = updateArgs[1].$set as Record<string, unknown>;
    expect(updateArgs[0]).toEqual({ _id: userId });
    expect(Object.keys(updateSet)).toContain('federation.lastAvatarFetchedAt');
    expect(Object.keys(updateSet)).not.toContain('avatar');
    expect(mockCacheInvalidate).toHaveBeenCalledWith(userId);
  });

  it('on 304 Not Modified with a missing local object: retries without validators and repairs the avatar file', async () => {
    avatarUserCounter += 1;
    const userId = `repair-user-${avatarUserCounter}`;
    const avatarUrl = 'https://cdn.example/avatar-repair.png';
    mockAssetFileContentExists.mockResolvedValue(false);
    mockAssetUploadFileDirect.mockResolvedValue(mockUploadedFile('repaired-file-id'));

    mockSafeFetch
      .mockImplementationOnce((_url: string, init?: { headers?: Record<string, string> }) => {
        expect(init?.headers?.['If-None-Match']).toBe('"etag-v1"');
        expect(init?.headers?.['If-Modified-Since']).toBe('Wed, 21 Oct 2025 07:28:00 GMT');
        return Promise.resolve(makeSafeFetchResult(304, {}));
      })
      .mockImplementationOnce((_url: string, init?: { headers?: Record<string, string> }) => {
        expect(init?.headers?.['If-None-Match']).toBeUndefined();
        expect(init?.headers?.['If-Modified-Since']).toBeUndefined();
        return Promise.resolve(
          makeSafeFetchResult(
            200,
            {
              'content-type': 'image/png',
              etag: '"etag-v2"',
              'last-modified': 'Thu, 22 Oct 2025 07:28:00 GMT',
            },
            Buffer.from('png-bytes'),
          ),
        );
      });

    mockFindByIdReturning({
      _id: { toString: () => userId },
      avatar: 'stored-file-id',
      federation: {
        lastAvatarFetchedAt: new Date(Date.now() - 10 * 60 * 1000),
        avatarETag: '"etag-v1"',
        avatarLastModified: 'Wed, 21 Oct 2025 07:28:00 GMT',
      },
    });

    federationService.scheduleAvatarRefresh(userId, avatarUrl, 'stored-file-id', { force: true });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    expect(mockAssetFileContentExists).toHaveBeenCalledWith('stored-file-id');
    expect(mockAssetUploadFileDirect).toHaveBeenCalledWith(
      userId,
      expect.any(Buffer),
      'image/png',
      expect.stringMatching(/^federated-avatar-[a-f0-9]+\.png$/),
      'public',
      {
        source: 'federation',
        role: 'avatar',
        remoteUrl: avatarUrl,
      },
    );

    const updateArgs = mockUserUpdateOne.mock.calls[0];
    expect(updateArgs[0]).toEqual({ _id: userId });
    expect(updateArgs[1].$set).toMatchObject({
      avatar: 'repaired-file-id',
      'federation.avatarETag': '"etag-v2"',
      'federation.avatarLastModified': 'Thu, 22 Oct 2025 07:28:00 GMT',
    });
    expect(mockCacheInvalidate).toHaveBeenCalledWith(userId);
  });
});

describe('FederationService SSRF guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSafeFetch.mockReset();
    resetAssetMocks();
  });

  it('enforces https-only: an http avatar URL is rejected before reaching safeFetch', async () => {
    const result = await federationService.downloadAndStoreAvatar('http://cdn.example/avatar.png');

    expect(result).toEqual({ fileId: null, notModified: false });
    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(mockAssetUploadFileDirect).not.toHaveBeenCalled();
  });

  it('drops an avatar when safeFetch rejects the target as a private/blocked address', async () => {
    mockSafeFetch.mockRejectedValue(new FakeSsrfRejection('hostname resolves to blocked range'));

    const result = await federationService.downloadAndStoreAvatar('https://private.example/avatar.png');

    expect(result).toEqual({ fileId: null, notModified: false });
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    expect(mockAssetUploadFileDirect).not.toHaveBeenCalled();
  });

  it('returns null from WebFinger when safeFetch rejects the resource host as private', async () => {
    mockSafeFetch.mockRejectedValue(new FakeSsrfRejection('literal ip in blocked range'));

    await expect(federationService.resolveWebFingerResource('alice@trusted.example')).resolves.toBeNull();

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    expect(mockAssetUploadFileDirect).not.toHaveBeenCalled();
  });

  it('rejects oversized avatars via the content-length pre-check before buffering or upload', async () => {
    mockSafeFetch.mockResolvedValue(
      makeSafeFetchResult(
        200,
        {
          'content-type': 'image/png',
          'content-length': String(6 * 1024 * 1024),
        },
        Buffer.alloc(64),
      ),
    );

    const result = await federationService.downloadAndStoreAvatar('https://cdn.example/huge.png');

    expect(result).toEqual({ fileId: null, etag: undefined, lastModified: undefined, notModified: false });
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    expect(mockAssetUploadFileDirect).not.toHaveBeenCalled();
  });

  it('rejects avatars whose streamed body exceeds the byte cap even without content-length', async () => {
    mockSafeFetch.mockResolvedValue(
      makeSafeFetchResult(
        200,
        { 'content-type': 'image/png' },
        Buffer.alloc(6 * 1024 * 1024),
      ),
    );

    const result = await federationService.downloadAndStoreAvatar('https://cdn.example/streamed-huge.png');

    expect(result).toEqual({ fileId: null, etag: undefined, lastModified: undefined, notModified: false });
    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    expect(mockAssetUploadFileDirect).not.toHaveBeenCalled();
  });
});
