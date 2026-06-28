/**
 * dynamicOriginRegistry tests.
 *
 * The registry derives the CORS allowlist from the Application registry:
 *  - trusted apps (official/internal/system/first_party) → credentialed lane;
 *  - third-party active apps → non-credentialed (bearer) lane;
 *  - everything else → denied.
 *
 * The boot seed (bootstrap-core ∪ OXY_EXTRA_ALLOWED_ORIGINS) keeps first-party
 * origins trusted even before/without a refresh. `refresh()` is fail-soft: a
 * Mongo error keeps the previous snapshot.
 */

const mockFind = jest.fn();
const mockError = jest.fn();

jest.mock('mongoose', () => ({
  __esModule: true,
  default: { connection: { readyState: 1 } },
  connection: { readyState: 1 },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { find: (...args: unknown[]) => mockFind(...args) },
  default: { find: (...args: unknown[]) => mockFind(...args) },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: (...args: unknown[]) => mockError(...args), info: jest.fn(), debug: jest.fn() },
}));

import {
  isTrustedOrigin,
  getCorsDecision,
  refreshOriginRegistry,
  stopOriginRegistry,
  setOriginSnapshotForTests,
  resetOriginRegistryForTests,
  getExtraAllowedOrigins,
  BOOTSTRAP_CORE_ORIGINS,
} from '../dynamicOriginRegistry';

interface AppRow {
  redirectUris?: string[];
  isOfficial?: boolean;
  isInternal?: boolean;
  type?: string;
}

function findResult(apps: AppRow[]) {
  return { select: () => ({ lean: () => Promise.resolve(apps) }) };
}

const ORIGINAL_EXTRA = process.env.OXY_EXTRA_ALLOWED_ORIGINS;

afterAll(() => {
  stopOriginRegistry();
  if (ORIGINAL_EXTRA === undefined) {
    delete process.env.OXY_EXTRA_ALLOWED_ORIGINS;
  } else {
    process.env.OXY_EXTRA_ALLOWED_ORIGINS = ORIGINAL_EXTRA;
  }
});

beforeEach(() => {
  mockFind.mockReset();
  mockError.mockReset();
  resetOriginRegistryForTests();
});

describe('boot seed (no refresh)', () => {
  it('treats every bootstrap-core origin as trusted/credentialed', () => {
    for (const origin of BOOTSTRAP_CORE_ORIGINS) {
      expect(isTrustedOrigin(origin)).toBe(true);
      expect(getCorsDecision(origin)).toEqual({ allow: true, credentials: true });
    }
  });

  it('denies an unregistered origin', () => {
    expect(isTrustedOrigin('https://unknown.example.com')).toBe(false);
    expect(getCorsDecision('https://unknown.example.com')).toEqual({
      allow: false,
      credentials: false,
    });
  });
});

