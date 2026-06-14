/**
 * deviceUtils — `deriveStableDeviceId` tests (security review H1).
 *
 * The derived deviceId scopes session-grouping per (server-salt + user) so
 * two distinct users behind the same NAT/proxy on the same browser do NOT
 * collide on the same id. These tests pin that contract.
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

import { deriveStableDeviceId, deriveServiceDeviceId } from '../deviceUtils';

const STRONG_SALT_A = 'a'.repeat(48);
const STRONG_SALT_B = 'b'.repeat(48);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36';
const IP = '203.0.113.42';
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
    const id = deriveStableDeviceId(UA, IP, LANG, 'user-1');
    expect(id).not.toBeNull();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic for the same (ua, ip, lang, userId) inputs', () => {
    const a = deriveStableDeviceId(UA, IP, LANG, 'user-1');
    const b = deriveStableDeviceId(UA, IP, LANG, 'user-1');
    expect(a).toBe(b);
  });

  it('produces DIFFERENT ids for two distinct users on the same browser/IP', () => {
    const userA = deriveStableDeviceId(UA, IP, LANG, 'user-A');
    const userB = deriveStableDeviceId(UA, IP, LANG, 'user-B');
    expect(userA).not.toBeNull();
    expect(userB).not.toBeNull();
    expect(userA).not.toBe(userB);
  });

  it('produces a DIFFERENT id when the server salt changes (defends against salt-guessing)', () => {
    const withSaltA = deriveStableDeviceId(UA, IP, LANG, 'user-1');
    process.env.DEVICE_ID_SALT = STRONG_SALT_B;
    const withSaltB = deriveStableDeviceId(UA, IP, LANG, 'user-1');
    expect(withSaltA).not.toBeNull();
    expect(withSaltB).not.toBeNull();
    expect(withSaltA).not.toBe(withSaltB);
  });

  describe('pre-auth (userId omitted / null)', () => {
    it('still returns a stable id (deterministic with itself)', () => {
      const a = deriveStableDeviceId(UA, IP, LANG, null);
      const b = deriveStableDeviceId(UA, IP, LANG, null);
      const c = deriveStableDeviceId(UA, IP, LANG);
      expect(a).not.toBeNull();
      expect(a).toBe(b);
      expect(a).toBe(c);
    });

    it('produces a DIFFERENT id from any post-auth id derived from the same inputs', () => {
      const preAuth = deriveStableDeviceId(UA, IP, LANG, null);
      const postAuth = deriveStableDeviceId(UA, IP, LANG, 'user-1');
      expect(preAuth).not.toBeNull();
      expect(postAuth).not.toBeNull();
      expect(preAuth).not.toBe(postAuth);
    });

    it('treats empty-string userId as pre-auth', () => {
      const empty = deriveStableDeviceId(UA, IP, LANG, '');
      const preAuth = deriveStableDeviceId(UA, IP, LANG, null);
      expect(empty).toBe(preAuth);
    });
  });

  describe('unresolvable inputs', () => {
    it('returns null when DEVICE_ID_SALT is unset', () => {
      delete process.env.DEVICE_ID_SALT;
      expect(deriveStableDeviceId(UA, IP, LANG, 'user-1')).toBeNull();
    });

    it('returns null when DEVICE_ID_SALT is empty', () => {
      process.env.DEVICE_ID_SALT = '';
      expect(deriveStableDeviceId(UA, IP, LANG, 'user-1')).toBeNull();
    });

    it.each([
      ['empty UA', '', IP],
      ['literal "unknown" UA', 'unknown', IP],
      ['undefined IP', UA, undefined],
      ['"unknown" IP', UA, 'unknown'],
      ['loopback v4', UA, '127.0.0.1'],
      ['loopback v6', UA, '::1'],
    ])('returns null for %s', (_label, ua, ip) => {
      expect(deriveStableDeviceId(ua, ip, LANG, 'user-1')).toBeNull();
    });
  });
});

/**
 * deviceUtils — `deriveServiceDeviceId` tests.
 *
 * The IdP/FedCM-issued device id is keyed by (server-salt + userId + RP key),
 * NOT by the IdP worker's UA/IP. These tests pin: determinism (so one
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

  it('can never collide with a UA/IP-derived id (distinct "fedcm" namespace)', () => {
    const serviceId = deriveServiceDeviceId('user-1', RP_A);
    const stableId = deriveStableDeviceId(UA, IP, LANG, 'user-1');
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
