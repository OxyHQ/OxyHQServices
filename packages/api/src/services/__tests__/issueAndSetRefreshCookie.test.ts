/**
 * `issueAndSetRefreshCookie` slot-allocation tests.
 *
 * Exercises the Google-style "next-free / reuse / LRU-evict" decision tree:
 *
 *   - First login on a clean device -> authuser=0.
 *   - Second login (different user) -> authuser=1.
 *   - Re-login of an already-mapped userId -> reuses that exact slot AND
 *     revokes the old family.
 *   - 11th login when slots 0..9 are full -> LRU slot evicted, its family
 *     revoked, new token written into that index.
 *
 * `setRefreshCookie` writes through `res.cookie(...)`; we use the same minimal
 * Response stub the existing tests use to introspect the call.
 */

interface StoredToken {
  _id: string;
  tokenHash: string;
  sessionId: string;
  userId: { toString(): string };
  family: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}

const tokenStore = new Map<string, StoredToken>();
function stage(token: StoredToken): void {
  tokenStore.set(token.tokenHash, token);
}

const sessionStore = new Map<string, { sessionId: string; deviceInfo?: { lastActive?: Date }; createdAt?: Date }>();
function stageSession(s: { sessionId: string; lastActive?: Date; createdAt?: Date }): void {
  sessionStore.set(s.sessionId, {
    sessionId: s.sessionId,
    deviceInfo: s.lastActive ? { lastActive: s.lastActive } : undefined,
    createdAt: s.createdAt,
  });
}

const mockTokenFindOne = jest.fn((query?: { tokenHash?: string }) => {
  const hash = query?.tokenHash;
  if (typeof hash === 'string' && tokenStore.has(hash)) {
    return Promise.resolve(tokenStore.get(hash));
  }
  return Promise.resolve(null);
});

const mockTokenCreate = jest.fn(async (_doc: Record<string, unknown>) => undefined);
const mockTokenUpdateMany = jest.fn(async () => ({ modifiedCount: 1 }));

const mockSessionFindOne = jest.fn((query: { sessionId: string }) => {
  const value = sessionStore.get(query.sessionId) ?? null;
  return {
    select: () => ({
      lean: () => Promise.resolve(value),
    }),
  };
});

const mockGetAccessToken = jest.fn();
const mockDeactivateSession = jest.fn(async (_id: string) => true);

jest.mock('../../models/RefreshToken', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockTokenFindOne(...args),
    findOneAndUpdate: jest.fn(),
    create: (...args: unknown[]) => mockTokenCreate(...args),
    updateMany: (...args: unknown[]) => mockTokenUpdateMany(...args),
  },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockSessionFindOne(...(args as [{ sessionId: string }])),
    find: jest.fn(),
  },
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
    deactivateSession: (...args: unknown[]) => mockDeactivateSession(...(args as [string])),
    createSession: jest.fn(),
  },
}));

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: jest.fn(), findOne: jest.fn() },
  default: { create: jest.fn(), findOne: jest.fn() },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { issueAndSetRefreshCookie, MAX_DEVICE_ACCOUNTS } from '../refreshToken.service';
import { sha256Hex } from '../oauthCode.service';
import { Response } from 'express';

