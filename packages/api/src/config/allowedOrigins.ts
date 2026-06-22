/**
 * Allowed Origins — single source of truth (MED-1 CSRF hardening, Phase A)
 *
 * Shared by the CORS middleware (config/cors.ts) and the Origin guard
 * (middleware/originGuard.ts) so both layers enforce the exact same policy.
 *
 * Policy:
 *  - Exact first-party apex origins (https only).
 *  - One-level https subdomains of the first-party zones (lowercase
 *    RFC 1123-ish labels only — uppercase, unicode/homograph, ports, paths,
 *    and suffix-spoofing like `oxy.so.evil.com` all fail the anchored regex).
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
  'https://mention.earth',
  'https://homiio.com',
  'https://alia.onl',
  'https://syra.fm',
  'https://moovo.now',
]);

const ALLOWED_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https:\/\/[a-z0-9-]+\.oxy\.so$/,
  /^https:\/\/[a-z0-9-]+\.mention\.earth$/,
  /^https:\/\/[a-z0-9-]+\.homiio\.com$/,
  /^https:\/\/[a-z0-9-]+\.alia\.onl$/,
  /^https:\/\/[a-z0-9-]+\.syra\.fm$/,
  /^https:\/\/[a-z0-9-]+\.moovo\.now$/,
];

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

  if (ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))) {
    return true;
  }

  if (process.env.NODE_ENV !== 'production' && DEV_ORIGIN_PATTERN.test(origin)) {
    return true;
  }

  return getExtraAllowedOrigins().has(origin);
}
