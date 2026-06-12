/**
 * POST /auth/session and POST /auth/logout tests
 * (first-party refresh-cookie establishment + revocation)
 *
 * Exercises the REAL `refreshToken.service` and the REAL route handlers. Only
 * the `RefreshToken` MODEL, `session.service`, `authUtils`, and `authMiddleware`
 * are mocked — so cookie minting, family revocation, and session deactivation
 * are all under test.
 *
 * `/auth/session`:
 *  - bearer-authenticated (authMiddleware sets req.user + next): mints + sets an
 *    `oxy_rt` cookie (Path=/auth) for the session derived ONLY from the caller's
 *    own bearer token, and returns { accessToken, expiresAt }.
 *  - invalid/missing bearer (authMiddleware responds 401): 401, no cookie minted.
 *
 * `/auth/logout`:
 *  - with a known `oxy_rt` cookie: 200 { success: true }, family revoked
 *    (updateMany), session deactivated, cookie cleared (Max-Age=0, Path=/auth).
 *  - with NO cookie: still 200 { success: true }, cookie-clear emitted, no
 *    updateMany / no deactivateSession.
 *  - with an UNKNOWN cookie (findOne -> null): 200 { success: true }, cookie
 *    cleared, no updateMany.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

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
// the matching staged row regardless of call ORDER or call COUNT. Logout now
// revokes EVERY presented candidate's family (a mid-migration browser can send a
// legacy + a new oxy_rt cookie), so we stage one row per token. ----
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

const mockExtractToken = jest.fn();
const mockDecodeToken = jest.fn();

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

// ---- authMiddleware is a CONFIGURABLE pass-through driven by `authBehavior`. ----
// `pass` sets req.user + calls next() (simulates a valid bearer); `reject`
// responds 401 without calling next (simulates a missing/invalid bearer).
type AuthBehavior = 'pass' | 'reject';
let authBehavior: AuthBehavior = 'pass';
const TEST_USER_ID = '64f7c2a1b8e9d3f4a1c2b3d4';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: express.Request, res: express.Response, next: () => void) => {
    if (authBehavior === 'reject') {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    (req as express.Request & { user?: { _id: string } }).user = { _id: TEST_USER_ID };
    next();
  },
  serviceAuthMiddleware: jest.fn(),
}));

// ---- authUtils: the route reads the bearer token and decodes it from here. ----
jest.mock('../../middleware/authUtils', () => ({
  extractTokenFromRequest: (...args: unknown[]) => mockExtractToken(...args),
  decodeToken: (...args: unknown[]) => mockDecodeToken(...args),
}));

// ---- Module mocks required for the auth route module to load (mirrors refreshToken.test.ts) ----
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
} from '../../services/refreshToken.service';
// sha256Hex is the REAL implementation (the oauthCode mock spreads `...actual`),
// matching exactly what the refresh service uses to hash presented tokens.
import { sha256Hex } from '../../services/oauthCode.service';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
  setCookie: string[];
}

/**
 * Cookie-aware JSON request helper. Sends optional Cookie + Authorization
 * headers and returns the parsed body plus the raw `set-cookie` array.
 */
async function requestJson(
  srv: http.Server,
  method: string,
  path: string,
  payload: unknown,
  opts: { cookieHeader?: string; bearer?: string } = {}
): Promise<JsonResponse> {
  const address = srv.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    };
    if (opts.cookieHeader) {
      headers.cookie = opts.cookieHeader;
    }
    if (opts.bearer) {
      headers.authorization = `Bearer ${opts.bearer}`;
    }
    const req = http.request(
      { method, host: '127.0.0.1', port: address.port, path, headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
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

function buildStoredToken(rawToken: string, overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    _id: 'rt-id-1',
    tokenHash: sha256Hex(rawToken),
    sessionId: 'sess-123',
    userId: { toString: () => TEST_USER_ID },
    family: 'fam-1',
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...overrides,
  };
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
  authBehavior = 'pass';
});

/** Find a Max-Age=0 oxy_rt clear Set-Cookie scoped to the given path. */
function findClearForPath(setCookie: string[], path: string): string | undefined {
  return setCookie.find(
    (c) =>
      c.startsWith(`${REFRESH_COOKIE_NAME}=`) &&
      c.includes(`Path=${path}`) &&
      /Max-Age=0/i.test(c)
  );
}

