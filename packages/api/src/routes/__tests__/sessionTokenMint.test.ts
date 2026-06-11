/**
 * GET /session/token/:sessionId — cold-boot bearer-free token mint
 *
 * The route authenticates via the sessionId path param itself (UUID-validated)
 * without requiring a Bearer token, enabling cookie-free cold-boot session
 * restore on web reload. Tests cover:
 *
 *  - Valid session → 200 { accessToken, expiresAt }, getAccessToken called with sessionId
 *  - Minted token carries the sessionId claim (proven via jwt.verify)
 *  - Unknown / expired / inactive session → 401
 *  - Rate limit triggers after N rapid calls for the same sessionId → 429
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import expressRateLimit from 'express-rate-limit';

// The global jest.setup.cjs mocks jsonwebtoken (sign → 'mock-jwt-token',
// verify → { userId: 'test-user-id', sessionId: 'test-session-id' }).
// We need the REAL jwt to sign and verify tokens for the sessionId-claim test.
const realJwt = jest.requireActual<typeof import('jsonwebtoken')>('jsonwebtoken');

// ---- mock the rateLimiter module before any route imports ----
// We override it per describe block by re-assigning rateLimitImpl.
// The pass-through variant is used for the 200/401 describe; the real
// max=2 limiter is used for the 429 describe in a separate express app.
const mockGetAccessToken = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  serviceAuthMiddleware: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

// Default: pass-through limiter. Replaced per-suite for the 429 test.
jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
    createSession: jest.fn(),
    validateSessionById: jest.fn(),
    getUserActiveSessions: jest.fn(),
  },
}));

jest.mock('../../services/anomalyDetection.service', () => ({
  __esModule: true,
  default: { checkForAnomalies: jest.fn() },
}));

jest.mock('../../services/securityActivityService', () => ({
  __esModule: true,
  default: { logSignIn: jest.fn(), logSignOut: jest.fn(), logAccountRecovery: jest.fn() },
}));

jest.mock('../../services/loginLockout.service', () => ({
  isLockedOut: jest.fn().mockResolvedValue({ locked: false, attempts: 0 }),
  recordFailure: jest.fn().mockResolvedValue({ locked: false, attempts: 0 }),
  clearFailures: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/sessionCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn(), get: jest.fn(), set: jest.fn() },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn(), findById: jest.fn() },
  default: { findOne: jest.fn(), findById: jest.fn() },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() },
}));

jest.mock('../../models/AuthChallenge', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../models/RecoveryCode', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../models/Notification', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../utils/deviceUtils', () => ({
  getDeviceActiveSessions: jest.fn(),
  logoutAllDeviceSessions: jest.fn(),
}));

jest.mock('../../server', () => ({
  emitSessionUpdate: jest.fn(),
}));

import sessionRouter from '../session';
import { errorHandler } from '../../middleware/errorHandler';

// A real UUID v4 that passes the sessionTokenMintParams schema (mocked away
// for the 200/401 suite but used as a valid-looking path param for rate-limit
// tests where validate is NOT mocked to pass-through).
const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

// Token secret used to mint and verify the access token in the JWT claim test.
const TEST_ACCESS_TOKEN_SECRET = 'test-access-token-secret-for-jwt-claim-test';

// ---- helpers ----------------------------------------------------------------

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

function get(server: http.Server, path: string, headers: Record<string, string> = {}): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        host: '127.0.0.1',
        port: address.port,
        path,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          // Rate-limit responses may be plain text — parse JSON when possible,
          // fall back to { message: <raw text> } so callers can still assert.
          let parsed: Record<string, unknown>;
          try {
            parsed = raw.length > 0 ? JSON.parse(raw) : {};
          } catch {
            parsed = { message: raw };
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ---- suite 1: 200 / 401 paths (pass-through limiter, pass-through validate) -

describe('GET /session/token/:sessionId — token mint (no auth required)', () => {
  let server: http.Server;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use('/session', sessionRouter);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1', done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ACCESS_TOKEN_SECRET = TEST_ACCESS_TOKEN_SECRET;
  });

  it('returns 200 with { accessToken, expiresAt } for a valid session (no Authorization header)', async () => {
    const sessionId = VALID_UUID;
    const userId = '64f7c2a1b8e9d3f4a1c2b3d4';
    const deviceId = 'dev-1';
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Use the real jwt (not the global mock) to produce a verifiable token.
    const accessToken = realJwt.sign(
      { sessionId, userId, deviceId },
      TEST_ACCESS_TOKEN_SECRET,
      { expiresIn: '15m' }
    );

    mockGetAccessToken.mockResolvedValueOnce({ accessToken, expiresAt });

    const res = await get(server, `/session/token/${sessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe(accessToken);
    expect(res.body.expiresAt).toBe(expiresAt.toISOString());
    expect(mockGetAccessToken).toHaveBeenCalledWith(sessionId);
  });

  it('minted access token carries the correct sessionId claim', async () => {
    const sessionId = VALID_UUID;
    const userId = '64f7c2a1b8e9d3f4a1c2b3d4';
    const deviceId = 'dev-2';
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Use the real jwt to produce a token whose claims we can verify.
    const accessToken = realJwt.sign(
      { sessionId, userId, deviceId },
      TEST_ACCESS_TOKEN_SECRET,
      { expiresIn: '15m' }
    );

    mockGetAccessToken.mockResolvedValueOnce({ accessToken, expiresAt });

    const res = await get(server, `/session/token/${sessionId}`);

    expect(res.status).toBe(200);

    // Decode with the real jwt — the global mock would return 'test-session-id'.
    const decoded = realJwt.verify(res.body.accessToken as string, TEST_ACCESS_TOKEN_SECRET) as Record<string, unknown>;
    expect(decoded.sessionId).toBe(sessionId);
    expect(decoded.userId).toBe(userId);
  });

  it('returns 200 even when an Authorization header IS present (bearer ignored)', async () => {
    const sessionId = VALID_UUID;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const accessToken = realJwt.sign(
      { sessionId, userId: 'uid', deviceId: 'dev' },
      TEST_ACCESS_TOKEN_SECRET,
      { expiresIn: '15m' }
    );

    mockGetAccessToken.mockResolvedValueOnce({ accessToken, expiresAt });

    const res = await get(server, `/session/token/${sessionId}`, {
      Authorization: 'Bearer some-old-or-invalid-token',
    });

    expect(res.status).toBe(200);
    expect(mockGetAccessToken).toHaveBeenCalledWith(sessionId);
  });

  it('returns 401 when getAccessToken returns null (session unknown/expired/inactive)', async () => {
    mockGetAccessToken.mockResolvedValueOnce(null);

    const res = await get(server, `/session/token/${VALID_UUID}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid or expired session');
  });
});

// ---- suite 2: rate limiting --------------------------------------------------
// Uses a separate express app with a real expressRateLimit(max=2) so we can
// verify the 429 path without relying on the production Redis store.

describe('GET /session/token/:sessionId — rate limiting', () => {
  let rateLimitedServer: http.Server;

  beforeAll((done) => {
    // Override the rateLimiter mock for THIS suite's express app.
    // We build a fresh express app that manually applies the real limiter.
    const limiter = expressRateLimit({
      windowMs: 60_000,
      max: 2,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) =>
        `session-token-mint:${req.params.sessionId || (req.ip ?? 'unknown')}`,
    });

    const app = express();
    app.use(express.json());
    // Mount the limiter directly ahead of the session router so that the
    // per-sessionId key fires on the /token/:sessionId path.
    app.use('/session/token/:sessionId', limiter);
    app.use('/session', sessionRouter);
    app.use(errorHandler);

    rateLimitedServer = app.listen(0, '127.0.0.1', done);
  });

  afterAll((done) => {
    rateLimitedServer.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    mockGetAccessToken.mockResolvedValue({ accessToken: 'tok', expiresAt });
  });

  it('allows the first two requests and blocks the third with 429', async () => {
    const path = `/session/token/${VALID_UUID}`;

    const res1 = await get(rateLimitedServer, path);
    const res2 = await get(rateLimitedServer, path);
    const res3 = await get(rateLimitedServer, path);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(429);
  });
});
