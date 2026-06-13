/**
 * `OxyServices` constructor central-IdP defaulting.
 *
 * TRUE central cross-domain SSO (Google/Meta/Clerk style, 2026-06-13) routes
 * every Relying Party through ONE central IdP at `auth.oxy.so` — it owns the
 * host-only `fedcm_session` cookie and the central session store. The SDK
 * therefore defaults `authWebUrl` to the central IdP when the caller omits it,
 * via `resolveCentralAuthUrl(config.authWebUrl)`.
 *
 * This replaces the previous behaviour, where the constructor auto-detected a
 * per-apex IdP (`auth.<rp-apex>`) from `window.location`. `autoDetectAuthWebUrl`
 * is still exported for call sites that opt into per-apex resolution, but it is
 * NO LONGER the constructor default.
 *
 * Contract:
 *   - authWebUrl omitted, no window (native/SSR) -> 'https://auth.oxy.so'
 *   - authWebUrl omitted, window present         -> 'https://auth.oxy.so'
 *     (the page host is irrelevant — central only)
 *   - authWebUrl explicit                        -> respected verbatim (wins)
 */

import { OxyServices } from '../../OxyServices';
import { CENTRAL_AUTH_URL } from '../../utils/authWebUrl';

function installWindowLocation(hostname: string, protocol = 'https:'): void {
  (globalThis as unknown as { window: unknown }).window = {
    location: { hostname, protocol },
  };
}

function clearWindow(): void {
  delete (globalThis as Record<string, unknown>).window;
}

describe('OxyServices constructor — central IdP defaulting', () => {
  afterEach(() => {
    clearWindow();
  });

  it('defaults authWebUrl to the central IdP on native/SSR (no window)', () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    expect(oxy.config.authWebUrl).toBe(CENTRAL_AUTH_URL);
    expect(oxy.config.authWebUrl).toBe('https://auth.oxy.so');
  });

  it('defaults to the central IdP on web regardless of page host', () => {
    // The page is mention.earth, but central SSO never derives a per-apex IdP.
    installWindowLocation('mention.earth');

    const oxy = new OxyServices({ baseURL: 'https://api.mention.earth' });

    expect(oxy.config.authWebUrl).toBe('https://auth.oxy.so');
  });

  it('defaults to the central IdP even on a subdomain page host', () => {
    installWindowLocation('www.homiio.com');

    const oxy = new OxyServices({ baseURL: 'https://api.homiio.com' });

    expect(oxy.config.authWebUrl).toBe('https://auth.oxy.so');
  });

  it('respects an explicit authWebUrl (explicit wins)', () => {
    installWindowLocation('mention.earth');

    const oxy = new OxyServices({
      baseURL: 'https://api.mention.earth',
      authWebUrl: 'https://auth.mention.earth',
    });

    // The caller pinned a per-apex IdP explicitly — honour it verbatim.
    expect(oxy.config.authWebUrl).toBe('https://auth.mention.earth');
  });

  it('does not mutate the caller-supplied config object', () => {
    const input = { baseURL: 'https://api.mention.earth' };
    const oxy = new OxyServices(input);

    // The stored config carries the central IdP default...
    expect(oxy.config.authWebUrl).toBe('https://auth.oxy.so');
    // ...but the caller's own object reference is untouched.
    expect((input as { authWebUrl?: string }).authWebUrl).toBeUndefined();
  });
});
