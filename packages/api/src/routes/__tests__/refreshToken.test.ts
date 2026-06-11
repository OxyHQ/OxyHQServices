/**
 * POST /auth/refresh tests (first-party httpOnly refresh-cookie rotation)
 *
 * Exercises the REAL `refreshToken.service` rotation/reuse logic and the REAL
 * `/auth/refresh` route handler. Only the `RefreshToken` MODEL and
 * `session.service` are mocked — so the rotation atomics, reuse-detection,
 * family-revocation, and cookie wiring are all under test.
 *
 * The refresh token lives ONLY in the httpOnly `oxy_rt` cookie. These tests use
 * a cookie-aware request helper that parses `set-cookie` from responses and
 * replays the `Cookie` header, exactly like a browser would.
 *
 * Cases:
 *  1. valid cookie            -> 200 + accessToken, AND a NEW oxy_rt cookie whose
 *                                value differs from the presented one (rotation);
 *                                getAccessToken called with the bound sessionId.
 *  2. reused/old token        -> 401, family revoked (updateMany) + session
 *                                deactivated (deactivateSession).
 *  3. missing cookie          -> 401 (getAccessToken never called).
 *  4. rate limit              -> 429 (separate app with a real max=2 limiter).
 *  5. logout clears cookie    -> clearRefreshCookie emits Set-Cookie Max-Age=0.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import expressRateLimit from 'express-rate-limit';

interface StoredToken {
  _id: string;
  tokenHash: string;
  sessionId: string;
  userId: { toString(): string };
  family: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockCreate = jest.fn();
const mockUpdateMany = jest.fn();

const mockGetAccessToken = jest.fn();
const mockDeactivateSession = jest.fn();

// ---- Mock the RefreshToken MODEL (real service logic runs against it) ----
jest.mock('../../models/RefreshToken', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    updateMany: (...args: unknown[]) => mockUpdateMany(...args),
  },
  RefreshToken: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    updateMany: (...args: unknown[]) => mockUpdateMany(...args),
  },
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
    deactivateSession: (...args: unknown[]) => mockDeactivateSession(...args),
    createSession: jest.fn(),
  },
}));

// ---- Module mocks required for the auth route module to load ----
jest.mock('../../middleware/auth', () => ({
  authMiddleware: jest.fn(),
  serviceAuthMiddleware: jest.fn(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/validate', () => ({
  validate: (..._args: unknown[]) =>
    (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../services/authSession.service', () => ({
  claimAuthSession: jest.fn(),
}));

jest.mock('../../services/oauthCode.service', () => {
  const actual = jest.requireActual('../../services/oauthCode.service');
  // Keep the REAL sha256Hex / base64UrlEncode (the refresh service imports
  // them); only stub the DB-touching authcode functions.
  return {
    __esModule: true,
    ...actual,
    issueAuthCode: jest.fn(),
    exchangeAuthCode: jest.fn(),
    AUTH_CODE_TTL_MS: 60_000,
  };
});

jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: {
    isValidPublicKey: jest.fn(),
    verifyChallengeResponse: jest.fn(),
    verifyRegistrationSignature: jest.fn(),
    verifySignature: jest.fn(),
    generateChallenge: jest.fn(),
    shortenPublicKey: jest.fn(),
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: jest.fn(), findOne: jest.fn() },
  default: { findById: jest.fn(), findOne: jest.fn() },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
  AuthSession: { findOne: jest.fn() },
}));

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: jest.fn() },
  default: { create: jest.fn() },
}));

jest.mock('../../models/DeveloperApp', () => ({
  __esModule: true,
  DeveloperApp: { findOne: jest.fn() },
  default: { findOne: jest.fn() },
}));

jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: jest.fn(),
}));

jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../controllers/session.controller', () => ({
  SessionController: {
    register: jest.fn(),
    signUp: jest.fn(),
    signIn: jest.fn(),
    requestChallenge: jest.fn(),
    verifyChallenge: jest.fn(),
    requestPasswordReset: jest.fn(),
    verifyRecoveryCode: jest.fn(),
    resetPassword: jest.fn(),
    getUserByPublicKey: jest.fn(),
  },
}));

jest.mock('../socialAuth', () => ({
  __esModule: true,
  default: express.Router(),
}));

import cookieParser from 'cookie-parser';
import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
} from '../../services/refreshToken.service';
// sha256Hex is the REAL implementation (the oauthCode mock spreads `...actual`),
// matching exactly what the refresh service uses to hash presented tokens.
import { sha256Hex } from '../../services/oauthCode.service';
import type { Response } from 'express';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
  setCookie: string[];
}

/**
 * Cookie-aware JSON request helper. Sends an optional `Cookie` header and
 * returns the parsed body plus the raw `set-cookie` array so tests can assert
 * rotation / clearing behaviour like a browser would observe it.
 */
async function requestJson(
  server: http.Server,
  method: string,
  path: string,
  payload: unknown,
  cookieHeader?: string
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    };
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }
    const req = http.request(
      { method, host: '127.0.0.1', port: address.port, path, headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          // Some middleware (e.g. the rate limiter) responds with a plain-text
          // body. Fall back to wrapping the raw text rather than rejecting, so
          // status-code assertions on non-JSON responses still work.
          let parsed: Record<string, unknown>;
          if (raw.length === 0) {
            parsed = {};
          } else {
            try {
              parsed = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              parsed = { _raw: raw };
            }
          }
          const setCookie = res.headers['set-cookie'] ?? [];
          resolve({
            status: res.statusCode ?? 0,
            body: parsed,
            setCookie: Array.isArray(setCookie) ? setCookie : [setCookie],
          });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Extract the value of the `oxy_rt` cookie from a `set-cookie` array. */
function extractRefreshCookieValue(setCookie: string[]): string | undefined {
  const header = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!header) return undefined;
  const firstPair = header.split(';')[0];
  return firstPair.slice(`${REFRESH_COOKIE_NAME}=`.length);
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
});

