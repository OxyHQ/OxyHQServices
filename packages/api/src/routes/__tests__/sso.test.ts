/**
 * Central cross-domain SSO endpoints (Phase A).
 *
 *   POST /sso/code     — internal mint, gated by the X-Oxy-Internal secret.
 *   POST /sso/exchange — public single-use redemption, origin-bound.
 *
 * Coverage:
 *  - mint WITHOUT the internal secret           -> 404 (route hidden)
 *  - mint WITH a wrong internal secret           -> 404
 *  - mint for an UNAPPROVED clientOrigin         -> 400 (fail closed)
 *  - mint happy path                             -> 200 { code }
 *  - exchange happy path                         -> 200 { accessToken, ... }
 *  - exchange DOUBLE-redeem (single-use burn)    -> 410 Gone
 *  - exchange ORIGIN mismatch                    -> 403
 *  - exchange EXPIRED / unknown code             -> 410 Gone
 *
 * The Valkey/Redis store is mocked with an in-memory map that honours the
 * atomic GETDEL single-use semantics, so the double-redeem and expiry paths
 * exercise the real burn logic in `ssoCode.service`.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

process.env.SSO_INTERNAL_SECRET = 'test-sso-internal-secret-32-chars-long!!';

// ---- In-memory Valkey/Redis double with atomic GETDEL ---------------------
const store = new Map<string, string>();
const mockRedis = {
  set: jest.fn(async (key: string, value: string, _ex: string, _ttl: number) => {
    store.set(key, value);
    return 'OK';
  }),
  getdel: jest.fn(async (key: string) => {
    const value = store.get(key);
    if (value === undefined) return null;
    store.delete(key);
    return value;
  }),
};

jest.mock('../../config/redis', () => ({
  getRedisClient: () => mockRedis,
}));

// Rate limiter is a pass-through in tests.
jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// `sso.ts` imports `authMiddleware` (for the bearer-gated `/sso/establish-token`
// route), which pulls the mongoose model chain the global mongoose mock cannot
// load at import time. This suite exercises only the internal `/sso/code` +
// public `/sso/exchange` routes, so stub the auth middleware to a no-op — it is
// never mounted on the routes under test here.
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Approved-clients allow-list: only https://mention.earth is approved.
const APPROVED = new Set(['https://mention.earth']);
jest.mock('../../services/fedcm.service', () => ({
  __esModule: true,
  default: {
    isClientApproved: jest.fn(async (origin: string) => APPROVED.has(origin)),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import ssoRouter, { ssoExchangeCors } from '../sso';
import fedcmService from '../../services/fedcm.service';
import * as ssoCodeService from '../../services/ssoCode.service';

// Typed handle to the mocked allow-list check so individual tests can force it
// to throw (driving the controller's 500 catch path).
const mockIsClientApproved = fedcmService.isClientApproved as jest.MockedFunction<
  typeof fedcmService.isClientApproved
>;

const VALID_SESSION = {
  sessionId: 'sess-abc',
  accessToken: 'access-jwt-xyz',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  // `name` MUST be the structured UserNameResponse object — a bare string name
  // is rejected by `parseSessionPayload`. `displayName` is OPTIONAL (contracts
  // 0.6.0); it is included here because this fixture models a user with a real
  // name.
  user: { id: '64f7c2a1b8e9d3f4a1c2b3d4', username: 'alice', name: { displayName: 'Alice' } },
};

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function requestJson(
  server: http.Server,
  method: string,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {}
): Promise<JsonResponse> {
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
          ...headers,
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
  app.use('/sso/exchange', ssoExchangeCors);
  app.use(express.json());
  app.use('/sso', ssoRouter);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

/** Mint a code via the internal endpoint and return it. */
async function mintCode(clientOrigin = 'https://mention.earth'): Promise<string> {
  const res = await requestJson(
    server,
    'POST',
    '/sso/code',
    { session: VALID_SESSION, clientOrigin },
    { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
  );
  expect(res.status).toBe(200);
  return res.body.code as string;
}

describe('POST /sso/code', () => {
  it('returns 404 when the internal secret header is absent', async () => {
    const res = await requestJson(server, 'POST', '/sso/code', {
      session: VALID_SESSION,
      clientOrigin: 'https://mention.earth',
    });
    expect(res.status).toBe(404);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('returns 404 when the internal secret is wrong', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      { session: VALID_SESSION, clientOrigin: 'https://mention.earth' },
      { 'x-oxy-internal': 'definitely-not-the-secret-value-here!!' }
    );
    expect(res.status).toBe(404);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('returns 400 for an unapproved clientOrigin (fail closed)', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      { session: VALID_SESSION, clientOrigin: 'https://evil.example' },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(res.status).toBe(400);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed session payload', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      { session: { accessToken: 'x' }, clientOrigin: 'https://mention.earth' },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when user.name is a bare string (structured UserNameResponse required)', async () => {
    // A string name drops the structured shape the SDK parses on redemption →
    // the session must never be minted. Fail closed at 400.
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      {
        session: {
          sessionId: 'sess-x',
          accessToken: 'access-x',
          user: { id: '64f7c2a1b8e9d3f4a1c2b3d4', username: 'alice', name: 'Alice' },
        },
        clientOrigin: 'https://mention.earth',
      },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(res.status).toBe(400);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('returns 400 when user.name is missing entirely', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      {
        session: {
          sessionId: 'sess-x',
          accessToken: 'access-x',
          user: { id: '64f7c2a1b8e9d3f4a1c2b3d4', username: 'alice' },
        },
        clientOrigin: 'https://mention.earth',
      },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(res.status).toBe(400);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('mints a code when user.name is a structured object without a displayName (handle fallback on the client)', async () => {
    // `name.displayName` is OPTIONAL (contracts 0.6.0): a username-only account
    // legitimately has no real name. The structured `name` object is still
    // required (a bare string is rejected above), but the absence of a
    // displayName no longer fails the payload — RP clients fall back to the
    // handle.
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      {
        session: {
          sessionId: 'sess-x',
          accessToken: 'access-x',
          user: { id: '64f7c2a1b8e9d3f4a1c2b3d4', username: 'alice', name: {} },
        },
        clientOrigin: 'https://mention.earth',
      },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(res.status).toBe(200);
    expect(res.body.code).toEqual(expect.any(String));
    expect(mockRedis.set).toHaveBeenCalled();
  });

  it('returns 400 when user.name carries a non-string displayName', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      {
        session: {
          sessionId: 'sess-x',
          accessToken: 'access-x',
          user: { id: '64f7c2a1b8e9d3f4a1c2b3d4', username: 'alice', name: { first: 'Alice', displayName: 42 } },
        },
        clientOrigin: 'https://mention.earth',
      },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(res.status).toBe(400);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('returns 400 when clientOrigin is missing', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      { session: VALID_SESSION },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(res.status).toBe(400);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('returns 400 when clientOrigin is not a valid origin', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      { session: VALID_SESSION, clientOrigin: 'not a url at all' },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(res.status).toBe(400);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('returns 404 when SSO_INTERNAL_SECRET is not configured (route fails closed)', async () => {
    const saved = process.env.SSO_INTERNAL_SECRET;
    delete process.env.SSO_INTERNAL_SECRET;
    try {
      const res = await requestJson(
        server,
        'POST',
        '/sso/code',
        { session: VALID_SESSION, clientOrigin: 'https://mention.earth' },
        { 'x-oxy-internal': 'anything-at-all' }
      );
      expect(res.status).toBe(404);
      expect(mockRedis.set).not.toHaveBeenCalled();
    } finally {
      process.env.SSO_INTERNAL_SECRET = saved;
    }
  });

  it('returns 500 when the approved-clients lookup throws', async () => {
    mockIsClientApproved.mockRejectedValueOnce(new Error('valkey down'));
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      { session: VALID_SESSION, clientOrigin: 'https://mention.earth' },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(res.status).toBe(500);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('mints a code on the happy path and stores only the hash', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/code',
      { session: VALID_SESSION, clientOrigin: 'https://mention.earth' },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(res.status).toBe(200);
    expect(typeof res.body.code).toBe('string');
    expect((res.body.code as string).length).toBeGreaterThan(20);
    // Stored under sso:code:<sha256> — never the raw code.
    const storedKeys = Array.from(store.keys());
    expect(storedKeys).toHaveLength(1);
    expect(storedKeys[0].startsWith('sso:code:')).toBe(true);
    expect(storedKeys[0]).not.toContain(res.body.code as string);
  });
});

describe('POST /sso/exchange', () => {
  it('redeems a valid code on the happy path', async () => {
    const code = await mintCode();
    const res = await requestJson(
      server,
      'POST',
      '/sso/exchange',
      { code },
      { origin: 'https://mention.earth' }
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: VALID_SESSION.accessToken,
      sessionId: VALID_SESSION.sessionId,
      expiresAt: VALID_SESSION.expiresAt,
      user: VALID_SESSION.user,
    });
  });

  it('preserves the structured user.name (displayName) end-to-end', async () => {
    const code = await mintCode();
    const res = await requestJson(
      server,
      'POST',
      '/sso/exchange',
      { code },
      { origin: 'https://mention.earth' }
    );
    expect(res.status).toBe(200);
    const user = res.body.user as { name?: unknown };
    expect(typeof user.name).toBe('object');
    expect(user.name).toEqual({ displayName: 'Alice' });
  });

  it('round-trips every optional session field (full user + authuser)', async () => {
    const fullSession = {
      sessionId: 'sess-full',
      accessToken: 'access-full',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      authuser: 4,
      user: {
        id: '64f7c2a1b8e9d3f4a1c2b3d4',
        username: 'alice',
        email: 'alice@oxy.so',
        avatar: 'https://cdn.example/a.png',
        name: { first: 'Alice', last: 'Example', full: 'Alice Example', displayName: 'Alice Example' },
      },
    };
    const mint = await requestJson(
      server,
      'POST',
      '/sso/code',
      { session: fullSession, clientOrigin: 'https://mention.earth' },
      { 'x-oxy-internal': process.env.SSO_INTERNAL_SECRET as string }
    );
    expect(mint.status).toBe(200);

    const res = await requestJson(
      server,
      'POST',
      '/sso/exchange',
      { code: mint.body.code },
      { origin: 'https://mention.earth' }
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: fullSession.accessToken,
      sessionId: fullSession.sessionId,
      expiresAt: fullSession.expiresAt,
      authuser: fullSession.authuser,
      user: fullSession.user,
    });
  });

  it('returns 410 on a second redemption (single-use burn)', async () => {
    const code = await mintCode();
    const first = await requestJson(
      server,
      'POST',
      '/sso/exchange',
      { code },
      { origin: 'https://mention.earth' }
    );
    expect(first.status).toBe(200);

    const second = await requestJson(
      server,
      'POST',
      '/sso/exchange',
      { code },
      { origin: 'https://mention.earth' }
    );
    expect(second.status).toBe(410);
  });

  it('returns 403 when the requesting Origin does not match the bound origin', async () => {
    const code = await mintCode();
    const res = await requestJson(
      server,
      'POST',
      '/sso/exchange',
      { code },
      { origin: 'https://homiio.com' }
    );
    expect(res.status).toBe(403);
    // The code was still burned (GETDEL happens before the origin check), so it
    // cannot be retried even from the correct origin — defends against probing.
    const retry = await requestJson(
      server,
      'POST',
      '/sso/exchange',
      { code },
      { origin: 'https://mention.earth' }
    );
    expect(retry.status).toBe(410);
  });

  it('returns 403 when the Origin header is missing', async () => {
    const code = await mintCode();
    const res = await requestJson(server, 'POST', '/sso/exchange', { code });
    expect(res.status).toBe(403);
  });

  it('returns 410 for an unknown / expired code', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/exchange',
      { code: 'this-code-was-never-minted-or-has-expired' },
      { origin: 'https://mention.earth' }
    );
    expect(res.status).toBe(410);
  });

  it('returns 400 when no code is supplied', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/exchange',
      {},
      { origin: 'https://mention.earth' }
    );
    expect(res.status).toBe(400);
  });

  it('returns 500 when code redemption throws unexpectedly', async () => {
    const spy = jest
      .spyOn(ssoCodeService, 'redeemSsoCode')
      .mockRejectedValueOnce(new Error('valkey exploded'));
    try {
      const res = await requestJson(
        server,
        'POST',
        '/sso/exchange',
        { code: 'some-code' },
        { origin: 'https://mention.earth' }
      );
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });

  it('echoes approved origin with credentials:false on the OPTIONS preflight', async () => {
    const address = server.address() as AddressInfo;
    const result = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(
        {
          method: 'OPTIONS',
          host: '127.0.0.1',
          port: address.port,
          path: '/sso/exchange',
          headers: { origin: 'https://mention.earth' },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect(result.status).toBe(204);
    expect(result.headers['access-control-allow-origin']).toBe('https://mention.earth');
    expect(result.headers['access-control-allow-credentials']).toBe('false');
  });

  it('does not echo an unapproved origin on the OPTIONS preflight', async () => {
    const address = server.address() as AddressInfo;
    const result = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(
        {
          method: 'OPTIONS',
          host: '127.0.0.1',
          port: address.port,
          path: '/sso/exchange',
          headers: { origin: 'https://evil.example' },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect(result.status).toBe(204);
    expect(result.headers['access-control-allow-origin']).toBeUndefined();
  });
});
