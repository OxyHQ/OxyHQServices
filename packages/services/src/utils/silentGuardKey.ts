/**
 * Shared, pure helpers for building the `origin|baseURL` signature used as the
 * module-level run-once guard key for cold-boot silent-SSO probes
 * (`silentColdBootKey` in `OxyContext`, `ssoSignature` in `useWebSSO`).
 *
 * NATIVE SAFETY (the bug this fixes): React Native aliases a global `window`
 * (it points at the JS global object), so `typeof window !== 'undefined'` is
 * `true` on native — but `window.location` is `undefined`. Reading
 * `window.location.origin` after only a `typeof window` check therefore throws
 * `TypeError: Cannot read property 'origin' of undefined` on native. Because
 * the key is built UNCONDITIONALLY at the top of the cold-boot path (before its
 * try/catch), that throw escaped session restore entirely and broke
 * cross-session restore on native. Both prior copies of the guard had the same
 * insufficient `typeof window` check and were prone to drift, so the read is
 * consolidated here behind a guard that also verifies `window.location`.
 */

/**
 * Read `window.location.origin` safely on every platform.
 *
 * Returns the browser origin on web, and the sentinel `'no-origin'` anywhere
 * `window.location` is absent (React Native, SSR/Node). Never throws.
 */
export function safeWindowOrigin(): string {
  if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
    return window.location.origin;
  }
  return 'no-origin';
}

/**
 * Build the stable `origin|baseURL` signature for the silent-SSO run-once
 * guard. Two providers pointed at the same API from the same origin share one
 * attempt. `getBaseURL` is invoked defensively (it may be absent or throw on a
 * partially-initialised client); any failure degrades to an empty baseURL.
 */
export function buildSilentGuardKey(getBaseURL?: () => string | undefined): string {
  const origin = safeWindowOrigin();
  let baseURL = '';
  try {
    baseURL = getBaseURL?.() ?? '';
  } catch {
    baseURL = '';
  }
  return `${origin}|${baseURL}`;
}
