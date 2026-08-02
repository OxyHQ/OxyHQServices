/**
 * WebAuthn relying-party origin guard (client side).
 *
 * The passkey ceremonies (`OxyServices.webauthn*`) are only meaningful when the
 * page is served from a first-party Oxy web origin: a credential minted with
 * `WEBAUTHN_RP_ID=oxy.so` can only be created/asserted from `oxy.so`, one of its
 * subdomains, or a loopback dev server. This is the browser-side mirror of the
 * server's `isOxyApexOrigin` (`packages/api/src/utils/origin.ts`), which forms
 * the server's `expectedOrigin` allow-set — consumers use it to decide whether to
 * even offer the passkey UI on the current page.
 *
 * It reads `globalThis.location` directly (no argument) because that is the only
 * origin the browser will let a WebAuthn ceremony run against. On native / SSR /
 * any environment without a DOM `location`, it returns `false` (there is no
 * relying-party origin, so passkeys are not applicable).
 */

/**
 * True iff the current page's host is a first-party Oxy relying-party origin:
 * `oxy.so`, any `*.oxy.so` subdomain, or a loopback dev host
 * (`localhost` / `127.0.0.1` / `[::1]`).
 *
 * Fails closed: no `location` (native/SSR), a non-string/empty hostname, or a
 * host that merely ends in the literal `oxy.so` without the dot boundary
 * (`evil-oxy.so`, `oxy.so.evil.com`) all return `false`.
 *
 * @example
 *   isOxyRpOrigin() // true  on https://accounts.oxy.so
 *   isOxyRpOrigin() // true  on http://localhost:8081
 *   isOxyRpOrigin() // false on https://evil.com
 *   isOxyRpOrigin() // false in a React Native / SSR context (no location)
 */
export function isOxyRpOrigin(): boolean {
  // `globalThis.location` is typed `Location` by the DOM lib, but is genuinely
  // `undefined` on native/SSR — widen to a nullable local so the guard is a real
  // runtime check, not a type-level no-op.
  const location: Location | undefined = globalThis.location;
  if (!location || typeof location.hostname !== 'string') {
    return false;
  }

  const hostname = location.hostname.toLowerCase();
  if (hostname.length === 0) {
    return false;
  }

  if (hostname === 'oxy.so' || hostname.endsWith('.oxy.so')) {
    return true;
  }

  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
