import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { RedisStore } from "rate-limit-redis";
import type { RedisReply } from "rate-limit-redis";
import { getRedisClient } from "../config/redis";
import { AuthRequest } from "./auth";

const isProd = process.env.NODE_ENV !== 'development';

// Build Redis-backed store options if available, otherwise fall back to in-memory.
// Each limiter MUST pass a unique `prefix` so that hits land in distinct Redis
// keys; otherwise a request that flows through both the global limiter and a
// per-route limiter increments the same counter twice and express-rate-limit
// emits ERR_ERL_DOUBLE_COUNT (and the user's effective budget is halved).
function makeStore(prefix: string) {
  const redis = getRedisClient();
  if (!redis) return {};
  return {
    store: new RedisStore({
      prefix,
      sendCommand: (...args: string[]) =>
        redis.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
    }),
  };
}

/**
 * Paths hit ONLY by the first-party IdP worker (auth.oxy.so) server-to-server,
 * never by a browser directly:
 *   - GET /fedcm/clients/approved   (worker: resolveApprovedClientOrigin)
 *   - GET /fedcm/grants/:userId     (worker: fetchApprovedClients, X-Oxy-Internal)
 *   - GET /session/validate/:id     (worker: fetchUserFromAPI / validateSession)
 *   - POST /sso/code                (worker: mint SSO code, X-Oxy-Internal)
 *
 * The IdP worker fans EVERY user's /sso, /sso/establish, /auth/silent and FedCM
 * flow through these, from a small pool of shared Cloudflare egress IPs.
 * Subjecting them to the per-IP browser budget (rl:general 1000/15min) lets
 * normal multi-user traffic exhaust the budget on one worker IP → 429 → the IdP
 * fails closed (invalid_request on /sso, silent restore fails) → RP auth guards
 * re-bounce and amplify the load. These are trusted infrastructure calls, NOT
 * browser traffic, so they are excluded from the general per-IP limiter and
 * capped instead by their own dedicated limiters (idpServiceLimiter below for
 * the reads; the route-local secret-gated codeLimiter for POST /sso/code).
 *
 * MOUNT-ORDER INVARIANT: the general `rateLimiter` skips these paths, so any
 * path listed here MUST carry its OWN dedicated limiter at its route (reads →
 * `idpServiceLimiter`; /sso/code → its `rl:sso:code:` codeLimiter). Adding a
 * path here without a route-level limiter would leave it entirely unthrottled.
 * `/session/validate-header/` is intentionally NOT matched — it is bearer-cross-
 * checked and browser-reachable, so it stays under the general budget.
 */
export function isIdpServiceToServicePath(path: string): boolean {
  return (
    path === '/fedcm/clients/approved' ||
    path.startsWith('/fedcm/grants/') ||
    path.startsWith('/session/validate/') ||
    path === '/sso/code'
  );
}

// General rate limiting middleware (exclude file uploads). The previous
// ceiling of 150/15min was below what a single signed-in user generates
// against the API in normal usage (feed scrolling, profile loads, sockets'
// REST fallback, FedCM exchanges), which surfaced as misleading 429s on
// unrelated endpoints. The userRateLimiter below still caps per-account
// traffic. IdP worker server-to-server paths are skipped (see
// isIdpServiceToServicePath) so shared-egress traffic never exhausts this budget.
const rateLimiter = rateLimit({
  ...makeStore('rl:general:'),
  windowMs: 15 * 60 * 1000,
  max: isProd ? 1000 : 2000,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) =>
    req.path.startsWith('/files/upload') || isIdpServiceToServicePath(req.path),
});

// Dedicated high-ceiling limiter for the IdP worker's server-to-server READ
// calls (see isIdpServiceToServicePath). Because those paths are skipped by
// rl:general, this is their SOLE per-IP budget. The ceiling is deliberately
// high: each hit is the shared Cloudflare Worker egress fanning MANY users'
// FedCM/SSO flows through one IP, not a single browser — yet it still bounds a
// runaway or compromised caller. Unique prefix (`rl:fedcm:service:`) keeps its
// counter distinct from every other limiter (no ERR_ERL_DOUBLE_COUNT).
const idpServiceLimiter = rateLimit({
  ...makeStore('rl:fedcm:service:'),
  windowMs: 15 * 60 * 1000,
  max: isProd ? 20000 : 40000,
  message: "Too many requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.path.startsWith('/files/upload'),
});

// Per-IP rate limiting for /auth/*. This guards against blanket abuse of the
// auth surface; individual sensitive endpoints (/auth/challenge, /auth/verify,
// /auth/login, /auth/lookup, /auth/refresh, ...) layer their own tighter
// limiters on top. The ceiling here must stay well above realistic per-IP
// traffic for shared NAT egress (offices, mobile carriers): a single user
// signing in hits ~5–8 /auth/* endpoints, and active sessions refresh on
// /auth/refresh roughly every 15 minutes.
const authRateLimiter = rateLimit({
  ...makeStore('rl:auth:'),
  windowMs: 15 * 60 * 1000,
  max: isProd ? 300 : 2000,
  message: "Too many authentication attempts from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.path.startsWith('/files/upload'),
});

// Per-user rate limiting for authenticated requests
const userRateLimiter = rateLimit({
  ...makeStore('rl:user:'),
  windowMs: 15 * 60 * 1000,
  max: isProd ? 200 : 2000,
  message: "Too many requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return (req as AuthRequest).user?.id || req.ip || 'unknown';
  },
  skip: (req: Request) => {
    return req.path.startsWith('/files/upload') || !(req as AuthRequest).user;
  },
});

// Brute force protection middleware (exclude file uploads). Also skips the IdP
// worker's server-to-server paths (see isIdpServiceToServicePath): this is a
// sibling per-IP budget mounted alongside the general limiter, and its low
// delayAfter (100/15min) would otherwise add 500ms delays to the shared worker
// egress IP — a latency-based version of the same fail-closed amplification.
const bruteForceProtection = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: isProd ? 100 : 1000,
  delayMs: () => isProd ? 500 : 100,
  skip: (req: Request) =>
    req.path.startsWith('/files/upload') || isIdpServiceToServicePath(req.path),
});

/**
 * Security headers middleware using Helmet
 * Implements comprehensive HTTPS security headers following OWASP recommendations
 */
const securityHeaders = helmet({
  // Strict-Transport-Security: Enforce HTTPS for 1 year including subdomains
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,

  // Content-Security-Policy: Prevent XSS and data injection attacks
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },

  // X-Frame-Options: Prevent clickjacking attacks
  frameguard: {
    action: 'deny',
  },

  // Referrer-Policy: Control referrer information
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },

  // API is consumed cross-origin by multiple frontend apps —
  // same-origin (Helmet default) blocks <img>, fetch, etc.
  crossOriginResourcePolicy: { policy: 'cross-origin' as const },

  // Not needed for API servers; can interfere with cross-origin consumers
  crossOriginOpenerPolicy: false,

  // X-Content-Type-Options: Prevent MIME type sniffing (enabled by default)
  // X-DNS-Prefetch-Control: Control browser DNS prefetching
  // X-Download-Options: Prevent IE from executing downloads in site context
  // X-Permitted-Cross-Domain-Policies: Restrict Adobe Flash and PDF
});

export { rateLimiter, idpServiceLimiter, authRateLimiter, userRateLimiter, bruteForceProtection, securityHeaders };
