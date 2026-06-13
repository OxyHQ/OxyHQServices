/**
 * Auto-detect the FAPI (IdP) URL from the current browser hostname.
 *
 * Clerk-style multi-domain SSO depends on the IdP being reachable on a
 * subdomain of the RP's own apex (e.g. `auth.mention.earth` CNAMEd to the
 * central Oxy IdP). That way every FedCM endpoint, the session cookie,
 * and any popup/redirect target are same-site with the RP — the only way
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
  if (hostname.startsWith('auth.')) {
    return `${protocol}//${hostname}`;
  }
  const labels = hostname.split('.');
  if (labels.length < 2) return undefined;
  const apex = labels.slice(-2).join('.');
  return `${protocol}//auth.${apex}`;
}
