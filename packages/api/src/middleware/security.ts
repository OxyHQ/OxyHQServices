import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import { Request, Response, NextFunction } from "express";
import helmet from "helmet";

// General rate limiting middleware (exclude file uploads)
// Set to 150 requests per 15 minutes per IP for general API usage
// Much higher limit in development to avoid blocking during active development
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 2000 : 150, // limit each IP to 150 requests per window (2000 in dev)
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req: Request) => {
    // Skip file uploads
    return req.path.startsWith('/files/upload');
  }
});

// Stricter rate limiting for authentication endpoints
// Critical for preventing brute force attacks
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 500 : 50, // limit each IP to 50 requests per window for auth endpoints (500 in dev)
  message: "Too many authentication attempts from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.path.startsWith('/files/upload')
});

// Per-user rate limiting for authenticated requests
// Uses user ID from request if available, falls back to IP
// Much higher limit in development to avoid blocking during active development
const userRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 2000 : 200, // limit each user to 200 requests per window (2000 in dev)
  message: "Too many requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use user ID if authenticated, otherwise fall back to IP
    return (req as any).user?.id || req.ip || 'unknown';
  },
  skip: (req: Request) => {
    // Skip for file uploads and unauthenticated requests
    return req.path.startsWith('/files/upload') || !(req as any).user;
  }
});

// Brute force protection middleware (exclude file uploads)
// More lenient in development to avoid slowing down development workflow
const bruteForceProtection = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: process.env.NODE_ENV === 'development' ? 1000 : 100, // allow 100 requests per 15 minutes (1000 in dev), then...
  delayMs: () => process.env.NODE_ENV === 'development' ? 100 : 500, // add 500ms delay per request above limit (100ms in dev)
  skip: (req: Request) => {
    // Skip file uploads
    return req.path.startsWith('/files/upload');
  }
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
