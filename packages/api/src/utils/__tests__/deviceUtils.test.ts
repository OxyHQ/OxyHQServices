/**
 * deviceUtils — `deriveStableDeviceId` tests (security review H1).
 *
 * The derived deviceId scopes session-grouping per (server-salt + user) so
 * two distinct users on the same browser do NOT collide on the same id. IP is
 * deliberately NOT an input (privacy invariant — no user IPs at rest). These
 * tests pin that contract.
 */

jest.mock('../logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// Session model isn't reachable from the unit under test (we only call the
// pure `deriveStableDeviceId`), but `deviceUtils.ts` imports it at top
// level. Stub it so the global mongoose mock in `jest.setup.cjs` (which
// doesn't expose `Schema.Types.ObjectId`) doesn't blow up the import chain.
jest.mock('../../models/Session', () => ({ __esModule: true, default: {} }));
jest.mock('../sessionCache', () => ({ __esModule: true, default: { invalidate: jest.fn() } }));
jest.mock('../userTransform', () => ({ formatUserResponse: jest.fn() }));

import crypto from 'crypto';
import type { Request } from 'express';
import {
  deriveStableDeviceId,
  deriveServiceDeviceId,
  extractDeviceInfo,
  generateDeviceFingerprint,
} from '../deviceUtils';

const STRONG_SALT_A = 'a'.repeat(48);
const STRONG_SALT_B = 'b'.repeat(48);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36';
const LANG = 'en-US,en;q=0.9';

const ORIGINAL_ENV = process.env;

describe('deriveStableDeviceId', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.DEVICE_ID_SALT = STRONG_SALT_A;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns a 32-char hex string for valid inputs', () => {
    const id = deriveStableDeviceId(UA, LANG, 'user-1');
    expect(id).not.toBeNull();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic for the same (ua, lang, userId) inputs', () => {
    const a = deriveStableDeviceId(UA, LANG, 'user-1');
    const b = deriveStableDeviceId(UA, LANG, 'user-1');
    expect(a).toBe(b);
  });

  it('derives the same deviceId regardless of network (no IP input)', () => {
    process.env.DEVICE_ID_SALT = 'test-salt-0123456789abcdef';
    const a = deriveStableDeviceId('Mozilla/5.0 (X11; Linux x86_64)', 'en-US', 'user1');
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(deriveStableDeviceId('Mozilla/5.0 (X11; Linux x86_64)', 'en-US', 'user1')).toBe(a);
  });

  it('produces DIFFERENT ids for two distinct users on the same browser', () => {
    const userA = deriveStableDeviceId(UA, LANG, 'user-A');
    const userB = deriveStableDeviceId(UA, LANG, 'user-B');
    expect(userA).not.toBeNull();
    expect(userB).not.toBeNull();
    expect(userA).not.toBe(userB);
  });

  it('produces a DIFFERENT id when the server salt changes (defends against salt-guessing)', () => {
    const withSaltA = deriveStableDeviceId(UA, LANG, 'user-1');
    process.env.DEVICE_ID_SALT = STRONG_SALT_B;
    const withSaltB = deriveStableDeviceId(UA, LANG, 'user-1');
    expect(withSaltA).not.toBeNull();
    expect(withSaltB).not.toBeNull();
    expect(withSaltA).not.toBe(withSaltB);
  });

  describe('pre-auth (userId omitted / null)', () => {
    it('still returns a stable id (deterministic with itself)', () => {
      const a = deriveStableDeviceId(UA, LANG, null);
      const b = deriveStableDeviceId(UA, LANG, null);
      const c = deriveStableDeviceId(UA, LANG);
      expect(a).not.toBeNull();
      expect(a).toBe(b);
      expect(a).toBe(c);
    });

    it('produces a DIFFERENT id from any post-auth id derived from the same inputs', () => {
      const preAuth = deriveStableDeviceId(UA, LANG, null);
      const postAuth = deriveStableDeviceId(UA, LANG, 'user-1');
      expect(preAuth).not.toBeNull();
      expect(postAuth).not.toBeNull();
      expect(preAuth).not.toBe(postAuth);
    });

    it('treats empty-string userId as pre-auth', () => {
      const empty = deriveStableDeviceId(UA, LANG, '');
      const preAuth = deriveStableDeviceId(UA, LANG, null);
      expect(empty).toBe(preAuth);
    });
  });

  describe('unresolvable inputs', () => {
    it('returns null when DEVICE_ID_SALT is unset', () => {
      delete process.env.DEVICE_ID_SALT;
      expect(deriveStableDeviceId(UA, LANG, 'user-1')).toBeNull();
    });

    it('returns null when DEVICE_ID_SALT is empty', () => {
      process.env.DEVICE_ID_SALT = '';
      expect(deriveStableDeviceId(UA, LANG, 'user-1')).toBeNull();
    });

    it.each([
      ['empty UA', ''],
      ['literal "unknown" UA', 'unknown'],
    ])('returns null for %s', (_label, ua) => {
      expect(deriveStableDeviceId(ua, LANG, 'user-1')).toBeNull();
    });
  });
});

