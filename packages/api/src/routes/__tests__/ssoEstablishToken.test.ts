/**
 * POST /sso/establish-token — bearer-authenticated durable-session establish
 * mint (web device-flow / "Sign in with Oxy" QR).
 *
 * Coverage:
 *  - missing bearer                                 -> 401 (auth gate)
 *  - unapproved origin                              -> 403 (fail closed)
 *  - Origin header != target origin                 -> 403
 *  - FEDCM_TOKEN_SECRET unset                        -> 501 (feature disabled)
 *  - happy path (oxy.so apex): host == auth.oxy.so, claim shape + exp correct,
 *    grant recorded, establish URL fully formed
 *  - cross-apex host derivation (mention.earth -> auth.mention.earth)
 *  - OPTIONS preflight echoes an approved origin with Authorization allowed
 *
 * `authMiddleware` is stubbed (sets `req.user` for any bearer, 401 otherwise);
 * the controller still decodes the REAL crafted JWT for the `sessionId` claim.
 * `fedcm.service` is mocked so the approved-clients list + grant recording are
 * asserted without a DB.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';

process.env.ACCESS_TOKEN_SECRET = 'test-access-token-secret-32-chars-long!!';
process.env.FEDCM_TOKEN_SECRET = 'test-fedcm-token-secret-32-chars-long!!';

// The global `jest.setup.cjs` stubs `jsonwebtoken` (fixed sign/verify, no
// `decode`). This suite exercises the REAL establish-token crypto — the exact
// HS256 claim shape + expiry the IdP verifies — so opt back into real
// jsonwebtoken for this file only.
jest.mock('jsonwebtoken', () => jest.requireActual('jsonwebtoken'));

const TEST_USER_ID = '64f7c2a1b8e9d3f4a1c2b3d4';
const TEST_SESSION_ID = 'session-abc-123';

// Rate limiter is a pass-through in tests.
jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Stub the shared auth middleware: any Bearer token authenticates as TEST_USER;
// the controller still decodes the real crafted token for the sessionId claim.
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    (req as unknown as { user?: { id: string } }).user = { id: TEST_USER_ID };
    next();
  },
}));

const APPROVED = new Set(['https://accounts.oxy.so', 'https://mention.earth']);
const recordGrant = jest.fn(async (_userId: string, _origin: string) => {});
jest.mock('../../services/fedcm.service', () => ({
  __esModule: true,
  default: {
    getApprovedClientOrigins: jest.fn(async () => Array.from(APPROVED)),
    isClientApproved: jest.fn(async (origin: string) => APPROVED.has(origin)),
    recordGrant,
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import ssoRouter, { ssoEstablishTokenCors } from '../sso';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function requestJson(
  server: http.Server,
  method: string,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {},
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
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** A real session-based bearer the controller can decode for its sessionId. */
function bearer(sessionId = TEST_SESSION_ID): string {
  const token = jwt.sign(
    { userId: TEST_USER_ID, sessionId },
    process.env.ACCESS_TOKEN_SECRET as string,
  );
  return `Bearer ${token}`;
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use('/sso/establish-token', ssoEstablishTokenCors);
  app.use(express.json());
  app.use('/sso', ssoRouter);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FEDCM_TOKEN_SECRET = 'test-fedcm-token-secret-32-chars-long!!';
});

