import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import { Request, Response, NextFunction } from "express";

// General rate limiting middleware (exclude file uploads)
// Set to 150 requests per 15 minutes per IP for general API usage
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // limit each IP to 150 requests per window
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req: Request) => req.path.startsWith('/files/upload')
});

// Stricter rate limiting for authentication endpoints
// Critical for preventing brute force attacks
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per window for auth endpoints
  message: "Too many authentication attempts from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.path.startsWith('/files/upload')
});

// Per-user rate limiting for authenticated requests
// Uses user ID from request if available, falls back to IP
const userRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each user to 200 requests per window
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
const bruteForceProtection = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // allow 100 requests per 15 minutes, then...
  delayMs: () => 500, // add 500ms delay per request above 100
  skip: (req: Request) => req.path.startsWith('/files/upload')
});

export { rateLimiter, authRateLimiter, userRateLimiter, bruteForceProtection };
