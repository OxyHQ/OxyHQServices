/**
 * `resolveCentralAuthUrl` / `CENTRAL_AUTH_URL` — central IdP resolution.
 *
 * Pure helper: an explicit non-empty value always wins; otherwise the central
 * `auth.oxy.so` origin is returned. No DOM, no side effects.
 */

import { CENTRAL_AUTH_URL, CENTRAL_IDP_APEX, resolveCentralAuthUrl } from '../authWebUrl';

describe('CENTRAL_IDP_APEX', () => {
  it('is the central IdP registrable apex', () => {
    expect(CENTRAL_IDP_APEX).toBe('oxy.so');
  });
});

describe('CENTRAL_AUTH_URL', () => {
  it('is the central IdP origin with no trailing slash', () => {
    expect(CENTRAL_AUTH_URL).toBe('https://auth.oxy.so');
    expect(CENTRAL_AUTH_URL.endsWith('/')).toBe(false);
  });

  it('is derived from CENTRAL_IDP_APEX (apex and origin never drift)', () => {
    expect(CENTRAL_AUTH_URL).toBe(`https://auth.${CENTRAL_IDP_APEX}`);
  });
});

describe('resolveCentralAuthUrl', () => {
  it('returns the central default when no explicit value is given', () => {
    expect(resolveCentralAuthUrl()).toBe(CENTRAL_AUTH_URL);
    expect(resolveCentralAuthUrl(undefined)).toBe('https://auth.oxy.so');
  });

  it('returns the explicit value when provided (explicit wins)', () => {
    expect(resolveCentralAuthUrl('https://auth.mention.earth')).toBe(
      'https://auth.mention.earth',
    );
  });

  it('does not read any ambient DOM/window state', () => {
    // Even with a window installed, the result is purely a function of the arg.
    (globalThis as unknown as { window: unknown }).window = {
      location: { hostname: 'mention.earth', protocol: 'https:' },
    };
    try {
      expect(resolveCentralAuthUrl()).toBe('https://auth.oxy.so');
    } finally {
      delete (globalThis as Record<string, unknown>).window;
    }
  });
});