describe('POST /sso/establish-token', () => {
  it('returns 401 when the bearer is missing', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/establish-token',
      { origin: 'https://accounts.oxy.so', state: 'state-xyz' },
      { origin: 'https://accounts.oxy.so' },
    );
    expect(res.status).toBe(401);
    expect(recordGrant).not.toHaveBeenCalled();
  });

  it('returns 403 for an unapproved origin (fail closed)', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/establish-token',
      { origin: 'https://evil.example', state: 'state-xyz' },
      { authorization: bearer(), origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(recordGrant).not.toHaveBeenCalled();
  });

  it('returns 403 when the Origin header does not match the target origin', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/establish-token',
      { origin: 'https://accounts.oxy.so', state: 'state-xyz' },
      { authorization: bearer(), origin: 'https://mention.earth' },
    );
    expect(res.status).toBe(403);
    expect(recordGrant).not.toHaveBeenCalled();
  });

  it('returns 403 when the Origin header is absent (non-browser caller) and records NO grant', async () => {
    // A missing Origin means a non-browser caller. Without this guard a
    // bearer-holding server-side caller could record a FedCM grant for ANY
    // approved origin in the body → silent /sso sign-in (consent bypass). The
    // grant write MUST be skipped.
    const res = await requestJson(
      server,
      'POST',
      '/sso/establish-token',
      { origin: 'https://accounts.oxy.so', state: 'state-xyz' },
      { authorization: bearer() }, // no Origin header
    );
    expect(res.status).toBe(403);
    expect(recordGrant).not.toHaveBeenCalled();
  });

  it('returns 400 when origin or state is missing', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/establish-token',
      { origin: 'https://accounts.oxy.so' },
      { authorization: bearer(), origin: 'https://accounts.oxy.so' },
    );
    expect(res.status).toBe(400);
  });

  it('returns 501 when FEDCM_TOKEN_SECRET is not configured', async () => {
    delete process.env.FEDCM_TOKEN_SECRET;
    const res = await requestJson(
      server,
      'POST',
      '/sso/establish-token',
      { origin: 'https://accounts.oxy.so', state: 'state-xyz' },
      { authorization: bearer(), origin: 'https://accounts.oxy.so' },
    );
    expect(res.status).toBe(501);
  });

  it('mints an establish URL for an oxy.so RP (host auth.oxy.so, claim shape, grant recorded)', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/establish-token',
      { origin: 'https://accounts.oxy.so', state: 'state-xyz' },
      { authorization: bearer(), origin: 'https://accounts.oxy.so' },
    );
    expect(res.status).toBe(200);

    const url = new URL(res.body.establishUrl as string);
    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('auth.oxy.so');
    expect(url.pathname).toBe('/sso/establish');
    expect(url.searchParams.get('return_to')).toBe('https://accounts.oxy.so/__oxy/sso-callback');
    expect(url.searchParams.get('state')).toBe('state-xyz');

    // The grant MUST be recorded for (user, origin) so `/sso/establish` finds it.
    expect(recordGrant).toHaveBeenCalledWith(TEST_USER_ID, 'https://accounts.oxy.so');

    // The establish-token verifies against FEDCM_TOKEN_SECRET with the exact
    // claim shape the IdP checks, sub == the bearer's session id, exp = iat + 60.
    const et = url.searchParams.get('et') as string;
    const claims = jwt.verify(et, process.env.FEDCM_TOKEN_SECRET as string) as Record<string, unknown>;
    expect(claims.sub).toBe(TEST_SESSION_ID);
    expect(claims.aud).toBe('https://accounts.oxy.so');
    expect(claims.host).toBe('auth.oxy.so');
    expect(claims.purpose).toBe('sso-establish');
    expect(typeof claims.iat).toBe('number');
    expect(claims.exp).toBe((claims.iat as number) + 60);
  });

  it('derives a cross-apex host (mention.earth -> auth.mention.earth)', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/establish-token',
      { origin: 'https://mention.earth', state: 's2' },
      { authorization: bearer(), origin: 'https://mention.earth' },
    );
    expect(res.status).toBe(200);

    const url = new URL(res.body.establishUrl as string);
    expect(url.host).toBe('auth.mention.earth');
    expect(url.searchParams.get('return_to')).toBe('https://mention.earth/__oxy/sso-callback');

    const claims = jwt.verify(
      url.searchParams.get('et') as string,
      process.env.FEDCM_TOKEN_SECRET as string,
    ) as Record<string, unknown>;
    expect(claims.host).toBe('auth.mention.earth');
    expect(claims.aud).toBe('https://mention.earth');
  });

  it('never takes the session id from the body — only the bearer', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/sso/establish-token',
      // A hostile body tries to smuggle a different session id.
      { origin: 'https://accounts.oxy.so', state: 's', sub: 'attacker-session', sessionId: 'attacker-session' },
      { authorization: bearer('real-session-999'), origin: 'https://accounts.oxy.so' },
    );
    expect(res.status).toBe(200);
    const et = new URL(res.body.establishUrl as string).searchParams.get('et') as string;
    const claims = jwt.verify(et, process.env.FEDCM_TOKEN_SECRET as string) as Record<string, unknown>;
    expect(claims.sub).toBe('real-session-999');
  });

  it('echoes an approved origin with Authorization allowed on the OPTIONS preflight', async () => {
    const address = server.address() as AddressInfo;
    const result = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(
        {
          method: 'OPTIONS',
          host: '127.0.0.1',
          port: address.port,
          path: '/sso/establish-token',
          headers: { origin: 'https://accounts.oxy.so' },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(result.status).toBe(204);
    expect(result.headers['access-control-allow-origin']).toBe('https://accounts.oxy.so');
    expect(result.headers['access-control-allow-credentials']).toBe('false');
    expect(String(result.headers['access-control-allow-headers'])).toContain('Authorization');
  });

  it('does not echo an unapproved origin on the OPTIONS preflight', async () => {
    const address = server.address() as AddressInfo;
    const result = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(
        {
          method: 'OPTIONS',
          host: '127.0.0.1',
          port: address.port,
          path: '/sso/establish-token',
          headers: { origin: 'https://evil.example' },
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(result.status).toBe(204);
    expect(result.headers['access-control-allow-origin']).toBeUndefined();
  });
});