describe('refresh() — trusted vs third-party routing', () => {
  it('routes trusted apps to the credentialed lane and third-party apps to the bearer lane', async () => {
    mockFind.mockReturnValueOnce(
      findResult([
        { type: 'third_party', redirectUris: ['https://third.example.com/cb'] },
        { isOfficial: true, redirectUris: ['https://official.example.com/cb'] },
        { type: 'internal', redirectUris: ['https://internal.example.com/callback'] },
        { type: 'first_party', redirectUris: ['https://first.example.com/x'] },
        { type: 'system', redirectUris: ['https://system.example.com/x'] },
      ])
    );

    await refreshOriginRegistry();

    // Third-party → allowed without credentials, NOT trusted.
    expect(isTrustedOrigin('https://third.example.com')).toBe(false);
    expect(getCorsDecision('https://third.example.com')).toEqual({
      allow: true,
      credentials: false,
    });

    // Each trusted classification → credentialed lane + trusted.
    for (const origin of [
      'https://official.example.com',
      'https://internal.example.com',
      'https://first.example.com',
      'https://system.example.com',
    ]) {
      expect(isTrustedOrigin(origin)).toBe(true);
      expect(getCorsDecision(origin)).toEqual({ allow: true, credentials: true });
    }

    // Bootstrap origins survive a refresh.
    expect(getCorsDecision('https://oxy.so')).toEqual({ allow: true, credentials: true });
  });

  it('normalises redirectUris to origins (drops path/query, lowercases host)', async () => {
    mockFind.mockReturnValueOnce(
      findResult([{ type: 'third_party', redirectUris: ['https://App.Example.com:8443/cb?x=1'] }])
    );

    await refreshOriginRegistry();

    expect(getCorsDecision('https://app.example.com:8443')).toEqual({
      allow: true,
      credentials: false,
    });
  });

  it('lets trusted win when a third-party app registers a trusted/bootstrap origin', async () => {
    mockFind.mockReturnValueOnce(
      findResult([
        // A third-party app maliciously/accidentally registers a bootstrap origin.
        { type: 'third_party', redirectUris: ['https://oxy.so/cb'] },
        { isOfficial: true, redirectUris: ['https://shared.example.com/cb'] },
        { type: 'third_party', redirectUris: ['https://shared.example.com/other'] },
      ])
    );

    await refreshOriginRegistry();

    // Bootstrap origin must stay credentialed, never demoted to third-party.
    expect(getCorsDecision('https://oxy.so')).toEqual({ allow: true, credentials: true });
    // Origin claimed by BOTH a trusted and a third-party app stays trusted.
    expect(isTrustedOrigin('https://shared.example.com')).toBe(true);
    expect(getCorsDecision('https://shared.example.com')).toEqual({
      allow: true,
      credentials: true,
    });
  });

  it('skips malformed redirectUris without throwing', async () => {
    mockFind.mockReturnValueOnce(
      findResult([{ type: 'third_party', redirectUris: ['not a url', '', 'https://ok.example.com/cb'] }])
    );

    await refreshOriginRegistry();

    expect(getCorsDecision('https://ok.example.com')).toEqual({ allow: true, credentials: false });
  });
});

describe('refresh() — fail-soft', () => {
  it('keeps the previous snapshot and logs when the Mongo read throws', async () => {
    mockFind.mockReturnValueOnce(
      findResult([{ isOfficial: true, redirectUris: ['https://keep.example.com/cb'] }])
    );
    await refreshOriginRegistry();
    expect(isTrustedOrigin('https://keep.example.com')).toBe(true);

    // Next refresh fails — previous snapshot must be retained.
    mockFind.mockReturnValueOnce({
      select: () => ({ lean: () => Promise.reject(new Error('mongo down')) }),
    });
    await refreshOriginRegistry();

    expect(isTrustedOrigin('https://keep.example.com')).toBe(true);
    expect(mockError).toHaveBeenCalled();
  });
});

describe('OXY_EXTRA_ALLOWED_ORIGINS', () => {
  it('parses valid https entries and drops invalid ones', () => {
    process.env.OXY_EXTRA_ALLOWED_ORIGINS =
      'https://partner.example.com, http://insecure.example.com, https://bad.example.com/path';
    const parsed = getExtraAllowedOrigins();
    expect(parsed.has('https://partner.example.com')).toBe(true);
    expect(parsed.has('http://insecure.example.com')).toBe(false);
    expect(parsed.has('https://bad.example.com/path')).toBe(false);
  });

  it('unions validated extra origins into the trusted snapshot on refresh', async () => {
    process.env.OXY_EXTRA_ALLOWED_ORIGINS = 'https://extra.example.com';
    mockFind.mockReturnValueOnce(findResult([]));
    await refreshOriginRegistry();
    expect(getCorsDecision('https://extra.example.com')).toEqual({
      allow: true,
      credentials: true,
    });
  });
});

describe('setOriginSnapshotForTests', () => {
  it('overrides both snapshots deterministically', () => {
    setOriginSnapshotForTests(['https://t.example.com'], ['https://tp.example.com']);
    expect(getCorsDecision('https://t.example.com')).toEqual({ allow: true, credentials: true });
    expect(getCorsDecision('https://tp.example.com')).toEqual({ allow: true, credentials: false });
    // The bootstrap origin is no longer present after an explicit override.
    expect(isTrustedOrigin('https://oxy.so')).toBe(false);
  });
});
