/**
 * Pure helpers for the central cross-domain SSO bounce.
 *
 * These back the cold-boot `sso-bounce` enabled() gate and the `sso-return`
 * key management. They are pure (no navigation), so they are unit-tested here
 * in isolation; the full bounce/return flow is covered by the OxyContext
 * integration tests.
 */

import {
  SSO_CALLBACK_PATH,
  SSO_GUARD_TTL_MS,
  ssoStateKey,
  ssoGuardKey,
  ssoDestKey,
  ssoNoSessionKey,
  isCentralIdPOrigin,
  guardActive,
} from '../../src/ui/utils/ssoBounce';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('SSO bounce constants', () => {
  it('callback path is the stable RP contract', () => {
    expect(SSO_CALLBACK_PATH).toBe('/__oxy/sso-callback');
  });

  it('guard TTL is 30 seconds', () => {
    expect(SSO_GUARD_TTL_MS).toBe(30_000);
  });
});

describe('per-origin keys', () => {
  const origin = 'https://app.mention.earth';

  it('are namespaced and suffixed by origin', () => {
    expect(ssoStateKey(origin)).toBe('oxy_sso_state:https://app.mention.earth');
    expect(ssoGuardKey(origin)).toBe('oxy_sso_guard:https://app.mention.earth');
    expect(ssoDestKey(origin)).toBe('oxy_sso_dest:https://app.mention.earth');
    expect(ssoNoSessionKey(origin)).toBe('oxy_sso_no_session:https://app.mention.earth');
  });

  it('never collide across different origins', () => {
    const a = 'https://app.mention.earth';
    const b = 'https://homiio.com';
    expect(ssoStateKey(a)).not.toBe(ssoStateKey(b));
    expect(ssoGuardKey(a)).not.toBe(ssoGuardKey(b));
  });
});

describe('isCentralIdPOrigin', () => {
  it('is true for the central IdP origin', () => {
    expect(isCentralIdPOrigin('https://auth.oxy.so')).toBe(true);
    // Path/trailing-slash differences are normalised by URL parsing.
    expect(isCentralIdPOrigin('https://auth.oxy.so/')).toBe(true);
  });

  it('is false for any RP origin', () => {
    expect(isCentralIdPOrigin('https://app.mention.earth')).toBe(false);
    expect(isCentralIdPOrigin('https://homiio.com')).toBe(false);
    // A look-alike host must not match.
    expect(isCentralIdPOrigin('https://auth.oxy.so.evil.com')).toBe(false);
  });

  it('is false for malformed input', () => {
    expect(isCentralIdPOrigin('not a url')).toBe(false);
    expect(isCentralIdPOrigin('')).toBe(false);
  });
});

describe('guardActive (loop breaker + 30s self-heal)', () => {
  const origin = 'https://app.mention.earth';

  it('is false when no guard is present', () => {
    const storage = new MemoryStorage();
    expect(guardActive(storage, origin, Date.now())).toBe(false);
  });

  it('is true within the 30s TTL (a bounce is in flight)', () => {
    const storage = new MemoryStorage();
    const t0 = 1_000_000;
    storage.setItem(ssoGuardKey(origin), String(t0));
    expect(guardActive(storage, origin, t0)).toBe(true);
    expect(guardActive(storage, origin, t0 + 29_999)).toBe(true);
  });

  it('self-heals: is false once the 30s TTL lapses', () => {
    const storage = new MemoryStorage();
    const t0 = 1_000_000;
    storage.setItem(ssoGuardKey(origin), String(t0));
    expect(guardActive(storage, origin, t0 + SSO_GUARD_TTL_MS)).toBe(false);
    expect(guardActive(storage, origin, t0 + SSO_GUARD_TTL_MS + 1)).toBe(false);
  });

  it('is false for a malformed (non-numeric) guard value', () => {
    const storage = new MemoryStorage();
    storage.setItem(ssoGuardKey(origin), 'not-a-number');
    expect(guardActive(storage, origin, Date.now())).toBe(false);
  });
});
