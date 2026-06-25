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
 *   - Hostnames where a registrable domain cannot be determined from the
 *     Public Suffix List, including private hosted suffixes such as
 *     `github.io`, `pages.dev`, and `netlify.app`.
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

import { getDomain } from 'tldts';

/**
 * Compute the bare registrable apex (eTLD+1) of a hostname using the Public
 * Suffix List, including private hosted suffixes.
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
 *   - public suffixes without a registrable label (e.g. `co.uk`, `github.io`).
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
  // The Public Suffix List (private suffixes included) is the source of truth
  // for what an attacker can register. A multi-part public suffix like `co.uk`
  // or a hosted suffix like `github.io` returns no registrable domain, so
  // deriving `auth.<apex>` against it is impossible — `getDomain` returns null.
  return getDomain(host, { allowPrivateDomains: true });
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
