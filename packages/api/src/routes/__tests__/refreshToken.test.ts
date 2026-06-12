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

// ---- A tokenHash-keyed store so RefreshToken.findOne({ tokenHash }) resolves
// the matching staged row regardless of call ORDER or call COUNT. This is
// required now that /auth/refresh classifies candidates (one findOne per
// candidate) BEFORE rotating the chosen token (another findOne) — a single
// `mockResolvedValueOnce` would be exhausted by the classification pass. We can
// stage MULTIPLE rows (e.g. a used legacy + a valid new) keyed by their hash. ----
const tokenStore = new Map<string, StoredToken>();

/** Stage a stored row, keyed by its tokenHash, for findOne lookups. */
function stageToken(token: StoredToken): void {
  tokenStore.set(token.tokenHash, token);
}

const mockFindOne = jest.fn((query?: { tokenHash?: string }) => {
  const hash = query?.tokenHash;
  if (typeof hash === 'string' && tokenStore.has(hash)) {
    return Promise.resolve(tokenStore.get(hash));
  }
  return Promise.resolve(null);
});
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
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
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
  REFRESH_COOKIE_PATH,
  LEGACY_REFRESH_COOKIE_PATH,
  clearRefreshCookie,
  parseRefreshTokenCandidates,
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

/**
 * Extract the value of the real (non-empty) `oxy_rt` cookie from a `set-cookie`
 * array. Skips the legacy-delete header (`oxy_rt=;`), which also starts with the
 * cookie name but carries an empty value.
 */
function extractRefreshCookieValue(setCookie: string[]): string | undefined {
  for (const header of setCookie) {
    if (!header.startsWith(`${REFRESH_COOKIE_NAME}=`)) continue;
    const value = header.split(';')[0].slice(`${REFRESH_COOKIE_NAME}=`.length);
    if (value.length > 0) {
      return value;
    }
  }
  return undefined;
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
  tokenStore.clear();
});

/** Find the legacy-delete Set-Cookie header (Path=/auth/refresh, Max-Age=0). */
function findLegacyDeleteCookie(setCookie: string[]): string | undefined {
  return setCookie.find(
    (c) =>
      c.startsWith(`${REFRESH_COOKIE_NAME}=;`) &&
      c.includes(`Path=${LEGACY_REFRESH_COOKIE_PATH}`) &&
      /Max-Age=0/i.test(c)
  );
}

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

    stageToken(stored);
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
    // The legacy `/auth/refresh` duplicate is deleted alongside the new cookie.
    expect(findLegacyDeleteCookie(res.setCookie)).toBeDefined();
    // No family revocation on the happy path.
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeactivateSession).not.toHaveBeenCalled();
  });

  it('rejects a reused token, revokes the family and deactivates the session', async () => {
    const presented = 'already-used-token';
    // usedAt is set -> reuse detected (theft signal).
    const stored = buildStoredToken(presented, { usedAt: new Date(Date.now() - 1000) });

    stageToken(stored);
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
    // tokenStore is empty -> findOne resolves null for the ghost token.
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

  it('rotates the VALID sibling and ignores a USED legacy duplicate (stale FIRST)', async () => {
    // Mid-migration browser holds TWO oxy_rt cookies. Per RFC 6265 the longer-path
    // legacy cookie (here the USED one) is sent FIRST — the exact ordering that
    // used to log the real user out. We must rotate the VALID new sibling.
    const usedLegacy = 'used-legacy-token';
    const validNew = 'valid-new-token';
    const usedRow = buildStoredToken(usedLegacy, {
      _id: 'rt-used',
      family: 'fam-used',
      usedAt: new Date(Date.now() - 1000),
    });
    const validRow = buildStoredToken(validNew, { _id: 'rt-valid', family: 'fam-valid' });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    stageToken(usedRow);
    stageToken(validRow);
    // Atomic single-use claim of the VALID row succeeds.
    mockFindOneAndUpdate.mockResolvedValueOnce({ ...validRow, usedAt: new Date() });
    mockCreate.mockResolvedValueOnce({});
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'access-jwt', expiresAt });

    const res = await requestJson(
      server,
      'POST',
      '/auth/refresh',
      {},
      `${REFRESH_COOKIE_NAME}=${usedLegacy}; ${REFRESH_COOKIE_NAME}=${validNew}`
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accessToken: 'access-jwt', expiresAt: expiresAt.toISOString() });
    // Access token minted off the VALID sibling's session.
    expect(mockGetAccessToken).toHaveBeenCalledWith('sess-123');

    // Rotated to a brand-new value, distinct from BOTH presented cookies.
    const rotated = extractRefreshCookieValue(res.setCookie);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(usedLegacy);
    expect(rotated).not.toBe(validNew);
    // Legacy duplicate deleted.
    expect(findLegacyDeleteCookie(res.setCookie)).toBeDefined();

    // CRITICAL: the USED sibling's family was NOT revoked — no reuse-detection.
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeactivateSession).not.toHaveBeenCalled();
  });

  it('rotates the VALID sibling when it is presented FIRST (valid FIRST)', async () => {
    const validNew = 'valid-new-token';
    const usedLegacy = 'used-legacy-token';
    const validRow = buildStoredToken(validNew, { _id: 'rt-valid', family: 'fam-valid' });
    const usedRow = buildStoredToken(usedLegacy, {
      _id: 'rt-used',
      family: 'fam-used',
      usedAt: new Date(Date.now() - 1000),
    });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    stageToken(validRow);
    stageToken(usedRow);
    mockFindOneAndUpdate.mockResolvedValueOnce({ ...validRow, usedAt: new Date() });
    mockCreate.mockResolvedValueOnce({});
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'access-jwt', expiresAt });

    const res = await requestJson(
      server,
      'POST',
      '/auth/refresh',
      {},
      `${REFRESH_COOKIE_NAME}=${validNew}; ${REFRESH_COOKIE_NAME}=${usedLegacy}`
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accessToken: 'access-jwt', expiresAt: expiresAt.toISOString() });

    const rotated = extractRefreshCookieValue(res.setCookie);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(usedLegacy);
    expect(rotated).not.toBe(validNew);
    expect(findLegacyDeleteCookie(res.setCookie)).toBeDefined();

    // Still no reuse-detection — the used sibling is the same user's stale cookie.
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeactivateSession).not.toHaveBeenCalled();
  });

  it('fires reuse-detection for a LONE used token with no valid sibling', async () => {
    // A single used token with NO valid sibling is a genuine theft replay —
    // reuse-detection MUST stay intact: revoke the family + deactivate the session.
    const used = 'lone-used-token';
    const usedRow = buildStoredToken(used, { usedAt: new Date(Date.now() - 1000) });

    stageToken(usedRow);
    mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 2 });
    mockDeactivateSession.mockResolvedValueOnce(true);

    const res = await requestJson(
      server,
      'POST',
      '/auth/refresh',
      {},
      `${REFRESH_COOKIE_NAME}=${used}`
    );

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: 'Invalid refresh token' });
    // Whole family revoked + session deactivated.
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { family: 'fam-1', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
    expect(mockDeactivateSession).toHaveBeenCalledWith('sess-123');
    // The token was NOT rotated.
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('rotates a single valid cookie (regression)', async () => {
    const presented = 'single-valid-token';
    const stored = buildStoredToken(presented);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    stageToken(stored);
    mockFindOneAndUpdate.mockResolvedValueOnce({ ...stored, usedAt: new Date() });
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
    expect(res.body).toEqual({ accessToken: 'access-jwt', expiresAt: expiresAt.toISOString() });
    expect(mockGetAccessToken).toHaveBeenCalledWith('sess-123');
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeactivateSession).not.toHaveBeenCalled();
  });
});

