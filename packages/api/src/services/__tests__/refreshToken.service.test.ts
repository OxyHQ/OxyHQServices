/**
 * RefreshToken service — multi-account helper unit tests.
 *
 * Covers the Google-style multi-account primitives added in the §6b handoff:
 *   - `refreshCookieName(authuser)` name + range validation.
 *   - `parseAllRefreshCookies(header)` indexed bucket grouping,
 *     including the rejection of malformed suffixes and out-of-range indices.
 *   - `selectActiveCandidate(rawList)` — valid wins, lone used fires
 *     reuse-detection, none-found stays none.
 */

import * as crypto from 'crypto';

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

const mockFindOne = jest.fn((query?: { tokenHash?: string }) => {
  const hash = query?.tokenHash;
  if (typeof hash === 'string' && tokenStore.has(hash)) {
    return Promise.resolve(tokenStore.get(hash));
  }
  return Promise.resolve(null);
});

jest.mock('../../models/RefreshToken', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn() },
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    getAccessToken: jest.fn(),
    deactivateSession: jest.fn(),
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

import {
  refreshCookieName,
  parseAllRefreshCookies,
  selectActiveCandidate,
  MAX_DEVICE_ACCOUNTS,
} from '../refreshToken.service';
import { sha256Hex } from '../oauthCode.service';

function buildStored(rawToken: string, overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    _id: 'rt-1',
    tokenHash: sha256Hex(rawToken),
    sessionId: 'sess-1',
    userId: { toString: () => '64f7c2a1b8e9d3f4a1c2b3d4' },
    family: 'fam-1',
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  tokenStore.clear();
});

describe('refreshCookieName', () => {
  it('returns oxy_rt_0 .. oxy_rt_(MAX-1) for valid integers', () => {
    expect(refreshCookieName(0)).toBe('oxy_rt_0');
    expect(refreshCookieName(1)).toBe('oxy_rt_1');
    expect(refreshCookieName(MAX_DEVICE_ACCOUNTS - 1)).toBe(`oxy_rt_${MAX_DEVICE_ACCOUNTS - 1}`);
  });

  it('throws RangeError for non-integer values', () => {
    expect(() => refreshCookieName(1.5)).toThrow(RangeError);
    expect(() => refreshCookieName(Number.NaN)).toThrow(RangeError);
  });

  it('throws RangeError for negative values', () => {
    expect(() => refreshCookieName(-1)).toThrow(RangeError);
  });

  it('throws RangeError when authuser >= MAX_DEVICE_ACCOUNTS', () => {
    expect(() => refreshCookieName(MAX_DEVICE_ACCOUNTS)).toThrow(RangeError);
    expect(() => refreshCookieName(MAX_DEVICE_ACCOUNTS + 5)).toThrow(RangeError);
  });
});

