/**
 * POST /auth/refresh-all tests (Google-style multi-account rebuild).
 *
 * Mirrors the setup of `refreshToken.test.ts`: real refresh-service rotation
 * logic, mocked RefreshToken MODEL + session.service + User model. Covers:
 *
 *   - 0 cookies -> { accounts: [] }
 *   - 1 indexed cookie -> 1 account with `user.color` populated
 *   - 3 indexed cookies -> 3 accounts in `authuser` ASC order
 *   - mixed (1 corrupted + 2 valid) -> 2 accounts, the bad one logged (warn)
 *   - reuse-detection on ONE slot does not affect siblings
 *   - non-allowlisted Origin -> 403 BAD_ORIGIN regression
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

const userStore = new Map<
  string,
  {
    _id: string;
    username: string;
    color?: string;
    email?: string;
    name?: { first?: string; last?: string; full?: string };
  }
>();
function stageUser(
  id: string,
  data: {
    username: string;
    color?: string;
    email?: string;
    name?: { first?: string; last?: string; full?: string };
  }
): void {
  userStore.set(id, { _id: id, ...data });
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

// User.findById(...).select(...).lean()
const mockUserFindById = jest.fn((id: string) => {
  const value = userStore.get(id);
  return {
    select: () => ({
      lean: () => Promise.resolve(value ?? null),
    }),
  };
});

jest.mock('../../models/RefreshToken', () => ({
  __esModule: true,
  default: {
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
  User: { findById: (id: string) => mockUserFindById(id), findOne: jest.fn() },
  default: { findById: (id: string) => mockUserFindById(id), findOne: jest.fn() },
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

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findOne: jest.fn() },
  default: { findOne: jest.fn() },
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: jest.fn() },
  default: { findOne: jest.fn() },
}));

// REAL formatUserResponse so we can assert user.color reaches the response.
jest.mock('../../utils/userTransform', () => {
  const actual = jest.requireActual('../../utils/userTransform');
  return { __esModule: true, ...actual };
});

jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: jest.fn(),
}));

const loggerMock = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../../utils/logger', () => ({ logger: loggerMock }));

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
  opts: { cookieHeader?: string; origin?: string } = {}
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      origin: opts.origin ?? 'https://accounts.oxy.so',
    };
    if (opts.cookieHeader) {
      headers.cookie = opts.cookieHeader;
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
    _id: `rt-${rawToken.slice(0, 6)}`,
    tokenHash: sha256Hex(rawToken),
    sessionId: 'sess-1',
    userId: { toString: () => 'u1' },
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
  userStore.clear();
  loggerMock.warn.mockClear();
});

describe('POST /auth/refresh-all', () => {
  it('returns { accounts: [] } when no refresh cookies are presented', async () => {
    const res = await requestJson(server, 'POST', '/auth/refresh-all', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accounts: [] });
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('returns one account with user.color populated for a single indexed cookie', async () => {
    const tok = 'tok-zero';
    stageToken(buildStoredToken(tok, { sessionId: 'sess-zero', family: 'fam-zero', userId: { toString: () => 'u-zero' } }));
    stageUser('u-zero', { username: 'alice', color: '#FF00AA', email: 'a@x.test' });
    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: 'rt-zero',
      family: 'fam-zero',
      sessionId: 'sess-zero',
      userId: { toString: () => 'u-zero' },
      usedAt: new Date(),
    });
    mockCreate.mockResolvedValueOnce({});
    const exp = new Date(Date.now() + 15 * 60 * 1000);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'a-zero', expiresAt: exp });

    const res = await requestJson(server, 'POST', '/auth/refresh-all', {}, {
      cookieHeader: `oxy_rt_0=${tok}`,
    });

    expect(res.status).toBe(200);
    const accounts = res.body.accounts as Array<Record<string, unknown>>;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].authuser).toBe(0);
    expect(accounts[0].accessToken).toBe('a-zero');
    expect(accounts[0].sessionId).toBe('sess-zero');
    expect((accounts[0].user as { color?: string }).color).toBe('#FF00AA');
    expect((accounts[0].user as { username?: string }).username).toBe('alice');
  });

  it('composes user.name.full from a lean doc (no virtual) so the switcher shows the real name', async () => {
    // Regression for the account-switcher bug: the lean .select() read carries
    // only name.first / name.last (NO `full` virtual). formatUserResponse must
    // still compose `name.full` so the IdP switcher shows the correctly-cased
    // composed name instead of falling back to the lowercase username.
    const tok = 'tok-named';
    stageToken(buildStoredToken(tok, { sessionId: 'sess-named', family: 'fam-named', userId: { toString: () => 'u-named' } }));
    stageUser('u-named', { username: 'janedoe', color: '#ABCDEF', name: { first: 'Jane', last: 'Doe' } });
    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: 'rt-named',
      family: 'fam-named',
      sessionId: 'sess-named',
      userId: { toString: () => 'u-named' },
      usedAt: new Date(),
    });
    mockCreate.mockResolvedValueOnce({});
    mockGetAccessToken.mockResolvedValueOnce({
      accessToken: 'a-named',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const res = await requestJson(server, 'POST', '/auth/refresh-all', {}, {
      cookieHeader: `oxy_rt_0=${tok}`,
    });

    expect(res.status).toBe(200);
    const accounts = res.body.accounts as Array<Record<string, unknown>>;
    expect(accounts).toHaveLength(1);
    const user = accounts[0].user as { name?: { first?: string; last?: string; full?: string } };
    expect(user.name?.first).toBe('Jane');
    expect(user.name?.last).toBe('Doe');
    expect(user.name?.full).toBe('Jane Doe');
  });

  it('returns three accounts in authuser ASC order for three indexed cookies', async () => {
    for (const i of [2, 0, 1]) {
      const tok = `tok-${i}`;
      stageToken(buildStoredToken(tok, {
        _id: `rt-${i}`,
        sessionId: `sess-${i}`,
        family: `fam-${i}`,
        userId: { toString: () => `u-${i}` },
      }));
      stageUser(`u-${i}`, { username: `user${i}`, color: `#0000${i}${i}` });
    }
    mockFindOneAndUpdate
      .mockResolvedValueOnce({ _id: 'rt-0', family: 'fam-0', sessionId: 'sess-0', userId: { toString: () => 'u-0' }, usedAt: new Date() })
      .mockResolvedValueOnce({ _id: 'rt-1', family: 'fam-1', sessionId: 'sess-1', userId: { toString: () => 'u-1' }, usedAt: new Date() })
      .mockResolvedValueOnce({ _id: 'rt-2', family: 'fam-2', sessionId: 'sess-2', userId: { toString: () => 'u-2' }, usedAt: new Date() });
    mockCreate.mockResolvedValue({});
    const exp = new Date(Date.now() + 15 * 60 * 1000);
    mockGetAccessToken
      .mockResolvedValueOnce({ accessToken: 'a-0', expiresAt: exp })
      .mockResolvedValueOnce({ accessToken: 'a-1', expiresAt: exp })
      .mockResolvedValueOnce({ accessToken: 'a-2', expiresAt: exp });

    // Cookie header order: 2, 0, 1 — server must reorder to 0, 1, 2.
    const res = await requestJson(server, 'POST', '/auth/refresh-all', {}, {
      cookieHeader: 'oxy_rt_2=tok-2; oxy_rt_0=tok-0; oxy_rt_1=tok-1',
    });

    expect(res.status).toBe(200);
    const accounts = res.body.accounts as Array<{ authuser: number; accessToken: string }>;
    expect(accounts).toHaveLength(3);
    expect(accounts.map((a) => a.authuser)).toEqual([0, 1, 2]);
    expect(accounts.map((a) => a.accessToken)).toEqual(['a-0', 'a-1', 'a-2']);
  });

  it('excludes a corrupted slot but returns the other two valid ones and logs a warning', async () => {
    // Slot 0: corrupted (unknown token hash -> classify=none) -> excluded.
    // Slots 1 and 2: valid -> included.
    const tok1 = 'tok-one';
    const tok2 = 'tok-two';
    stageToken(buildStoredToken(tok1, {
      _id: 'rt-1', sessionId: 'sess-1', family: 'fam-1',
      userId: { toString: () => 'u-1' },
    }));
    stageToken(buildStoredToken(tok2, {
      _id: 'rt-2', sessionId: 'sess-2', family: 'fam-2',
      userId: { toString: () => 'u-2' },
    }));
    stageUser('u-1', { username: 'one', color: '#111111' });
    stageUser('u-2', { username: 'two', color: '#222222' });
    mockFindOneAndUpdate
      .mockResolvedValueOnce({ _id: 'rt-1', family: 'fam-1', sessionId: 'sess-1', userId: { toString: () => 'u-1' }, usedAt: new Date() })
      .mockResolvedValueOnce({ _id: 'rt-2', family: 'fam-2', sessionId: 'sess-2', userId: { toString: () => 'u-2' }, usedAt: new Date() });
    mockCreate.mockResolvedValue({});
    const exp = new Date(Date.now() + 15 * 60 * 1000);
    mockGetAccessToken
      .mockResolvedValueOnce({ accessToken: 'a-1', expiresAt: exp })
      .mockResolvedValueOnce({ accessToken: 'a-2', expiresAt: exp });

    const res = await requestJson(server, 'POST', '/auth/refresh-all', {}, {
      cookieHeader: 'oxy_rt_0=ghost-garbage; oxy_rt_1=tok-one; oxy_rt_2=tok-two',
    });

    expect(res.status).toBe(200);
    const accounts = res.body.accounts as Array<{ authuser: number }>;
    expect(accounts.map((a) => a.authuser)).toEqual([1, 2]);
  });

  it('reuse-detection on one slot does NOT affect other slots', async () => {
    const tokGood = 'tok-good';
    const tokBad = 'tok-bad-used';
    stageToken(buildStoredToken(tokGood, {
      _id: 'rt-good', sessionId: 'sess-good', family: 'fam-good',
      userId: { toString: () => 'u-good' },
    }));
    stageToken(buildStoredToken(tokBad, {
      _id: 'rt-bad', sessionId: 'sess-bad', family: 'fam-bad',
      userId: { toString: () => 'u-bad' },
      usedAt: new Date(Date.now() - 1000),
    }));
    stageUser('u-good', { username: 'good', color: '#00ff00' });

    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: 'rt-good',
      family: 'fam-good',
      sessionId: 'sess-good',
      userId: { toString: () => 'u-good' },
      usedAt: new Date(),
    });
    mockCreate.mockResolvedValueOnce({});
    mockGetAccessToken.mockResolvedValueOnce({
      accessToken: 'a-good',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    mockUpdateMany.mockResolvedValueOnce({ modifiedCount: 1 });
    mockDeactivateSession.mockResolvedValueOnce(true);

    const res = await requestJson(server, 'POST', '/auth/refresh-all', {}, {
      cookieHeader: `oxy_rt_0=${tokGood}; oxy_rt_1=${tokBad}`,
    });

    expect(res.status).toBe(200);
    const accounts = res.body.accounts as Array<{ authuser: number; accessToken: string }>;
    expect(accounts).toHaveLength(1);
    expect(accounts[0].authuser).toBe(0);
    expect(accounts[0].accessToken).toBe('a-good');

    // The bad slot's family was revoked + its session deactivated, but the
    // good slot was not.
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { family: 'fam-bad', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
    expect(mockDeactivateSession).toHaveBeenCalledWith('sess-bad');
  });

  it('rejects a non-allowlisted Origin with 403 BAD_ORIGIN (regression)', async () => {
    const res = await requestJson(server, 'POST', '/auth/refresh-all', {}, {
      cookieHeader: 'oxy_rt_0=anything',
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: 'BAD_ORIGIN',
        message: 'Request origin is not allowed for this endpoint',
      },
    });
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
