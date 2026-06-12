import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { RedisStore } from "rate-limit-redis";
import type { RedisReply } from "rate-limit-redis";
import { getRedisClient } from "../config/redis";
import { AuthRequest } from "./auth";

const isProd = process.env.NODE_ENV !== 'development';

// Build Redis-backed store options if available, otherwise fall back to in-memory
function makeStore() {
  const redis = getRedisClient();
  if (!redis) return {};
  return {
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        redis.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
    }),
  };
}

// General rate limiting middleware (exclude file uploads). The previous
// ceiling of 150/15min was below what a single signed-in user generates
// against the API in normal usage (feed scrolling, profile loads, sockets'
// REST fallback, FedCM exchanges), which surfaced as misleading 429s on
// unrelated endpoints. The userRateLimiter below still caps per-account
// traffic.
const rateLimiter = rateLimit({
  ...makeStore(),
  windowMs: 15 * 60 * 1000,
  max: isProd ? 1000 : 2000,
  message: "Too many requests from this IP, please try again later.",
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
  ...makeStore(),
  windowMs: 15 * 60 * 1000,
  max: isProd ? 300 : 2000,
  message: "Too many authentication attempts from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.path.startsWith('/files/upload'),
});

// Per-user rate limiting for authenticated requests
const userRateLimiter = rateLimit({
  ...makeStore(),
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

// Brute force protection middleware (exclude file uploads)
const bruteForceProtection = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: isProd ? 100 : 1000,
  delayMs: () => isProd ? 500 : 100,
  skip: (req: Request) => req.path.startsWith('/files/upload'),
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

export { rateLimiter, authRateLimiter, userRateLimiter, bruteForceProtection, securityHeaders };
