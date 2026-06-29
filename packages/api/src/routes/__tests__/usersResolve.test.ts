/**
 * /users/resolve scope + binding tests (C4 regression coverage)
 *
 * Walks the route through every rejection path:
 *  - missing scope on the service token
 *  - actorUri hostname does not match the asserted domain
 *  - agent/automated username collides with an existing local user
 *  - existing user has a different `type` (no silent type promotion)
 *
 * The router is mounted on a minimal Express app and exercised via
 * `node:http` round-trips so we hit the real middleware chain.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockServiceAuthMiddleware = jest.fn();
const mockAuthMiddleware = jest.fn();
const mockUserFindOne = jest.fn();
const mockUserFindOneAndUpdate = jest.fn();
const mockScheduleAvatarRefresh = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
  serviceAuthMiddleware: (...args: unknown[]) => mockServiceAuthMiddleware(...args),
}));

// `optionalAuth` is imported by the router (for POST /users/by-ids). Mock it so
// the test does not pull in the real session/auth/mongoose module graph.
jest.mock('../../middleware/optionalAuth', () => ({
  optionalUserOrServiceAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Many of the existing user routes import services that need a real DB.
// We stub all of them to no-op so importing the router doesn't crash.
jest.mock('../../services/email.service', () => ({
  emailService: { deleteAllUserData: jest.fn() },
}));
jest.mock('../../services/federation.service', () => ({
  federationService: { scheduleAvatarRefresh: mockScheduleAvatarRefresh },
  // Mirror the real predicate: own apex defaults to `oxy.so`. Used by the
  // own-domain guard in PUT /users/resolve.
  isOwnFederationDomain: (domain: string) => domain.trim().toLowerCase() === 'oxy.so',
}));
jest.mock('../../services/assetServiceSingleton', () => ({
  assetService: { ensureOwnedAssetPublic: jest.fn().mockResolvedValue(undefined) },
  s3Service: {},
}));
jest.mock('../../services/user.service', () => ({
  userService: {},
}));
// usersRouter now imports the signed-export service (which pulls in the identity
// model graph). Stub it — this suite does not exercise GET /users/me/export.
jest.mock('../../services/identityExport.service', () => ({
  buildExportBundle: jest.fn(),
}));
jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../controllers/users.controller', () => ({
  UsersController: class {
    searchUsers = jest.fn();
  },
}));
jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn() },
}));
jest.mock('../../utils/validation', () => ({
  resolveUserIdToObjectId: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findOne: mockUserFindOne,
    findOneAndUpdate: mockUserFindOneAndUpdate,
  },
}));

import usersRouter from '../users';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: { error?: string; message?: string; data?: unknown };
}

async function requestJson(server: http.Server, method: string, path: string, payload: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = raw.length > 0 ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/users', usersRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindOne.mockReset();
  mockUserFindOneAndUpdate.mockReset();
  // Default: serviceAuthMiddleware grants the federation:write scope.
  mockServiceAuthMiddleware.mockImplementation(
    (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
      req.serviceApp = {
        type: 'service',
        appId: 'app-1',
        appName: 'fed-svc',
        scopes: ['federation:write'],
      };
      next();
    }
  );
});

describe('PUT /users/resolve (C4)', () => {
  it('rejects when the service token lacks federation:write scope', async () => {
    // Override the default mock so this caller has no scopes.
    mockServiceAuthMiddleware.mockImplementationOnce(
      (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
        req.serviceApp = {
          type: 'service',
          appId: 'app-1',
          appName: 'limited-svc',
          scopes: [],
        };
        next();
      }
    );

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'alice@mastodon.social',
      actorUri: 'https://mastodon.social/users/alice',
      domain: 'mastodon.social',
    });

    expect(res.status).toBe(403);
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects when actorUri hostname does not match the asserted domain', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'mallory@mastodon.social',
      // Hostname is `evil.example` — should be rejected.
      actorUri: 'https://evil.example/users/mallory',
      domain: 'mastodon.social',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/actorUri hostname/i);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://mastodon.social/.well-known/webfinger?resource=acct%3Amallory%40mastodon.social',
      expect.anything(),
    );
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('rejects agent username that collides with an existing local user', async () => {
    const leanResult = jest.fn().mockResolvedValue({ _id: 'local-id', type: 'local' });
    const selectResult = jest.fn().mockReturnValue({ lean: leanResult });
    mockUserFindOne.mockReturnValueOnce({ select: selectResult });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'agent',
      username: 'alice',
      ownerId: 'owner-1',
    });

    expect(res.status).toBe(409);
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects when an existing user has a different type (no type promotion)', async () => {
    // First findOne: collision check for agents/automated — no local user.
    const leanResult1 = jest.fn().mockResolvedValue(null);
    const selectResult1 = jest.fn().mockReturnValue({ lean: leanResult1 });
    // Second findOne: existing user has type 'automated' but caller asserts 'agent'.
    const leanResult2 = jest.fn().mockResolvedValue({ _id: 'u', type: 'automated' });
    const selectResult2 = jest.fn().mockReturnValue({ lean: leanResult2 });
    mockUserFindOne
      .mockReturnValueOnce({ select: selectResult1 })
      .mockReturnValueOnce({ select: selectResult2 });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'agent',
      username: 'bot1',
      ownerId: 'owner-1',
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/cannot change.*type/i);
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('happy path: federated user is resolved when scope + bindings are valid', async () => {
    const leanResult = jest.fn().mockResolvedValue(null);
    const selectResult = jest.fn().mockReturnValue({ lean: leanResult });
    mockUserFindOne.mockReturnValueOnce({ select: selectResult });

    const newUserDoc = { _id: 'new-user', username: 'alice@mastodon.social', type: 'federated' };
    const updateLean = jest.fn().mockResolvedValue(newUserDoc);
    const updateSelect = jest.fn().mockReturnValue({ lean: updateLean });
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select: updateSelect });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'alice@mastodon.social',
      actorUri: 'https://mastodon.social/users/alice',
      domain: 'mastodon.social',
    });

    expect(res.status).toBe(200);
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledWith(
      { 'federation.actorUri': 'https://mastodon.social/users/alice' },
      expect.objectContaining({
        $set: expect.objectContaining({
          username: 'alice@mastodon.social',
          'federation.actorUri': 'https://mastodon.social/users/alice',
          'federation.domain': 'mastodon.social',
          'federation.lastResolvedAt': expect.any(Date),
        }),
        $unset: expect.objectContaining({
          'federation.unavailableAt': '',
          'federation.unavailableReason': '',
        }),
      }),
      expect.anything(),
    );
  });

  it('strips the federated display name and escapes bio before persistence', async () => {
    const leanResult = jest.fn().mockResolvedValue(null);
    const selectResult = jest.fn().mockReturnValue({ lean: leanResult });
    mockUserFindOne.mockReturnValueOnce({ select: selectResult });

    const newUserDoc = { _id: 'new-user', username: 'alice@mastodon.social', type: 'federated' };
    const updateLean = jest.fn().mockResolvedValue(newUserDoc);
    const updateSelect = jest.fn().mockReturnValue({ lean: updateLean });
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select: updateSelect });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'alice@mastodon.social',
      actorUri: 'https://mastodon.social/users/alice',
      domain: 'mastodon.social',
      displayName: '<img src=x onerror=alert("fediverse-xss")>',
      bio: '<script>alert("bio")</script>',
    });

    expect(res.status).toBe(200);
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledWith(
      { 'federation.actorUri': 'https://mastodon.social/users/alice' },
      expect.objectContaining({
        $set: expect.objectContaining({
          // Display name: disallowed characters stripped (never escaped).
          'name.first': 'img src x onerror alert fediverse xss',
          // Bio is not a display name and keeps HTML-entity escaping.
          bio: '&lt;script&gt;alert(&quot;bio&quot;)&lt;/script&gt;',
        }),
      }),
      expect.anything(),
    );
  });

  it('allows actorUri on the www host while keeping the canonical federated username', async () => {
    const leanResult = jest.fn().mockResolvedValue(null);
    const selectResult = jest.fn().mockReturnValue({ lean: leanResult });
    mockUserFindOne.mockReturnValueOnce({ select: selectResult });

    const newUserDoc = { _id: 'threads-user', username: 'mosseri@threads.net', type: 'federated' };
    const updateLean = jest.fn().mockResolvedValue(newUserDoc);
    const updateSelect = jest.fn().mockReturnValue({ lean: updateLean });
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select: updateSelect });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'mosseri@threads.net',
      actorUri: 'https://www.threads.net/ap/users/mosseri/',
      domain: 'threads.net',
    });

    expect(res.status).toBe(200);
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledWith(
      { 'federation.actorUri': 'https://www.threads.net/ap/users/mosseri/' },
      expect.objectContaining({
        $set: expect.objectContaining({
          username: 'mosseri@threads.net',
          'federation.actorUri': 'https://www.threads.net/ap/users/mosseri/',
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
  });

  it('allows non-www actor hosts only when WebFinger loops back to the actor URI', async () => {
    const actorUri = 'https://ap.example.com/users/alice';
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        subject: 'acct:alice@example.com',
        links: [
          { rel: 'self', type: 'application/activity+json', href: actorUri },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/jrd+json' },
      }),
    );

    const leanResult = jest.fn().mockResolvedValue(null);
    const selectResult = jest.fn().mockReturnValue({ lean: leanResult });
    mockUserFindOne.mockReturnValueOnce({ select: selectResult });

    const newUserDoc = { _id: 'ap-user', username: 'alice@example.com', type: 'federated' };
    const updateLean = jest.fn().mockResolvedValue(newUserDoc);
    const updateSelect = jest.fn().mockReturnValue({ lean: updateLean });
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select: updateSelect });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'alice@example.com',
      actorUri,
      domain: 'example.com',
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/.well-known/webfinger?resource=acct%3Aalice%40example.com',
      expect.anything(),
    );
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledWith(
      { 'federation.actorUri': actorUri },
      expect.objectContaining({
        $set: expect.objectContaining({
          username: 'alice@example.com',
          'federation.actorUri': actorUri,
          'federation.domain': 'example.com',
        }),
      }),
      expect.anything(),
    );

    fetchSpy.mockRestore();
  });

  it('refresh: schedules an off-request-path avatar download with force=true and returns immediately', async () => {
    const newAvatarUrl = 'https://mastodon.social/avatars/alice.png';

    // First findOne: type-immutability check — no existing user found.
    const immutabilityLean = jest.fn().mockResolvedValue(null);
    const immutabilitySelect = jest.fn().mockReturnValue({ lean: immutabilityLean });
    // Second findOne: avatar lookup — existing user already has a stored file id.
    const avatarLean = jest.fn().mockResolvedValue({ avatar: 'file-abc' });
    const avatarSelect = jest.fn().mockReturnValue({ lean: avatarLean });
    mockUserFindOne
      .mockReturnValueOnce({ select: immutabilitySelect })
      .mockReturnValueOnce({ select: avatarSelect });

    // The upsert returns the user with its PREVIOUS avatar — the new download
    // happens off the request path and lands afterwards.
    const newUserDoc = {
      _id: 'new-user',
      username: 'alice@mastodon.social',
      type: 'federated',
      avatar: 'file-abc',
    };
    const updateLean = jest.fn().mockResolvedValue(newUserDoc);
    const updateSelect = jest.fn().mockReturnValue({ lean: updateLean });
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select: updateSelect });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'alice@mastodon.social',
      actorUri: 'https://mastodon.social/users/alice',
      domain: 'mastodon.social',
      avatar: newAvatarUrl,
      refresh: true,
    });

    expect(res.status).toBe(200);
    // The download is scheduled, not awaited: the route never blocks on it.
    expect(mockScheduleAvatarRefresh).toHaveBeenCalledWith(
      'new-user',
      newAvatarUrl,
      'file-abc',
      { force: true },
    );
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('no refresh flag: skips scheduling when an existing stored avatar would make the worker a no-op', async () => {
    const newAvatarUrl = 'https://mastodon.social/avatars/alice.png';

    // First findOne: type-immutability check — no existing user found.
    const immutabilityLean = jest.fn().mockResolvedValue(null);
    const immutabilitySelect = jest.fn().mockReturnValue({ lean: immutabilityLean });
    // Second findOne: avatar lookup — existing user already has a stored file id.
    const avatarLean = jest.fn().mockResolvedValue({ avatar: 'file-abc' });
    const avatarSelect = jest.fn().mockReturnValue({ lean: avatarLean });
    mockUserFindOne
      .mockReturnValueOnce({ select: immutabilitySelect })
      .mockReturnValueOnce({ select: avatarSelect });

    const newUserDoc = {
      _id: 'new-user',
      username: 'alice@mastodon.social',
      type: 'federated',
      avatar: 'file-abc',
    };
    const updateLean = jest.fn().mockResolvedValue(newUserDoc);
    const updateSelect = jest.fn().mockReturnValue({ lean: updateLean });
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select: updateSelect });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'alice@mastodon.social',
      actorUri: 'https://mastodon.social/users/alice',
      domain: 'mastodon.social',
      avatar: newAvatarUrl,
    });

    expect(res.status).toBe(200);
    expect(mockScheduleAvatarRefresh).not.toHaveBeenCalled();
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('no refresh flag: schedules the initial avatar download when no stored avatar exists', async () => {
    const newAvatarUrl = 'https://mastodon.social/avatars/alice.png';

    // First findOne: type-immutability check — no existing user found.
    const immutabilityLean = jest.fn().mockResolvedValue(null);
    const immutabilitySelect = jest.fn().mockReturnValue({ lean: immutabilityLean });
    // Second findOne: avatar lookup — no stored file id yet.
    const avatarLean = jest.fn().mockResolvedValue({ avatar: undefined });
    const avatarSelect = jest.fn().mockReturnValue({ lean: avatarLean });
    mockUserFindOne
      .mockReturnValueOnce({ select: immutabilitySelect })
      .mockReturnValueOnce({ select: avatarSelect });

    const newUserDoc = {
      _id: 'new-user',
      username: 'alice@mastodon.social',
      type: 'federated',
    };
    const updateLean = jest.fn().mockResolvedValue(newUserDoc);
    const updateSelect = jest.fn().mockReturnValue({ lean: updateLean });
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select: updateSelect });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'alice@mastodon.social',
      actorUri: 'https://mastodon.social/users/alice',
      domain: 'mastodon.social',
      avatar: newAvatarUrl,
    });

    expect(res.status).toBe(200);
    expect(mockScheduleAvatarRefresh).toHaveBeenCalledWith(
      'new-user',
      newAvatarUrl,
      undefined,
      { force: false },
    );
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('strips the federated displayName and escapes bio before persisting (stored-XSS regression)', async () => {
    // Type-immutability check: no existing user.
    const leanResult = jest.fn().mockResolvedValue(null);
    const selectResult = jest.fn().mockReturnValue({ lean: leanResult });
    mockUserFindOne.mockReturnValueOnce({ select: selectResult });

    const newUserDoc = { _id: 'xss-user', username: 'mallory@evil.example', type: 'federated' };
    const updateLean = jest.fn().mockResolvedValue(newUserDoc);
    const updateSelect = jest.fn().mockReturnValue({ lean: updateLean });
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select: updateSelect });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'mallory@evil.example',
      actorUri: 'https://evil.example/users/mallory',
      domain: 'evil.example',
      displayName: '<img src=x onerror=alert(1)>',
      bio: 'hi <script>steal()</script> & "friends"',
    });

    expect(res.status).toBe(200);
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = mockUserFindOneAndUpdate.mock.calls[0];
    const setFields = (update as { $set: Record<string, unknown> }).$set;
    // Display names follow a strict char policy: disallowed characters
    // (`<`, `>`, `=`, `(`, `)`, digits) are stripped, never escaped — the
    // output can never carry an HTML/XSS vector.
    expect(setFields['name.first']).toBe('img src x onerror alert');
    expect(String(setFields['name.first'])).not.toMatch(/[<>&"]/);
    // Bio is NOT a display name and keeps HTML-entity escaping.
    expect(setFields.bio).toBe('hi &lt;script&gt;steal()&lt;/script&gt; &amp; &quot;friends&quot;');
    expect(String(setFields.bio)).not.toContain('<script>');
  });

  // ----------------------------------------------------------------------
  // Own-domain guard: `<localpart>@oxy.so` is a NON-ENTITY. On Oxy's own apex
  // the only valid identity is the bare local handle (`nate`); the
  // domain-qualified form must never be created or returned through the
  // federated resolve path. The route REJECTS with 400 and NEVER mints a
  // `type:'federated'` shadow row or resolves to the local user.
  // ----------------------------------------------------------------------

  it('rejects an own-domain handle with 400 and never mints a federated dup', async () => {
    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'nate@oxy.so',
      actorUri: 'https://oxy.so/ap/users/nate',
      domain: 'oxy.so',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/own federation domain/i);
    // Own-domain is a non-entity: the guard short-circuits before any DB work —
    // no local lookup and no federated mint.
    expect(mockUserFindOne).not.toHaveBeenCalled();
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects any own-domain handle regardless of the local-part (own-domain is a non-entity)', async () => {
    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'ghost@oxy.so',
      actorUri: 'https://oxy.so/ap/users/ghost',
      domain: 'oxy.so',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/own federation domain/i);
    expect(mockUserFindOne).not.toHaveBeenCalled();
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
