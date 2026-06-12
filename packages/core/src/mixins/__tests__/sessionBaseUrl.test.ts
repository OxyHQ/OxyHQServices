/**
 * `OxyServices.getSessionBaseUrl()` resolution tests.
 *
 * Per the 2026 session architecture (docs/SESSION-ARCHITECTURE.md), every app
 * keeps its OWN first-party session on its OWN domain. `getSessionBaseUrl()`
 * is the configurable base URL the SDK's first-party session/refresh calls will
 * target in a later phase:
 *   - non-`oxy.so` apps point `sessionBaseUrl` at their own same-site backend
 *     (e.g. `https://api.mention.earth`);
 *   - `*.oxy.so` apps leave it unset so it falls back to `baseURL`
 *     (`https://api.oxy.so`) — their behavior is unchanged.
 *
 * This phase is additive: the getter only surfaces configuration. It must NOT
 * mutate token/auth state and must NOT alter `getBaseURL()`.
 */

import { OxyServices } from '../../OxyServices';

describe('OxyServices.getSessionBaseUrl', () => {
  it('falls back to baseURL when sessionBaseUrl is not configured', () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    expect(oxy.getSessionBaseUrl()).toBe('https://api.oxy.so');
    // Must equal the API base URL exactly — no divergence for *.oxy.so apps.
    expect(oxy.getSessionBaseUrl()).toBe(oxy.getBaseURL());
  });

  it('returns the configured sessionBaseUrl when provided', () => {
    const oxy = new OxyServices({
      baseURL: 'https://api.oxy.so',
      sessionBaseUrl: 'https://api.mention.earth',
    });

    expect(oxy.getSessionBaseUrl()).toBe('https://api.mention.earth');
  });

  it('does not change the API base URL when sessionBaseUrl differs', () => {
    const oxy = new OxyServices({
      baseURL: 'https://api.oxy.so',
      sessionBaseUrl: 'https://api.mention.earth',
    });

    // getBaseURL (the HTTP client's request base) is independent of the
    // session base — only the latter is overridden by config.
    expect(oxy.getBaseURL()).toBe('https://api.oxy.so');
    expect(oxy.getSessionBaseUrl()).not.toBe(oxy.getBaseURL());
  });

  it('is a pure read — it does not touch token/auth state', () => {
    const oxy = new OxyServices({
      baseURL: 'https://api.oxy.so',
      sessionBaseUrl: 'https://api.mention.earth',
    });

    expect(oxy.hasValidToken()).toBe(false);
    // Resolving the session base must not plant or clear any token.
    oxy.getSessionBaseUrl();
    expect(oxy.hasValidToken()).toBe(false);
    expect(oxy.getAccessToken()).toBeNull();
  });
});
