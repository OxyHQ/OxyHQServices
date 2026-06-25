/**
 * Auto-detect the FAPI (IdP) URL from the current browser hostname.
 *
 * This is the canonical cross-domain IdP-resolution primitive for the Oxy
 * ecosystem. Both candidate cross-domain SSO designs derive `auth.<rp-apex>`
 * through this helper; do not fork it.
 *
 * Clerk-style multi-domain SSO depends on the IdP being reachable on a
 * subdomain of the RP's own apex (e.g. `auth.mention.earth` CNAMEd to the
 * central Oxy IdP). That way every FedCM endpoint, the session cookie,
 * and any redirect target are same-site with the RP — the only way
 * to get first-party cookies in Safari ITP and Firefox Total Cookie
 * Protection.
 *
 * This helper computes `https://auth.<rp-apex>` from
 * `window.location.hostname` so a consuming app doesn't have to pass
 * `authWebUrl` explicitly. Returns `undefined` for environments where
 * auto-detection would be wrong:
 *
 *   - SSR / non-browser (no `window`).
 *   - `localhost`, `127.0.0.1`, IPv4/IPv6 literals.
 *   - Hostnames with fewer than two labels.
 *   - Hostnames whose trailing two labels form a known multi-part public
 *     suffix (e.g. `co.uk`), where the naive `labels.slice(-2)` apex would be
 *     an attacker-registrable suffix like `auth.co.uk` rather than the real
 *     registrable domain.
 *
 * When the page is already loaded ON the IdP itself (`auth.<anything>`),
 * the helper returns the current origin so the SDK keeps everything
 * same-origin instead of hopping to a different IdP host.
 *
 * The IdP backend independently derives `iss`, `provider_urls`, and the
 * `fedcm.json` icon URLs from the request host
 * (`packages/auth/server/index.ts`), so an honest CNAME pair is all that
 * is required for end-to-end FedCM correctness — no per-RP config.
 */

/**
 * Known multi-part public suffixes where the registrable domain is the LAST
 * THREE labels, not two. Deriving an apex from `labels.slice(-2)` against any
 * of these would yield an attacker-registrable suffix (e.g. `auth.co.uk`),
 * so we bail out instead.
 *
 * This is intentionally a small, explicit allow-list rather than the full
 * Public Suffix List — it covers the suffixes the Oxy ecosystem's RPs use.
 * Any multi-part-TLD RP MUST extend this set (or wire in a proper PSL check)
 * before relying on this helper, otherwise auto-detection silently bails to
 * `undefined` and the consumer must pass `authWebUrl` explicitly.
 */
export const MULTIPART_TLDS: ReadonlySet<string> = new Set([
  'co.uk',
  'com.au',
  'co.jp',
  'co.nz',
  'com.br',
  'co.za',
  'com.mx',
  'co.in',
  'co.kr',
  'com.sg',
]);

/**
 * Shared / multi-tenant hosting suffixes where arbitrary tenants can register
 * sibling subdomains. Auto-detecting `auth.<suffix>` for an app hosted at
 * `<tenant>.<suffix>` would trust a host that the RP does not control (for
 * example `victim.pages.dev` -> `auth.pages.dev`), so these suffixes are
 * treated like public suffixes and require an explicit `authWebUrl`.
 */
export const SHARED_HOSTING_SUFFIXES: ReadonlySet<string> = new Set([
  'pages.dev',
  'github.io',
  'appspot.com',
  'vercel.app',
  'netlify.app',
  'herokuapp.com',
  'firebaseapp.com',
  'web.app',
  'surge.sh',
  'glitch.me',
]);

/**
 * Compute the bare registrable apex (eTLD+1) of a hostname, guarding against
 * multi-part public suffixes.
 *
 * This is the pure host-handling kernel shared by {@link autoDetectAuthWebUrl}
 * and the IdP worker — it performs NO protocol handling, NO `auth.` prefixing,
 * and builds NO URL. It only answers "what is the registrable domain of this
 * host, or is that undefinable?".
 *
 * Returns `null` (apex undefinable) for:
 *   - empty input;
 *   - IPv4 literals (`192.168.1.10`);
 *   - IPv6 literals or any host carrying a port (`[::1]`, anything with `:`);
 *   - single-label hosts (`intranet`, `localhost`);
 *   - hosts whose trailing two labels form a known multi-part public suffix
 *     (e.g. `foo.co.uk`), where `labels.slice(-2)` would yield an
 *     attacker-registrable suffix (`co.uk`) rather than a real registrable
 *     domain. Such hosts MUST configure `authWebUrl` explicitly.
 *
 * @param hostname - A bare hostname (no scheme), e.g. `www.mention.earth`.
 * @returns The eTLD+1 (`mention.earth`), or `null` when undefinable.
 */
export function registrableApex(hostname: string): string | null {
  if (!hostname) return null;
  const host = hostname.toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  // IPv6 literals are bracketed; any remaining ':' implies a port — neither
  // yields a registrable apex.
  if (host.startsWith('[') || host.includes(':')) return null;
  const labels = host.split('.');
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTIPART_TLDS.has(lastTwo) || SHARED_HOSTING_SUFFIXES.has(lastTwo)) return null;
  return lastTwo;
}

export function autoDetectAuthWebUrl(
  location: Pick<Location, 'hostname' | 'protocol'> | undefined =
    typeof window !== 'undefined' ? window.location : undefined
): string | undefined {
  if (!location) return undefined;
  const { hostname, protocol } = location;
  if (!hostname) return undefined;
  if (protocol !== 'https:' && protocol !== 'http:') return undefined;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return undefined;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return undefined;
  if (hostname.startsWith('[')) return undefined;
  // Already ON the IdP — keep everything same-origin instead of hopping to a
  // sibling host.
  if (hostname.startsWith('auth.')) {
    return `${protocol}//${hostname}`;
  }
  const apex = registrableApex(hostname);
  if (apex === null) return undefined;
  return `${protocol}//auth.${apex}`;
}