describe('parseRefreshTokenCandidates', () => {
  it('returns both oxy_rt values in header order (stale FIRST)', () => {
    const header = `${REFRESH_COOKIE_NAME}=AAA; ${REFRESH_COOKIE_NAME}=BBB`;
    expect(parseRefreshTokenCandidates(header)).toEqual(['AAA', 'BBB']);
  });

  it('returns both oxy_rt values in header order (valid FIRST)', () => {
    const header = `${REFRESH_COOKIE_NAME}=BBB; ${REFRESH_COOKIE_NAME}=AAA`;
    expect(parseRefreshTokenCandidates(header)).toEqual(['BBB', 'AAA']);
  });

  it('returns a single value for one cookie', () => {
    expect(parseRefreshTokenCandidates(`${REFRESH_COOKIE_NAME}=ONLY`)).toEqual(['ONLY']);
  });

  it('returns an empty array for an undefined or empty header', () => {
    expect(parseRefreshTokenCandidates(undefined)).toEqual([]);
    expect(parseRefreshTokenCandidates('')).toEqual([]);
  });

  it('ignores other cookie names and surrounding whitespace', () => {
    const header = `theme=dark; ${REFRESH_COOKIE_NAME}=TOKEN ; other=oxy_rt_lookalike`;
    expect(parseRefreshTokenCandidates(header)).toEqual(['TOKEN']);
  });

  it('de-dupes identical values, preserving first-seen order', () => {
    const header = `${REFRESH_COOKIE_NAME}=DUP; ${REFRESH_COOKIE_NAME}=DUP; ${REFRESH_COOKIE_NAME}=NEW`;
    expect(parseRefreshTokenCandidates(header)).toEqual(['DUP', 'NEW']);
  });

  it('skips empty oxy_rt values', () => {
    const header = `${REFRESH_COOKIE_NAME}=; ${REFRESH_COOKIE_NAME}=REAL`;
    expect(parseRefreshTokenCandidates(header)).toEqual(['REAL']);
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
  it('emits a Set-Cookie clearing oxy_rt on BOTH paths with Max-Age=0', () => {
    const cookies: string[] = [];
    // Minimal Response stub capturing res.cookie -> Set-Cookie serialization AND
    // res.append('Set-Cookie', ...) for the appended legacy-delete header.
    const res = {
      cookie(name: string, value: string, options: { maxAge?: number; path?: string; domain?: string }) {
        const parts = [`${name}=${value}`];
        if (typeof options.maxAge === 'number') parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
        if (options.path) parts.push(`Path=${options.path}`);
        if (options.domain) parts.push(`Domain=${options.domain}`);
        cookies.push(parts.join('; '));
        return this;
      },
      append(_field: string, value: string | string[]) {
        if (Array.isArray(value)) {
          cookies.push(...value);
        } else {
          cookies.push(value);
        }
        return this;
      },
    } as unknown as Response;

    clearRefreshCookie(res);

    // The real cookie clear targets Path=/auth with Max-Age=0.
    const primaryClear = cookies.find(
      (c) =>
        c.startsWith(`${REFRESH_COOKIE_NAME}=`) &&
        c.includes(`Path=${REFRESH_COOKIE_PATH}`) &&
        /Max-Age=0/.test(c)
    );
    expect(primaryClear).toBeDefined();

    // The legacy `/auth/refresh` duplicate is ALSO cleared (appended header).
    const legacyClear = cookies.find(
      (c) =>
        c.startsWith(`${REFRESH_COOKIE_NAME}=`) &&
        c.includes(`Path=${LEGACY_REFRESH_COOKIE_PATH}`) &&
        /Max-Age=0/.test(c)
    );
    expect(legacyClear).toBeDefined();
  });
});
