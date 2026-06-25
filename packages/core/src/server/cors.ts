/**
 * Strict CORS allowlist for Oxy backends.
 *
 * WHY THIS EXISTS
 * ---------------
 * App backends kept hand-rolling CORS, and the unsafe patterns recurred:
 *   - `Access-Control-Allow-Origin: *` together with credentials (which is
 *     spec-invalid AND a credential-leak vector), or
 *   - a "reflect whatever Origin the request carried" fallback (effectively
 *     `*` for credentialed requests — the Allo wildcard-fallback class).
 *
 * `createOxyCors` returns a self-contained Express middleware (no `cors`
 * package dependency) that:
 *   - allows the Oxy apex origin family over HTTPS only: the apex plus
 *     one-label subdomains such as `auth.oxy.so`, `api.oxy.so`,
 *     `accounts.oxy.so`, `console.oxy.so`, and `inbox.oxy.so`,
 *   - allows the caller's explicit `appOrigins`,
 *   - DENIES everything else (no reflection, never a wildcard with credentials),
 *   - echoes back the EXACT matched origin (so credentialed requests work) and
 *     sets `Vary: Origin` for correct caching,
 *   - answers CORS preflight (`OPTIONS`) with `204`.
 *
 * Node/Express-only: exported solely from `@oxyhq/core/server`.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { CENTRAL_IDP_APEX } from '../utils/authWebUrl';

/** Default HTTP methods allowed across origins. */
const DEFAULT_ALLOWED_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'];

/** Default request headers a browser may send on a credentialed cross-origin call. */
const DEFAULT_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Requested-With',
  'X-Oxy-User-Id',
  'X-Oxy-Internal',
  'X-CSRF-Token',
];

/** How long (seconds) a browser may cache a successful preflight. */
const DEFAULT_MAX_AGE_SECONDS = 86_400;

const OXY_ONE_LABEL_SUBDOMAIN_PATTERN = new RegExp(
  `^[a-z0-9-]+\\.${CENTRAL_IDP_APEX.replace('.', '\\.')}$`,
);

export interface OxyCorsOptions {
  /**
   * Explicit additional allowed origins (exact-origin match, e.g.
   * `https://app.example.com`, `http://localhost:3000`). These are allowed IN
   * ADDITION TO the built-in HTTPS Oxy apex origin family. Each is normalized
   * via `new URL().origin`.
   */
  appOrigins?: string[];
  /**
   * Whether to emit `Access-Control-Allow-Credentials: true`. Default `true`
   * (the Oxy ecosystem uses cookie/bearer credentials). Even when `true`, the
   * helper NEVER emits a wildcard origin — only an exact matched origin.
   */
  allowCredentials?: boolean;
  /** HTTP methods to allow. Defaults to the full standard set. */
  methods?: string[];
  /** Request headers to allow. Defaults to the common Oxy set. */
  allowedHeaders?: string[];
  /** Response headers to expose to the browser. Defaults to none. */
  exposedHeaders?: string[];
  /** Preflight cache lifetime in seconds. Default 86400 (24h). */
  maxAgeSeconds?: number;
}

/**
 * Whether `candidate` belongs to the built-in Oxy apex origin family. This
 * intentionally mirrors the API allowlist shape: HTTPS only, no custom port,
 * the apex itself (`https://oxy.so`), or exactly one lowercase subdomain label
 * (`https://auth.oxy.so`, `https://api.oxy.so`, …).
 *
 * Arbitrary/multi-level subdomains and `http://*.oxy.so` are not implicitly
 * trusted for credentialed CORS. If a service needs a non-standard development
 * or tenant origin, it must opt in explicitly via `appOrigins`.
 */
function isOxyFamilyOrigin(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.port !== '') return false;

    const hostname = url.hostname;
    if (hostname === CENTRAL_IDP_APEX) return true;

    return OXY_ONE_LABEL_SUBDOMAIN_PATTERN.test(hostname);
  } catch {
    return false;
  }
}

/** Normalize a raw origin string to its canonical `scheme://host[:port]` form. */
function normalizeOrigin(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Build the origin-matching predicate: true iff `origin` is in the built-in
 * HTTPS Oxy apex family OR exactly matches one of the configured app origins.
 */
function buildOriginAllowed(appOrigins: string[]): (origin: string) => boolean {
  const explicit = new Set<string>();
  for (const raw of appOrigins) {
    const normalized = normalizeOrigin(raw);
    if (normalized) explicit.add(normalized);
  }
  return (origin: string): boolean => {
    const normalized = normalizeOrigin(origin);
    if (normalized === null) return false;
    if (explicit.has(normalized)) return true;
    return isOxyFamilyOrigin(normalized);
  };
}

/**
 * Create a strict Oxy CORS middleware. See module docs.
 *
 * @example
 * ```ts
 * app.use(createOxyCors({ appOrigins: ['https://app.example.com'] }));
 * ```
 */
export function createOxyCors(options: OxyCorsOptions = {}): RequestHandler {
  const {
    appOrigins = [],
    allowCredentials = true,
    methods = DEFAULT_ALLOWED_METHODS,
    allowedHeaders = DEFAULT_ALLOWED_HEADERS,
    exposedHeaders = [],
    maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
  } = options;

  const isOriginAllowed = buildOriginAllowed(appOrigins);
  const methodsHeader = methods.join(', ');
  const allowedHeadersHeader = allowedHeaders.join(', ');
  const exposedHeadersHeader = exposedHeaders.join(', ');

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    // Same-origin or non-browser requests carry no Origin header — pass through
    // untouched (no ACAO header is emitted, which is correct for them).
    if (typeof origin !== 'string' || origin.length === 0) {
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
      return;
    }

    // Origin is present. Caching correctness: this response varies by Origin.
    res.setHeader('Vary', 'Origin');

    if (!isOriginAllowed(origin)) {
      // DENY: do NOT reflect the origin, do NOT emit a wildcard. The browser
      // will block the cross-origin read. Preflights for denied origins get a
      // 204 with no CORS headers (the actual request then fails CORS).
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
      return;
    }

    // ALLOW: echo the EXACT matched origin — never `*`, even without credentials.
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (allowCredentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (exposedHeadersHeader) {
      res.setHeader('Access-Control-Expose-Headers', exposedHeadersHeader);
    }

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', methodsHeader);
      // Honour the browser's requested headers when present, else the default set.
      const requested = req.headers['access-control-request-headers'];
      res.setHeader(
        'Access-Control-Allow-Headers',
        typeof requested === 'string' && requested.length > 0 ? requested : allowedHeadersHeader,
      );
      res.setHeader('Access-Control-Max-Age', String(maxAgeSeconds));
      res.sendStatus(204);
      return;
    }

    next();
  };
}