interface CookieCall {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

function makeResponseStub(): { res: Response; calls: CookieCall[]; appended: string[] } {
  const calls: CookieCall[] = [];
  const appended: string[] = [];
  const res = {
    cookie: jest.fn((name: string, value: string, options?: Record<string, unknown>) => {
      calls.push({ name, value, options });
      return res;
    }),
    append: jest.fn((field: string, value: string | string[]) => {
      if (field.toLowerCase() === 'set-cookie') {
        if (Array.isArray(value)) {
          appended.push(...value);
        } else {
          appended.push(value);
        }
      }
      return res;
    }),
    clearCookie: jest.fn(),
    setHeader: jest.fn(),
    getHeader: jest.fn(),
  } as unknown as Response;
  return { res, calls, appended };
}

function buildStored(rawToken: string, overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    _id: `rt-${rawToken.slice(0, 6)}`,
    tokenHash: sha256Hex(rawToken),
    sessionId: 'sess-existing',
    userId: { toString: () => 'u-existing' },
    family: 'fam-existing',
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  tokenStore.clear();
  sessionStore.clear();
  mockGetAccessToken.mockResolvedValue({
    accessToken: 'minted-access',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
});

describe('issueAndSetRefreshCookie — slot allocation', () => {
  it('writes oxy_rt_0 when no cookieHeader is provided', async () => {
    const { res, calls } = makeResponseStub();
    const result = await issueAndSetRefreshCookie(res, 'sess-new', 'u-new');

    expect(result.authuser).toBe(0);
    expect(result.accessToken).toBe('minted-access');
    // Exactly one cookie carries the token; the other write is the host-only
    // hardening's parent-domain (`Domain=oxy.so`) Max-Age=0 deletion.
    const tokenCookies = calls.filter((c) => c.value.length > 0);
    expect(tokenCookies).toHaveLength(1);
    expect(tokenCookies[0].name).toBe('oxy_rt_0');
  });

  it('writes oxy_rt_0 for the first multi-account login on a clean device', async () => {
    const { res, calls } = makeResponseStub();
    const result = await issueAndSetRefreshCookie(res, 'sess-new', 'u-new', {
      cookieHeader: '',
    });

    expect(result.authuser).toBe(0);
    expect(calls.filter((c) => c.value.length > 0)[0].name).toBe('oxy_rt_0');

    const { res: res2, calls: calls2 } = makeResponseStub();
    const result2 = await issueAndSetRefreshCookie(res2, 'sess-new', 'u-new', {
      cookieHeader: 'theme=dark',
    });
    expect(result2.authuser).toBe(0);
    const tokenCookies2 = calls2.filter((c) => c.value.length > 0);
    expect(tokenCookies2).toHaveLength(1);
    expect(tokenCookies2[0].name).toBe('oxy_rt_0');
  });

  it('writes oxy_rt_1 for a second different-user login when slot 0 is occupied', async () => {
    const existingRaw = 'EXISTING-TOK';
    stage(buildStored(existingRaw, {
      sessionId: 'sess-a', family: 'fam-a',
      userId: { toString: () => 'u-a' },
    }));
    const { res, calls } = makeResponseStub();
    const result = await issueAndSetRefreshCookie(res, 'sess-b', 'u-b', {
      cookieHeader: `oxy_rt_0=${existingRaw}`,
    });

    expect(result.authuser).toBe(1);
    const tokenCookies = calls.filter((c) => c.value.length > 0);
    expect(tokenCookies).toHaveLength(1);
    expect(tokenCookies[0].name).toBe('oxy_rt_1');
    // The pre-existing family must NOT have been revoked.
    expect(mockTokenUpdateMany).not.toHaveBeenCalled();
  });

  it('reuses the existing slot AND revokes the prior family when the same userId re-logs in', async () => {
    const existingRaw = 'SAME-USER-TOK';
    stage(buildStored(existingRaw, {
      sessionId: 'sess-a', family: 'fam-a',
      userId: { toString: () => 'u-same' },
    }));
    const { res, calls } = makeResponseStub();
    const result = await issueAndSetRefreshCookie(res, 'sess-a-fresh', 'u-same', {
      cookieHeader: `oxy_rt_0=${existingRaw}`,
    });

    expect(result.authuser).toBe(0);
    expect(calls[0].name).toBe('oxy_rt_0');
    expect(mockTokenUpdateMany).toHaveBeenCalledWith(
      { family: 'fam-a', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
    expect(mockDeactivateSession).toHaveBeenCalledWith('sess-a');
  });

  it('evicts the LRU slot when all MAX_DEVICE_ACCOUNTS are occupied by different users', async () => {
    // Fill slots 0..MAX-1 with distinct users; slot 3 is the LRU.
    const cookieParts: string[] = [];
    for (let i = 0; i < MAX_DEVICE_ACCOUNTS; i += 1) {
      const raw = `tok-${i}`;
      stage(buildStored(raw, {
        _id: `rt-${i}`,
        sessionId: `sess-${i}`,
        family: `fam-${i}`,
        userId: { toString: () => `u-${i}` },
      }));
      const baseTime = Date.now() - 60_000;
      stageSession({
        sessionId: `sess-${i}`,
        lastActive: new Date(i === 3 ? baseTime - 10_000_000 : baseTime - i * 1000),
      });
      cookieParts.push(`oxy_rt_${i}=${raw}`);
    }

    const { res, calls } = makeResponseStub();
    const result = await issueAndSetRefreshCookie(res, 'sess-new', 'u-new', {
      cookieHeader: cookieParts.join('; '),
    });

    expect(result.authuser).toBe(3);
    expect(calls[0].name).toBe('oxy_rt_3');
    // LRU family-3 was revoked + its session deactivated.
    expect(mockTokenUpdateMany).toHaveBeenCalledWith(
      { family: 'fam-3', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } }
    );
    expect(mockDeactivateSession).toHaveBeenCalledWith('sess-3');
  });

  it('honors an explicit opts.authuser and writes that exact slot', async () => {
    const { res, calls } = makeResponseStub();
    const result = await issueAndSetRefreshCookie(res, 'sess-x', 'u-x', { authuser: 4 });
    expect(result.authuser).toBe(4);
    expect(calls[0].name).toBe('oxy_rt_4');
  });
});
