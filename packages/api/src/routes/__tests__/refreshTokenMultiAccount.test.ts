/**
 * POST /auth/refresh — Google-style multi-account (`?authuser=N`) tests.
 *
 * Complements the legacy single-cookie tests in `refreshToken.test.ts` by
 * exercising the indexed-slot resolution rules:
 *   - `?authuser=N` rotates ONLY the matching `oxy_rt_N` cookie; siblings are
 *     untouched (no extra Set-Cookie for them).
 *   - `?authuser=N` with no matching cookie -> 401, never 200.
 *   - `?authuser=foo` (malformed) -> 400.
 *   - No param, mixed `oxy_rt_0` + `oxy_rt_1` present -> rotates the lowest
 *     indexed slot (oxy_rt_0).
 *   - No param, only legacy `oxy_rt` -> rotates legacy (compat).
 *
 * The setup mirrors `refreshToken.test.ts`: real refresh-service rotation
 * logic, mocked RefreshToken MODEL + session.service.
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

const tokenStore = new Map<string, StoredToken>();

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
  default: { findOne: jest.fn(), find: jest.fn() },
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
  formatUserResponse: jest.fn((u: { _id: { toString(): string } }) => ({ id: u._id.toString() })),
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
import { sha256Hex } from '../../services/oauthCode.service';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
  setCookie: string[];
}

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
      origin: 'https://accounts.oxy.so',
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
    userId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3d4' },
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
});

/** Extract the indexed `oxy_rt_${n}` cookie value if set (skip Max-Age=0 clears). */
function extractIndexedCookieValue(setCookie: string[], authuser: number): string | undefined {
  const name = `oxy_rt_${authuser}=`;
  for (const header of setCookie) {
    if (!header.startsWith(name)) continue;
    if (/Max-Age=0/i.test(header)) continue;
    const value = header.split(';')[0].slice(name.length);
    if (value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function hasSetCookieForName(setCookie: string[], name: string): boolean {
  return setCookie.some((h) => h.startsWith(`${name}=`));
}

describe('POST /auth/refresh — multi-account (?authuser=)', () => {
  it('rotates ONLY oxy_rt_0 when ?authuser=0 with a valid cookie', async () => {
    const presented = 'tok-zero';
    stageToken(buildStoredToken(presented, { sessionId: 'sess-zero', family: 'fam-zero' }));
    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: 'rt-id-1',
      family: 'fam-zero',
      sessionId: 'sess-zero',
      userId: { toString: () => 'u0' },
      usedAt: new Date(),
    });
    mockCreate.mockResolvedValueOnce({});
    mockGetAccessToken.mockResolvedValueOnce({
      accessToken: 'a0',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const res = await requestJson(
      server,
      'POST',
      '/auth/refresh?authuser=0',
      {},
      `oxy_rt_0=${presented}`
    );

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('a0');
    expect(res.body.authuser).toBe(0);
    expect(mockGetAccessToken).toHaveBeenCalledWith('sess-zero');

    const rotated = extractIndexedCookieValue(res.setCookie, 0);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(presented);

    // No sibling slot was touched.
    expect(hasSetCookieForName(res.setCookie, 'oxy_rt_1')).toBe(false);
  });

  it('returns 401 when ?authuser=2 is requested but no matching cookie is presented', async () => {
    // Only oxy_rt_0 exists; ?authuser=2 picks an empty slot.
    stageToken(buildStoredToken('tok-zero'));

    const res = await requestJson(
      server,
      'POST',
      '/auth/refresh?authuser=2',
      {},
      'oxy_rt_0=tok-zero'
    );

    expect(res.status).toBe(401);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    // Critically: the OTHER slot's cookie is not affected.
    expect(hasSetCookieForName(res.setCookie, 'oxy_rt_0')).toBe(false);
  });

  it('returns 400 when ?authuser=foo is malformed', async () => {
    const res = await requestJson(server, 'POST', '/auth/refresh?authuser=foo', {});
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('returns 400 when ?authuser=-1 is out of range', async () => {
    const res = await requestJson(server, 'POST', '/auth/refresh?authuser=-1', {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when ?authuser=10 (>= MAX_DEVICE_ACCOUNTS) is out of range', async () => {
    const res = await requestJson(server, 'POST', '/auth/refresh?authuser=10', {});
    expect(res.status).toBe(400);
  });

  it('without a param + oxy_rt_0 + oxy_rt_1 -> rotates the LOWEST indexed slot (0)', async () => {
    const tokZero = 'tok-zero';
    const tokOne = 'tok-one';
    stageToken(buildStoredToken(tokZero, { _id: 'rt-zero', family: 'fam-zero', sessionId: 'sess-zero' }));
    stageToken(buildStoredToken(tokOne, { _id: 'rt-one', family: 'fam-one', sessionId: 'sess-one' }));
    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: 'rt-zero',
      family: 'fam-zero',
      sessionId: 'sess-zero',
      userId: { toString: () => 'u0' },
      usedAt: new Date(),
    });
    mockCreate.mockResolvedValueOnce({});
    mockGetAccessToken.mockResolvedValueOnce({
      accessToken: 'a0',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const res = await requestJson(
      server,
      'POST',
      '/auth/refresh',
      {},
      `oxy_rt_0=${tokZero}; oxy_rt_1=${tokOne}`
    );

    expect(res.status).toBe(200);
    expect(res.body.authuser).toBe(0);
    expect(mockGetAccessToken).toHaveBeenCalledWith('sess-zero');

    // oxy_rt_0 rotated; oxy_rt_1 NOT touched.
    expect(extractIndexedCookieValue(res.setCookie, 0)).toBeDefined();
    expect(hasSetCookieForName(res.setCookie, 'oxy_rt_1')).toBe(false);
  });

  it('without a param + only legacy oxy_rt -> rotates legacy (back-compat)', async () => {
    const tok = 'legacy-tok';
    stageToken(buildStoredToken(tok, { family: 'fam-legacy', sessionId: 'sess-legacy' }));
    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: 'rt-legacy',
      family: 'fam-legacy',
      sessionId: 'sess-legacy',
      userId: { toString: () => 'u-legacy' },
      usedAt: new Date(),
    });
    mockCreate.mockResolvedValueOnce({});
    mockGetAccessToken.mockResolvedValueOnce({
      accessToken: 'a-legacy',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const res = await requestJson(server, 'POST', '/auth/refresh', {}, `oxy_rt=${tok}`);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('a-legacy');
    // No `authuser` field in the response (legacy path).
    expect(res.body.authuser).toBeUndefined();

    // A new oxy_rt cookie was re-emitted.
    const newLegacy = res.setCookie.find(
      (h) => h.startsWith('oxy_rt=') && !/Max-Age=0/i.test(h)
    );
    expect(newLegacy).toBeDefined();
  });

  it('rotates one slot but leaves the OTHER slot intact (no spurious Set-Cookie for the sibling)', async () => {
    // Both slots presented, rotate only oxy_rt_0 — oxy_rt_1 must not get a
    // Set-Cookie (clear or otherwise) in the response.
    const tokZero = 'tok-zero';
    const tokOne = 'tok-one';
    stageToken(buildStoredToken(tokZero, { _id: 'rt-zero', family: 'fam-zero', sessionId: 'sess-zero' }));
    stageToken(buildStoredToken(tokOne, { _id: 'rt-one', family: 'fam-one', sessionId: 'sess-one' }));
    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: 'rt-zero',
      family: 'fam-zero',
      sessionId: 'sess-zero',
      userId: { toString: () => 'u0' },
      usedAt: new Date(),
    });
    mockCreate.mockResolvedValueOnce({});
    mockGetAccessToken.mockResolvedValueOnce({
      accessToken: 'a0',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const res = await requestJson(
      server,
      'POST',
      '/auth/refresh?authuser=0',
      {},
      `oxy_rt_0=${tokZero}; oxy_rt_1=${tokOne}`
    );

    expect(res.status).toBe(200);
    expect(extractIndexedCookieValue(res.setCookie, 0)).toBeDefined();
    expect(hasSetCookieForName(res.setCookie, 'oxy_rt_1')).toBe(false);
    // Other slot's family was not touched.
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeactivateSession).not.toHaveBeenCalled();
  });
});
