/**
 * Pure helpers backing the central cross-domain SSO bounce.
 *
 * `ssoBounce` provides the per-origin sessionStorage key derivation, the
 * central-IdP-origin check, and the guard-TTL self-heal logic used by the
 * `sso-return` / `sso-bounce` cold-boot steps in `WebOxyProvider`. These tests
 * pin the contract independently of React.
 */

import {
  SSO_CALLBACK_PATH,
  SSO_GUARD_TTL_MS,
  ssoStateKey,
  ssoNoSessionKey,
  ssoGuardKey,
  ssoDestKey,
  isCentralIdPOrigin,
  guardActive,
  buildSsoBounceUrl,
} from '../../src/utils/ssoBounce';

describe('ssoBounce constants', () => {
  it('callback path is the internal RP return path', () => {
    expect(SSO_CALLBACK_PATH).toBe('/__oxy/sso-callback');
  });

  it('guard TTL is 30 seconds', () => {
    expect(SSO_GUARD_TTL_MS).toBe(30_000);
  });
});

describe('per-origin key derivation', () => {
  const a = 'https://mention.earth';
  const b = 'https://homiio.com';

  it('keys are suffixed with the origin and never collide across origins', () => {
    expect(ssoStateKey(a)).not.toBe(ssoStateKey(b));
    expect(ssoNoSessionKey(a)).not.toBe(ssoNoSessionKey(b));
    expect(ssoGuardKey(a)).not.toBe(ssoGuardKey(b));
    expect(ssoDestKey(a)).not.toBe(ssoDestKey(b));
  });

  it('the four key families are distinct for the same origin', () => {
    const keys = new Set([
      ssoStateKey(a),
      ssoNoSessionKey(a),
      ssoGuardKey(a),
      ssoDestKey(a),
    ]);
    expect(keys.size).toBe(4);
  });

  it('keys embed the origin verbatim', () => {
    expect(ssoStateKey(a)).toContain(a);
    expect(ssoDestKey(b)).toContain(b);
  });
});

describe('isCentralIdPOrigin', () => {
  it('matches the central IdP origin', () => {
    expect(isCentralIdPOrigin('https://auth.oxy.so')).toBe(true);
  });

  it('does not match RP origins', () => {
    expect(isCentralIdPOrigin('https://mention.earth')).toBe(false);
    expect(isCentralIdPOrigin('https://accounts.oxy.so')).toBe(false);
    expect(isCentralIdPOrigin('https://auth.mention.earth')).toBe(false);
  });

  it('is exact-origin (no substring / scheme confusion)', () => {
    expect(isCentralIdPOrigin('http://auth.oxy.so')).toBe(false);
    expect(isCentralIdPOrigin('https://auth.oxy.so.evil.com')).toBe(false);
  });
});

describe('buildSsoBounceUrl', () => {
  const origin = 'https://mention.earth';

  it('targets the central IdP /sso endpoint with prompt=none', () => {
    const url = new URL(buildSsoBounceUrl(origin, 'st'));
    expect(url.origin).toBe('https://auth.oxy.so');
    expect(url.pathname).toBe('/sso');
    expect(url.searchParams.get('prompt')).toBe('none');
  });

  it('carries client_id, return_to, and state', () => {
    const url = new URL(buildSsoBounceUrl(origin, 'st-123'));
    expect(url.searchParams.get('client_id')).toBe(origin);
    expect(url.searchParams.get('return_to')).toBe(origin + SSO_CALLBACK_PATH);
    expect(url.searchParams.get('state')).toBe('st-123');
  });

  it('percent-encodes the state value safely', () => {
    const url = new URL(buildSsoBounceUrl(origin, 'a b/c+d'));
    // The decoded value round-trips exactly (no injection into other params).
    expect(url.searchParams.get('state')).toBe('a b/c+d');
  });
});

describe('guardActive (30s TTL self-heal)', () => {
  const origin = 'https://mention.earth';

  function storage(entries: Record<string, string>): Pick<Storage, 'getItem'> {
    return {
      getItem: (key: string) => (key in entries ? entries[key] : null),
    };
  }

  it('returns false when no guard is present', () => {
    expect(guardActive(origin, storage({}), () => 1_000)).toBe(false);
  });

  it('returns true for a fresh guard inside the TTL window', () => {
    const now = 100_000;
    const s = storage({ [ssoGuardKey(origin)]: String(now - 5_000) });
    expect(guardActive(origin, s, () => now)).toBe(true);
  });

  it('returns false for a stale guard older than the TTL (self-heal)', () => {
    const now = 100_000;
    const s = storage({ [ssoGuardKey(origin)]: String(now - SSO_GUARD_TTL_MS - 1) });
    expect(guardActive(origin, s, () => now)).toBe(false);
  });

  it('treats the exact TTL boundary as expired (strict <)', () => {
    const now = 100_000;
    const s = storage({ [ssoGuardKey(origin)]: String(now - SSO_GUARD_TTL_MS) });
    expect(guardActive(origin, s, () => now)).toBe(false);
  });

  it('returns false for a non-numeric guard value', () => {
    const s = storage({ [ssoGuardKey(origin)]: 'not-a-number' });
    expect(guardActive(origin, s, () => 1_000)).toBe(false);
  });
});
