import type { Request, RequestHandler } from 'express';
import rateLimit, { type Store } from 'express-rate-limit';
import type { OxyServices } from '../OxyServices';

/**
 * Server-only rate limiting for Oxy backends.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every Oxy backend previously shipped its own copy-pasted `security.ts`
 * implementing the same per-user/per-IP rate limiter — and every copy carried
 * the same latent bug: the limiter ran BEFORE the session was resolved, so
 * `req.user` was always undefined inside it. Consequences:
 *   1. Authenticated users got the low ANONYMOUS limit.
 *   2. Requests were keyed by IP. Behind a shared load balancer (e.g. the AWS
 *      ALB) many users share one egress IP, so a single bucket was split across
 *      all of them → frequent, spurious HTTP 429s.
 *
 * `@oxyhq/core` already owns the session: `oxy.auth()` resolves `req.user` /
 * `req.userId`. Per-user rate limiting is the same concern (session identity),
 * so it belongs here — once — instead of being re-implemented per app.
 *
 * WHAT IT PROVIDES
 * ----------------
 * `createOxyRateLimit(oxy, options)` returns a SINGLE composed middleware that:
 *   1. Resolves the user via `oxy.auth({ optional: true })` (idempotent — it
 *      skips re-verification if a prior middleware already set `req.user`).
 *   2. Applies an `express-rate-limit` limiter keyed PER USER when
 *      authenticated, falling back to the (IPv6-safe) IP otherwise, with
 *      generous, media-app-realistic defaults and sensible exemptions.
 *
 * Mount it after CORS and before your routers:
 * ```ts
 * app.use(cors(...));
 * app.use(oxy.rateLimit({ store }));   // resolves session + limits per user
 * app.use('/api', apiRouter);
 * ```
 */

/** Minimal shape of the request after Oxy session resolution. */
interface OxyAuthedRequest extends Request {
  userId?: string | null;
  user?: { id?: string; _id?: string } | null;
}

export interface OxyRateLimitOptions {
  /**
   * Max requests per window for AUTHENTICATED users (keyed per user).
   * Default 5000 — ~5.5 req/s sustained, comfortable for a media client that
   * fans out into many small requests per screen.
   */
  authenticatedMax?: number;
  /**
   * Max requests per window for ANONYMOUS callers (keyed per IP).
   * Default 600 — enough to browse public pages while bounding abuse.
   */
  anonymousMax?: number;
  /** Rate-limit window in milliseconds. Default 15 minutes. */
  windowMs?: number;
  /**
   * Optional `express-rate-limit` store (e.g. a Redis store) for distributed
   * limiting across instances. Defaults to the library's in-memory store.
   */
  store?: Store;
  /**
   * Extra path predicates to exempt from limiting, in addition to the built-in
   * exemptions (uploads, image proxy, streaming sub-requests, health probes,
   * CORS preflight). Return `true` to skip limiting for the request.
   */
  exempt?: (req: Request) => boolean;
  /** Response message body sent with a 429. */
  message?: string;
  /**
   * Options forwarded to the internal `oxy.auth({ optional: true })` resolver
   * (e.g. `{ jwtSecret }` to verify service tokens). `optional` is forced true.
   */
  auth?: Parameters<OxyServices['auth']>[0];
}

/**
 * Built-in exemptions. A media app's cover-art/avatar fan-out and HLS
 * sub-requests must not consume the coarse global budget; health probes from
 * the load balancer must never be limited; CORS preflight is not a real call.
 */
function isBuiltInExempt(req: Request): boolean {
  const path = req.path;
  return (
    req.method === 'OPTIONS' ||
    path.startsWith('/files/upload') ||
    path.includes('/images/') ||
    path.includes('/media/') ||
    path.startsWith('/api/stream/') ||
    path.includes('/stream/') ||
    path === '/health' ||
    path.endsWith('/health')
  );
}

/** IPv6-safe IP key generator (replaces colons to avoid Redis namespace issues). */
function ipKeyGenerator(ip: string): string {
  return ip.replace(/:/g, '_');
}

/** Resolve the rate-limit key: per authenticated user, else per (IPv6-safe) IP. */
function resolveKey(req: OxyAuthedRequest): string {
  const userId = req.userId ?? req.user?.id ?? req.user?._id;
  if (userId) {
    return `user:${userId}`;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return ipKeyGenerator(ip);
}

/**
 * Build the composed Oxy rate-limit middleware. See module docs for rationale.
 */
export function createOxyRateLimit(
  oxy: OxyServices,
  options: OxyRateLimitOptions = {},
): RequestHandler {
  const {
    authenticatedMax = 5000,
    anonymousMax = 600,
    windowMs = 15 * 60 * 1000,
    store,
    exempt,
    message = 'Too many requests, please try again later.',
    auth,
  } = options;

  // Idempotent optional-auth resolver. Reuses the SAME session resolution as
  // every protected route, so the limiter keys by the real user identity.
  const resolveSession = oxy.auth({ ...auth, optional: true });

  const skip = (req: Request): boolean =>
    isBuiltInExempt(req) || (exempt ? exempt(req) : false);

  const limiter = rateLimit({
    windowMs,
    ...(store ? { store } : {}),
    max: (req: Request): number => {
      const authed = req as OxyAuthedRequest;
      const userId = authed.userId ?? authed.user?.id ?? authed.user?._id;
      return userId ? authenticatedMax : anonymousMax;
    },
    keyGenerator: (req: Request): string => resolveKey(req as OxyAuthedRequest),
    message,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
  });

  return (req, res, next) => {
    // Skipped paths bypass BOTH session resolution and limiting — cheap and
    // safe for static/streaming/health traffic.
    if (skip(req)) {
      next();
      return;
    }
    resolveSession(req, res, (err?: unknown) => {
      if (err) {
        // Optional auth never rejects; a token error just means "anonymous".
        // Swallow the error and continue to limit as anonymous.
        next();
        return;
      }
      limiter(req, res, next);
    });
  };
}
