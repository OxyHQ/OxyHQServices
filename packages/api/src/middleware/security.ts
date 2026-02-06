import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient } from "../config/redis";

const isProd = process.env.NODE_ENV !== 'development';

// Build Redis-backed store options if available, otherwise fall back to in-memory
function makeStore() {
  const redis = getRedisClient();
  if (!redis) return {};
  return {
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        redis.call(args[0], ...args.slice(1)) as any,
    }),
  };
}

// General rate limiting middleware (exclude file uploads)
const rateLimiter = rateLimit({
  ...makeStore(),
  windowMs: 15 * 60 * 1000,
  max: isProd ? 150 : 2000,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.path.startsWith('/files/upload'),
});

// Stricter rate limiting for authentication endpoints
const authRateLimiter = rateLimit({
  ...makeStore(),
  windowMs: 15 * 60 * 1000,
  max: isProd ? 50 : 500,
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
    return (req as any).user?.id || req.ip || 'unknown';
  },
  skip: (req: Request) => {
    return req.path.startsWith('/files/upload') || !(req as any).user;
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

  // X-Content-Type-Options: Prevent MIME type sniffing (enabled by default)
  // X-DNS-Prefetch-Control: Control browser DNS prefetching
  // X-Download-Options: Prevent IE from executing downloads in site context
  // X-Permitted-Cross-Domain-Policies: Restrict Adobe Flash and PDF
});

export { rateLimiter, authRateLimiter, userRateLimiter, bruteForceProtection, securityHeaders };