describe('extractDeviceInfo', () => {
  const SAVED_SALT = process.env.DEVICE_ID_SALT;

  beforeEach(() => {
    process.env.DEVICE_ID_SALT = STRONG_SALT_A;
  });

  afterEach(() => {
    if (SAVED_SALT === undefined) {
      delete process.env.DEVICE_ID_SALT;
    } else {
      process.env.DEVICE_ID_SALT = SAVED_SALT;
    }
  });

  it('returns no ipAddress and no location', () => {
    const req = {
      headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'en', 'cf-ipcountry': 'ES' },
      ip: '203.0.113.7',
      connection: { remoteAddress: '203.0.113.7' },
    } as unknown as Request;
    const info = extractDeviceInfo(req);
    expect('ipAddress' in info).toBe(false);
    expect('location' in info).toBe(false);
  });
});

/**
 * deviceUtils — `deriveServiceDeviceId` tests.
 *
 * The server-minted device id is keyed by (server-salt + userId + RP key),
 * NOT by the caller's UA/IP. These tests pin: determinism (so one
 * (user, RP) reuses one session), per-user scoping (security review H1),
 * per-RP scoping, and fail-closed behaviour when the salt is unset.
 */
describe('deriveServiceDeviceId', () => {
  const RP_A = 'https://relying.party.example';
  const RP_B = 'https://other.party.example';
  const SAVED_SALT = process.env.DEVICE_ID_SALT;

  beforeEach(() => {
    process.env.DEVICE_ID_SALT = STRONG_SALT_A;
  });

  afterEach(() => {
    if (SAVED_SALT === undefined) {
      delete process.env.DEVICE_ID_SALT;
    } else {
      process.env.DEVICE_ID_SALT = SAVED_SALT;
    }
  });

  it('returns a 32-char hex string for valid inputs', () => {
    const id = deriveServiceDeviceId('user-1', RP_A);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic for the same (userId, key) inputs', () => {
    const a = deriveServiceDeviceId('user-1', RP_A);
    const b = deriveServiceDeviceId('user-1', RP_A);
    expect(a).toBe(b);
  });

  it('produces DIFFERENT ids for two distinct users with the same RP key (per-user scoping, H1)', () => {
    const userA = deriveServiceDeviceId('user-A', RP_A);
    const userB = deriveServiceDeviceId('user-B', RP_A);
    expect(userA).not.toBe(userB);
  });

  it('produces DIFFERENT ids for the same user across two distinct RP keys (per-RP scoping)', () => {
    const rpA = deriveServiceDeviceId('user-1', RP_A);
    const rpB = deriveServiceDeviceId('user-1', RP_B);
    expect(rpA).not.toBe(rpB);
  });

  it('produces a DIFFERENT id when the server salt changes', () => {
    const withSaltA = deriveServiceDeviceId('user-1', RP_A);
    process.env.DEVICE_ID_SALT = STRONG_SALT_B;
    const withSaltB = deriveServiceDeviceId('user-1', RP_A);
    expect(withSaltA).not.toBe(withSaltB);
  });

  it('can never collide with a UA-derived id (distinct "idp" namespace)', () => {
    const serviceId = deriveServiceDeviceId('user-1', RP_A);
    const stableId = deriveStableDeviceId(UA, LANG, 'user-1');
    expect(serviceId).not.toBe(stableId);
  });

  it('THROWS (fail-closed) when DEVICE_ID_SALT is unset', () => {
    delete process.env.DEVICE_ID_SALT;
    expect(() => deriveServiceDeviceId('user-1', RP_A)).toThrow(/DEVICE_ID_SALT/);
  });

  it('THROWS (fail-closed) when DEVICE_ID_SALT is empty', () => {
    process.env.DEVICE_ID_SALT = '';
    expect(() => deriveServiceDeviceId('user-1', RP_A)).toThrow(/DEVICE_ID_SALT/);
  });
});

describe('generateDeviceFingerprint', () => {
  it('preserves 64-character client fingerprint strings instead of hashing them as empty structured objects', () => {
    const firstClientFingerprint = 'a'.repeat(64);
    const secondClientFingerprint = 'b'.repeat(64);

    expect(generateDeviceFingerprint(firstClientFingerprint)).toBe(
      firstClientFingerprint
    );
    expect(generateDeviceFingerprint(secondClientFingerprint)).toBe(
      secondClientFingerprint
    );
    expect(generateDeviceFingerprint(firstClientFingerprint)).not.toBe(
      generateDeviceFingerprint(secondClientFingerprint)
    );
    expect(generateDeviceFingerprint(firstClientFingerprint)).not.toBe(
      crypto.createHash('sha256').update('').digest('hex')
    );
  });

  it('continues to hash structured device fingerprints', () => {
    expect(
      generateDeviceFingerprint({
        userAgent: 'Mozilla/5.0',
        platform: 'macOS',
        language: 'en-US',
        timezone: 'America/Los_Angeles',
        screen: { width: 1440, height: 900, colorDepth: 24 },
      })
    ).toBe(
      crypto
        .createHash('sha256')
        .update('Mozilla/5.0|macOS|en-US|America/Los_Angeles|1440x900x24')
        .digest('hex')
    );
  });
});
