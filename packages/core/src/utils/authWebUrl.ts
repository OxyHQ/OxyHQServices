/**
 * Central IdP (auth web) URL resolution for cross-domain SSO.
 *
 * The Oxy ecosystem runs a single, central Identity Provider at
 * `auth.oxy.so`. For TRUE central cross-domain SSO (Google/Meta/Clerk style),
 * FedCM and the opaque-code SSO bounce always target this one origin — it owns
 * the host-only `fedcm_session` cookie and the central session store reachable
 * via `api.oxy.so`. Relying Parties (mention.earth, homiio.com, alia.onl, …)
 * delegate to it rather than standing up a per-apex IdP.
 *
 * This module is intentionally pure: it performs no DOM access, reads no
 * `window`/`location`, and has no side effects. It is the single source of
 * truth for the central IdP origin so call sites never hardcode the literal.
 *
 * Note: this is distinct from `autoDetectAuthWebUrl` (per-apex `auth.<rp-apex>`
 * derivation). The central-SSO path deliberately does NOT auto-detect per-apex
 * IdPs — it is central only. An explicitly-configured `authWebUrl` still wins.
 */

/**
 * The canonical central Identity Provider origin for the Oxy ecosystem.
 * No trailing slash.
 */
export const CENTRAL_AUTH_URL = 'https://auth.oxy.so';

/**
 * Resolve the central IdP origin, honouring an explicit override.
 *
 * @param explicit - A caller-supplied auth web URL, or `undefined`/empty to use
 *   the central default. An explicit non-empty value always wins.
 * @returns The explicit value when provided, otherwise {@link CENTRAL_AUTH_URL}.
 */
export function resolveCentralAuthUrl(explicit?: string): string {
  return explicit ?? CENTRAL_AUTH_URL;
}