describe('POST /auth/session', () => {
  it('mints + sets the oxy_rt cookie for the bearer-authenticated session', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    // The route reads the bearer token then decodes it to derive the sessionId.
    mockExtractToken.mockReturnValueOnce('bearer-access-jwt');
    mockDecodeToken.mockReturnValueOnce({ sessionId: 'sess-123', userId: TEST_USER_ID });
    // issueAndSetRefreshCookie -> issueRefreshToken -> RefreshToken.create.
    mockCreate.mockResolvedValueOnce({});
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'access-jwt', expiresAt });

    const res = await requestJson(server, 'POST', '/auth/session', {}, { bearer: 'bearer-access-jwt' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: 'access-jwt',
      expiresAt: expiresAt.toISOString(),
    });
    // Access token minted for the session derived from the caller's own token.
    expect(mockGetAccessToken).toHaveBeenCalledWith('sess-123');
    // A refresh cookie was minted (persisted) and bound to that session + user.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-123', userId: TEST_USER_ID })
    );

    // The oxy_rt cookie is set with Path=/auth.
    const cookie = res.setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('Path=/auth');
    // Value is a real token, not empty (i.e. not a clear).
    const value = (cookie as string).split(';')[0].slice(`${REFRESH_COOKIE_NAME}=`.length);
    expect(value.length).toBeGreaterThan(0);
  });

  it('returns 401 and mints no cookie when the bearer is missing/invalid', async () => {
    // authMiddleware rejects before the handler runs.
    authBehavior = 'reject';

    const res = await requestJson(server, 'POST', '/auth/session', {});

    expect(res.status).toBe(401);
    // No cookie minted, no access token issued — the handler never ran.
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    const cookie = res.setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(cookie).toBeUndefined();
  });
});

describe('POST /auth/logout', () => {
  it('revokes the family + deactivates the session and clears the cookie when a known cookie is present', async () => {
    const presented = 'present-raw-token';
    const stored = buildStoredToken(presented);
    stageToken(stored);
    mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 2 });
    mockDeactivateSession.mockResolvedValueOnce(true);

    const res = await requestJson(
      server,
      'POST',
      '/auth/logout',
      {},
      { cookieHeader: `${REFRESH_COOKIE_NAME}=${presented}` }
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // The whole family is revoked server-side.
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { family: 'fam-1', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
    // The underlying session is deactivated.
    expect(mockDeactivateSession).toHaveBeenCalledWith('sess-123');

    // The cookie is cleared on BOTH paths (Max-Age=0).
    expect(findClearForPath(res.setCookie, REFRESH_COOKIE_PATH)).toBeDefined();
    expect(findClearForPath(res.setCookie, LEGACY_REFRESH_COOKIE_PATH)).toBeDefined();
  });

  it('revokes BOTH families and clears both paths for duplicate cookies (legacy + new)', async () => {
    // A mid-migration browser sends a legacy `/auth/refresh` cookie AND a new
    // `/auth` cookie — both belong to THIS signing-out user, so logout revokes
    // every presented candidate's family.
    const legacy = 'legacy-raw-token';
    const current = 'current-raw-token';
    const legacyRow = buildStoredToken(legacy, { _id: 'rt-legacy', family: 'fam-legacy', sessionId: 'sess-legacy' });
    const currentRow = buildStoredToken(current, { _id: 'rt-current', family: 'fam-current', sessionId: 'sess-current' });
    stageToken(legacyRow);
    stageToken(currentRow);
    mockUpdateMany.mockResolvedValue({ modifiedCount: 1 });
    mockDeactivateSession.mockResolvedValue(true);

    const res = await requestJson(
      server,
      'POST',
      '/auth/logout',
      {},
      { cookieHeader: `${REFRESH_COOKIE_NAME}=${legacy}; ${REFRESH_COOKIE_NAME}=${current}` }
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    // BOTH families are revoked server-side.
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { family: 'fam-legacy', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { family: 'fam-current', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
    // Both underlying sessions are deactivated.
    expect(mockDeactivateSession).toHaveBeenCalledWith('sess-legacy');
    expect(mockDeactivateSession).toHaveBeenCalledWith('sess-current');

    // The cookie is cleared on BOTH paths (Max-Age=0).
    expect(findClearForPath(res.setCookie, REFRESH_COOKIE_PATH)).toBeDefined();
    expect(findClearForPath(res.setCookie, LEGACY_REFRESH_COOKIE_PATH)).toBeDefined();
  });

  it('still succeeds and clears the cookie when no cookie is present', async () => {
    const res = await requestJson(server, 'POST', '/auth/logout', {});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // Nothing to revoke.
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeactivateSession).not.toHaveBeenCalled();
    // The cookie-clear Set-Cookie is still emitted.
    const cleared = res.setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0/i);
  });

  it('succeeds and clears the cookie for an unknown cookie without revoking anything', async () => {
    // Stored row not found -> nothing to revoke, but logout still clears.
    mockFindOne.mockResolvedValueOnce(null);

    const res = await requestJson(
      server,
      'POST',
      '/auth/logout',
      {},
      { cookieHeader: `${REFRESH_COOKIE_NAME}=ghost-token` }
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeactivateSession).not.toHaveBeenCalled();
    const cleared = res.setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0/i);
  });
});