function buildStoredToken(rawToken: string, overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    _id: 'rt-id-1',
    tokenHash: sha256Hex(rawToken),
    sessionId: 'sess-123',
    userId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3d4' },
    family: 'fam-1',
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('POST /auth/refresh', () => {
  it('rotates the cookie and mints an access token on a valid cookie', async () => {
    const presented = 'present-raw-token';
    const stored = buildStoredToken(presented);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    mockFindOne.mockResolvedValueOnce(stored);
    // Atomic single-use claim succeeds, returning the claimed row.
    mockFindOneAndUpdate.mockResolvedValueOnce({ ...stored, usedAt: new Date() });
    // issueRefreshToken (next token in the family) persists via create.
    mockCreate.mockResolvedValueOnce({});
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'access-jwt', expiresAt });

    const res = await requestJson(
      server,
      'POST',
      '/auth/refresh',
      {},
      `${REFRESH_COOKIE_NAME}=${presented}`
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: 'access-jwt',
      expiresAt: expiresAt.toISOString(),
    });
    // Access token minted for the session bound to the refresh token.
    expect(mockGetAccessToken).toHaveBeenCalledWith('sess-123');

    // A brand-new oxy_rt cookie is set, and its value differs from the one we
    // presented (proving rotation, not a static cookie).
    const rotated = extractRefreshCookieValue(res.setCookie);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(presented);
    expect(rotated).not.toBe('');
    // No family revocation on the happy path.
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeactivateSession).not.toHaveBeenCalled();
  });

  it('rejects a reused token, revokes the family and deactivates the session', async () => {
    const presented = 'already-used-token';
    // usedAt is set -> reuse detected (theft signal).
    const stored = buildStoredToken(presented, { usedAt: new Date(Date.now() - 1000) });

    mockFindOne.mockResolvedValueOnce(stored);
    mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 2 });
    mockDeactivateSession.mockResolvedValueOnce(true);

    const res = await requestJson(
      server,
      'POST',
      '/auth/refresh',
      {},
      `${REFRESH_COOKIE_NAME}=${presented}`
    );

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Invalid refresh token' });

    // Whole family revoked.
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { family: 'fam-1', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
    // Underlying session deactivated.
    expect(mockDeactivateSession).toHaveBeenCalledWith('sess-123');
    // No access token minted, no rotation.
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();

    // The cookie is cleared (Max-Age=0).
    const cleared = res.setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0/i);
  });

  it('returns 401 and never mints a token when no cookie is present', async () => {
    const res = await requestJson(server, 'POST', '/auth/refresh', {});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'No refresh token' });
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('returns 401 for an unknown token without revoking anything', async () => {
    mockFindOne.mockResolvedValueOnce(null);

    const res = await requestJson(
      server,
      'POST',
      '/auth/refresh',
      {},
      `${REFRESH_COOKIE_NAME}=ghost-token`
    );

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Invalid refresh token' });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });
});

// Separate express app with a real expressRateLimit(max=2) so we can verify the
// 429 path without the production Redis store.
describe('POST /auth/refresh — rate limiting', () => {
  let rateLimitedServer: http.Server;

  beforeAll((done) => {
    const limiter = expressRateLimit({
      windowMs: 60 * 1000,
      max: 2,
      standardHeaders: true,
      legacyHeaders: false,
    });

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    // Mount the limiter ahead of the route so it triggers regardless of the
    // (mocked, pass-through) in-route limiter.
    app.use('/auth/refresh', limiter);
    app.use('/auth', authRouter);
    app.use(errorHandler);
    rateLimitedServer = app.listen(0, '127.0.0.1', done);
  });

  afterAll((done) => {
    rateLimitedServer.close(done);
  });

  it('allows the first two requests and blocks the third with 429', async () => {
    // No cookie -> each allowed request returns 401, but the THIRD is blocked at
    // the limiter with 429 before the handler runs.
    const res1 = await requestJson(rateLimitedServer, 'POST', '/auth/refresh', {});
    const res2 = await requestJson(rateLimitedServer, 'POST', '/auth/refresh', {});
    const res3 = await requestJson(rateLimitedServer, 'POST', '/auth/refresh', {});

    expect(res1.status).toBe(401);
    expect(res2.status).toBe(401);
    expect(res3.status).toBe(429);
  });
});

describe('clearRefreshCookie', () => {
  it('emits a Set-Cookie for oxy_rt with Max-Age=0', () => {
    const cookies: string[] = [];
    // Minimal Response stub capturing res.cookie -> Set-Cookie serialization.
    const res = {
      cookie(name: string, value: string, options: { maxAge?: number; path?: string; domain?: string }) {
        const parts = [`${name}=${value}`];
        if (typeof options.maxAge === 'number') parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
        if (options.path) parts.push(`Path=${options.path}`);
        if (options.domain) parts.push(`Domain=${options.domain}`);
        cookies.push(parts.join('; '));
        return this;
      },
    } as unknown as Response;

    clearRefreshCookie(res);

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(new RegExp(`^${REFRESH_COOKIE_NAME}=`));
    expect(cookies[0]).toMatch(/Max-Age=0/);
    expect(cookies[0]).toContain(`Path=${'/auth/refresh'}`);
  });
});
