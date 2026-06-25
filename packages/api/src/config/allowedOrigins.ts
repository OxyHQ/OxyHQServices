/**
 * Allowed Origins — single source of truth (MED-1 CSRF hardening, Phase A)
 *
 * Shared by the CORS middleware (config/cors.ts) and the Origin guard
 * (middleware/originGuard.ts) so both layers enforce the exact same policy.
 *
 * Policy:
 *  - Exact first-party apex origins and explicitly registered first-party app
 *    origins (https only).
 *  - No wildcard subdomain trust: same-site tenant/user subdomains must not be
 *    able to make credentialed CORS requests to bearer-minting endpoints.
 *  - `http://localhost[:port]` / `http://127.0.0.1[:port]` ONLY outside
 *    production.
 *  - Optional emergency escape hatch via `OXY_EXTRA_ALLOWED_ORIGINS`
 *    (comma-separated `https://<hostname>` entries, each hostname validated
 *    with the same strict `isValidHostname` used for cookie domains).
 */

import { isValidHostname } from './env';
import { logger } from '../utils/logger';

const EXACT_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'https://oxy.so',
  'https://api.oxy.so',
  'https://accounts.oxy.so',
  'https://allo.oxy.so',
  'https://auth.oxy.so',
  'https://cloud.oxy.so',
  'https://console.oxy.so',
  'https://inbox.oxy.so',
  'https://noted.oxy.so',
  'https://pay.oxy.so',
  'https://syra.oxy.so',
  'https://mention.earth',
  'https://api.mention.earth',
  'https://auth.mention.earth',
  'https://homiio.com',
  'https://app.homiio.com',
  'https://auth.homiio.com',
  'https://alia.onl',
  'https://api.alia.onl',
  'https://auth.alia.onl',
  'https://syra.fm',
  'https://moovo.now',
  'https://go.moovo.now',
  'https://hub.moovo.now',
  'https://mercaria.co',
  'https://dashboard.mercaria.co',
  'https://pos.mercaria.co',
]);

const DEV_ORIGIN_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

const HTTPS_PREFIX = 'https://';

/**
 * Parse + validate `OXY_EXTRA_ALLOWED_ORIGINS`. Each entry must be an
 * `https://<hostname>` origin whose hostname passes the strict
 * `isValidHostname` check. Invalid entries are logged and dropped — they
 * never widen the allowlist.
 *
 * Memoized on the raw env value so per-request lookups stay O(1) while
 * still picking up changes (tests, hot reconfiguration).
 */
let extraOriginsCacheKey: string | undefined;
let extraOriginsCache: ReadonlySet<string> = new Set();

function getExtraAllowedOrigins(): ReadonlySet<string> {
  const raw = process.env.OXY_EXTRA_ALLOWED_ORIGINS ?? '';
  if (raw === extraOriginsCacheKey) {
    return extraOriginsCache;
  }

  const parsed = new Set<string>();
  for (const entry of raw.split(',')) {
    const candidate = entry.trim();
    if (candidate.length === 0) {
      continue;
    }
    if (!candidate.startsWith(HTTPS_PREFIX)) {
      logger.warn('OXY_EXTRA_ALLOWED_ORIGINS entry rejected: not https', { entry: candidate });
      continue;
    }
    const hostname = candidate.slice(HTTPS_PREFIX.length);
    if (!isValidHostname(hostname)) {
      logger.warn('OXY_EXTRA_ALLOWED_ORIGINS entry rejected: invalid hostname', { entry: candidate });
      continue;
    }
    parsed.add(candidate);
  }

  extraOriginsCacheKey = raw;
  extraOriginsCache = parsed;
  return parsed;
}

/**
 * Strict Origin allowlist check. Comparison is case-sensitive on purpose:
 * browsers always send lowercase scheme + host, so anything else
 * (`https://EVIL.oxy.so`, homograph hosts) is not a legitimate browser
 * origin for our zones.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (EXACT_ALLOWED_ORIGINS.has(origin)) {
    return true;
  }

  if (process.env.NODE_ENV !== 'production' && DEV_ORIGIN_PATTERN.test(origin)) {
    return true;
  }

  return getExtraAllowedOrigins().has(origin);
}
