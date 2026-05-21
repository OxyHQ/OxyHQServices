/**
 * Redirect URL allowlist validation
 *
 * Validates that user-supplied redirect URLs (Stripe success/cancel URLs, OAuth return URLs,
 * billing portal return URLs, etc.) point to domains we own. Protects against open redirect
 * vulnerabilities where attackers craft phishing flows that bounce through our API.
 *
 * Configure allowed hosts via env var `OXY_ALLOWED_REDIRECT_DOMAINS` (comma-separated).
 * Defaults to `oxy.so,localhost` for safety when not configured.
 *
 * Matching rules:
 * - Exact hostname match (e.g. `oxy.so` matches `oxy.so`)
 * - Subdomain match (e.g. `oxy.so` matches `accounts.oxy.so` and `console.oxy.so`)
 * - Production: https only; localhost may use http
 * - Non-production: http allowed (dev convenience)
 */

import { isProduction } from '../config/env';

const DEFAULT_ALLOWED_DOMAINS = 'oxy.so,localhost';

let _cachedAllowedDomains: string[] | null = null;

/** Read and normalize the allowlist from env. Cached for the lifetime of the process. */
function getAllowedDomains(): string[] {
  if (_cachedAllowedDomains) return _cachedAllowedDomains;
  const raw = process.env.OXY_ALLOWED_REDIRECT_DOMAINS || DEFAULT_ALLOWED_DOMAINS;
  _cachedAllowedDomains = raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
  return _cachedAllowedDomains;
}

/**
 * Reset the cached allowlist. Test-only; production callers should rely on the cache.
 */
export function _resetRedirectAllowlistCache(): void {
  _cachedAllowedDomains = null;
}

/**
 * Returns true if the URL is safe to use as a redirect target.
 *
 * - Must parse as a valid URL
 * - Hostname must match an entry in `OXY_ALLOWED_REDIRECT_DOMAINS` (exact or subdomain)
 * - In production, only `https:` is allowed (except `http://localhost` for tooling)
 */
export function isAllowedRedirect(urlStr: string): boolean {
  if (typeof urlStr !== 'string' || urlStr.length === 0) return false;

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  const protocol = url.protocol;

  // Only http/https — reject javascript:, data:, file:, etc.
  if (protocol !== 'https:' && protocol !== 'http:') return false;

  // In production, require https unless the host is localhost (for local tooling)
  if (isProduction() && protocol === 'http:' && hostname !== 'localhost') {
    return false;
  }

  // Match hostname against allowed list (exact or subdomain)
  const allowed = getAllowedDomains();
  for (const domain of allowed) {
    if (hostname === domain) return true;
    if (hostname.endsWith(`.${domain}`)) return true;
  }

  return false;
}
