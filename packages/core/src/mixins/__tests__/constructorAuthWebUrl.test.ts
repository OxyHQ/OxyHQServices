/**
 * `OxyServices` constructor first-party IdP auto-detection.
 *
 * `@oxyhq/services` 8.2.0 added cross-domain SSO that auto-detects the IdP as
 * `https://auth.<rp-apex>` via `autoDetectAuthWebUrl()`. That detection used to
 * run ONLY on the provider-`baseURL` branch of OxyContext — apps that construct
 * their OWN `OxyServices` instance and pass it to
 * `<OxyProvider oxyServices={...} />` never hit it, so an omitted `authWebUrl`
 * fell back to the hardcoded `DEFAULT_AUTH_URL` ('https://auth.oxy.so'),
 * forcing a third-party IdP and breaking Safari/Firefox cross-domain restore.
 *
 * The constructor now derives `authWebUrl` itself when the caller omits it, so
 * BOTH construction paths behave identically:
 *   - web at `https://mention.earth` -> `https://auth.mention.earth`
 *   - native/SSR (no `window`)       -> undefined (mixins fall back to
 *     `DEFAULT_AUTH_URL`, exactly as before)
 *   - explicit `authWebUrl`          -> respected verbatim (explicit wins)
 */

import { OxyServices } from '../../OxyServices';

// The hardcoded fallback the auth mixins resolve to when `authWebUrl` is unset
// (`this.config.authWebUrl || DEFAULT_AUTH_URL`). Mirrors the static
// `DEFAULT_AUTH_URL` on the redirect/popup mixins. Native/SSR must keep
// resolving to this exact value after the constructor auto-detect change.
const DEFAULT_AUTH_URL = 'https://auth.oxy.so';

function installWindowLocation(hostname: string, protocol = 'https:'): void {
  (globalThis as unknown as { window: unknown }).window = {
    location: { hostname, protocol },
  };
}

function clearWindow(): void {
  delete (globalThis as Record<string, unknown>).window;
}

describe('OxyServices constructor — first-party authWebUrl auto-detection', () => {
  afterEach(() => {
    clearWindow();
  });

  it('leaves authWebUrl undefined on native/SSR (no window)', () => {
    // No `window` is installed -> autoDetectAuthWebUrl() returns undefined.
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    expect(oxy.config.authWebUrl).toBeUndefined();
    // Auth flows must still resolve to the hardcoded default on native.
    expect(oxy.config.authWebUrl || DEFAULT_AUTH_URL).toBe('https://auth.oxy.so');
  });

  it('derives auth.<apex> on web when authWebUrl is omitted', () => {
    installWindowLocation('mention.earth');

    const oxy = new OxyServices({ baseURL: 'https://api.mention.earth' });

    expect(oxy.config.authWebUrl).toBe('https://auth.mention.earth');
  });

  it('strips a leading subdomain down to the apex on web', () => {
    installWindowLocation('www.homiio.com');

    const oxy = new OxyServices({ baseURL: 'https://api.homiio.com' });

    expect(oxy.config.authWebUrl).toBe('https://auth.homiio.com');
  });

  it('derives auth.<host> for preview hosts (e.g. *.pages.dev)', () => {
    installWindowLocation('foo.pages.dev');

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    expect(oxy.config.authWebUrl).toBe('https://auth.pages.dev');
  });

  it('respects an explicit authWebUrl even when a window is present (explicit wins)', () => {
    installWindowLocation('mention.earth');

    const oxy = new OxyServices({
      baseURL: 'https://api.mention.earth',
      authWebUrl: 'https://auth.oxy.so',
    });

    // The page is mention.earth, but the caller pinned auth.oxy.so — honour it.
    expect(oxy.config.authWebUrl).toBe('https://auth.oxy.so');
  });

  it('does not mutate the caller-supplied config object', () => {
    installWindowLocation('mention.earth');

    const input = { baseURL: 'https://api.mention.earth' };
    const oxy = new OxyServices(input);

    // The stored config carries the detected IdP...
    expect(oxy.config.authWebUrl).toBe('https://auth.mention.earth');
    // ...but the caller's own object reference is untouched.
    expect((input as { authWebUrl?: string }).authWebUrl).toBeUndefined();
  });

  it('falls back to DEFAULT_AUTH_URL on host shapes auto-detect declines (localhost)', () => {
    installWindowLocation('localhost', 'http:');

    const oxy = new OxyServices({ baseURL: 'http://localhost:3000' });

    expect(oxy.config.authWebUrl).toBeUndefined();
    expect(oxy.config.authWebUrl || DEFAULT_AUTH_URL).toBe('https://auth.oxy.so');
  });
});
