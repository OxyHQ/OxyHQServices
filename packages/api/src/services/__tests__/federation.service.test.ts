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
const mockUserUpdateOne = jest.fn();
const mockUserFindOneAndUpdate = jest.fn();
const mockCacheInvalidate = jest.fn();

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

// AssetService / S3 are only reached through downloadAndStoreAvatar, which we
// spy on directly, so a no-op stub keeps the import graph happy.
jest.mock('../assetService', () => ({
  __esModule: true,
  AssetService: class {},
}));
jest.mock('../s3Service', () => ({
  __esModule: true,
  createS3Service: jest.fn(() => ({})),
}));

import { federationService } from '../federation.service';

const DOMAIN = 'mastodon.social';
const NEW_AVATAR_URL = 'https://cdn.example/avatar-new.png';

interface CachedUser {
  _id: { toString(): string };
  type: string;
  username: string;
  avatar?: string;
  updatedAt: Date;
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
    webfingerSpy = jest.spyOn(federationService, 'resolveWebFinger');
    actorSpy = jest.spyOn(federationService, 'fetchActorProfile');
    avatarSpy = jest.spyOn(federationService, 'downloadAndStoreAvatar').mockResolvedValue('new-file-id');
    mockUserUpdateOne.mockResolvedValue({ acknowledged: true });
  });

  afterEach(() => {
    webfingerSpy.mockRestore();
    actorSpy.mockRestore();
    avatarSpy.mockRestore();
  });

  it('returns a fresh cached user immediately without any remote I/O', async () => {
    const fx = nextFixture();
    webfingerSpy.mockResolvedValue(fx.actorUri);
    actorSpy.mockResolvedValue(null);

    const cached = cachedUser(fx, FRESH_AGE_MS);
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
    webfingerSpy.mockResolvedValue(fx.actorUri);
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

    expect(actorSpy).toHaveBeenCalledWith(fx.actorUri);
    expect(avatarSpy).toHaveBeenCalledWith(NEW_AVATAR_URL, 'stored-file-id');

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

  it('throttles repeated background refreshes for the same actor (storm guard)', async () => {
    const fx = nextFixture();
    webfingerSpy.mockResolvedValue(fx.actorUri);
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
    webfingerSpy.mockResolvedValue(fx.actorUri);
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
    expect(actorSpy).toHaveBeenCalledWith(fx.actorUri);
    expect(avatarSpy).toHaveBeenCalledWith(NEW_AVATAR_URL);
    expect(result).toBe(created);
  });

  it('never throws out of resolveAndUpsert when the background refresh rejects', async () => {
    const fx = nextFixture();
    webfingerSpy.mockResolvedValue(fx.actorUri);
    actorSpy.mockRejectedValue(new Error('remote down'));

    const cached = cachedUser(fx, STALE_AGE_MS);
    mockFindOneReturning(cached);

    await expect(federationService.resolveAndUpsert(fx.handle)).resolves.toBe(cached);
    await flushMicrotasks();

    expect(mockCacheInvalidate).not.toHaveBeenCalled();
  });
});