describe('parseAllRefreshCookies', () => {
  it('returns an empty map for undefined / empty cookie headers', () => {
    expect(parseAllRefreshCookies(undefined).size).toBe(0);
    expect(parseAllRefreshCookies('').size).toBe(0);
  });

  it('groups indexed cookies and ignores unsuffixed oxy_rt', () => {
    const header =
      'oxy_rt=LEGACY; oxy_rt_0=ZERO; oxy_rt_5=FIVE; theme=dark';
    const result = parseAllRefreshCookies(header);
    expect(result.size).toBe(2);
    expect(result.get(0)).toEqual(['ZERO']);
    expect(result.get(5)).toEqual(['FIVE']);
  });

  it('ignores malformed suffixes (oxy_rt_foo, oxy_rt_-1, trailing space)', () => {
    const header =
      'oxy_rt_foo=BAD; oxy_rt_-1=BAD; oxy_rt_=BAD; oxy_rt_0a=BAD; oxy_rt_0=GOOD';
    const result = parseAllRefreshCookies(header);
    expect(result.size).toBe(1);
    expect(result.get(0)).toEqual(['GOOD']);
  });

  it('ignores out-of-range numeric suffixes (oxy_rt_999, oxy_rt_<MAX>)', () => {
    const header = `oxy_rt_999=BAD; oxy_rt_${MAX_DEVICE_ACCOUNTS}=BAD; oxy_rt_2=GOOD`;
    const result = parseAllRefreshCookies(header);
    expect(result.size).toBe(1);
    expect(result.get(2)).toEqual(['GOOD']);
  });

  it('preserves duplicate-value de-duplication and first-seen order per bucket', () => {
    const header =
      'oxy_rt_0=A; oxy_rt_0=B; oxy_rt_0=A; oxy_rt=L1; oxy_rt=L1';
    const result = parseAllRefreshCookies(header);
    expect(result.get(0)).toEqual(['A', 'B']);
    expect(result.has(1)).toBe(false);
  });

  it('skips empty values inside any bucket', () => {
    const header = 'oxy_rt_0=; oxy_rt_0=REAL; oxy_rt=';
    const result = parseAllRefreshCookies(header);
    expect(result.size).toBe(1);
    expect(result.get(0)).toEqual(['REAL']);
  });

  it('tolerates control chars / unusual characters inside values without crashing', () => {
    // The values pass through unchanged — we only ever feed them to sha256Hex,
    // so the parser must not corrupt the bytes (e.g. by URL-decoding).
    const header = 'oxy_rt_0=A%20B; oxy_rt_1=tok-en';
    const result = parseAllRefreshCookies(header);
    expect(result.get(0)).toEqual(['A%20B']);
    expect(result.get(1)).toEqual(['tok-en']);
  });

  it('does not bleed cookies named oxy_rt-something or other_rt_0 into the result', () => {
    const header = 'other_rt_0=BAD; oxy-rt=BAD; oxy_rt_0=GOOD';
    const result = parseAllRefreshCookies(header);
    expect(result.size).toBe(1);
    expect(result.get(0)).toEqual(['GOOD']);
  });
});

describe('selectActiveCandidate', () => {
  it('returns valid when at least one stored row is valid', async () => {
    const valid = 'VALID-TOK';
    const used = 'USED-TOK';
    stage(buildStored(valid));
    stage(buildStored(used, { _id: 'rt-2', usedAt: new Date(Date.now() - 1000) }));

    const result = await selectActiveCandidate([used, valid]);
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') {
      expect(result.rawToken).toBe(valid);
    }
  });

  it('returns used (theft signal) when only used/revoked rows are found', async () => {
    const lone = 'LONE-USED';
    stage(buildStored(lone, { usedAt: new Date(Date.now() - 1000) }));
    const result = await selectActiveCandidate([lone]);
    expect(result.kind).toBe('used');
    if (result.kind === 'used') {
      expect(result.family).toBe('fam-1');
      expect(result.sessionId).toBe('sess-1');
    }
  });

  it('returns none when no candidate matches a stored row', async () => {
    const result = await selectActiveCandidate(['ghost-1', 'ghost-2']);
    expect(result.kind).toBe('none');
  });

  it('returns none for an empty list', async () => {
    expect((await selectActiveCandidate([])).kind).toBe('none');
  });
});

describe('parseAllRefreshCookies — non-trivial header shapes', () => {
  it('handles a Cookie header with a single oxy_rt_0', () => {
    const result = parseAllRefreshCookies('oxy_rt_0=ONLY');
    expect(result.size).toBe(1);
    expect(result.get(0)).toEqual(['ONLY']);
  });

  it('strips surrounding whitespace around names', () => {
    const result = parseAllRefreshCookies(' oxy_rt_0 = X ;  oxy_rt = Y ');
    expect(result.get(0)).toEqual(['X']);
    expect(result.size).toBe(1);
  });

  it('keeps random-byte values intact (sha256Hex would otherwise mismatch)', () => {
    const rawBytes = crypto.randomBytes(32).toString('base64url');
    const header = `oxy_rt_0=${rawBytes}`;
    const result = parseAllRefreshCookies(header);
    expect(result.get(0)).toEqual([rawBytes]);
  });
});
