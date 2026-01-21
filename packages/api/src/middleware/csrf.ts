import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * CSRF Protection Middleware
 * Implements double-submit cookie pattern
 *
 * How it works:
 * 1. Server generates a random CSRF token and sends it in a cookie
 * 2. Client must include this token in a custom header (X-CSRF-Token) for state-changing requests
 * 3. Server verifies that cookie value matches header value
 *
 * This is stateless and doesn't require server-side session storage
 */

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const TOKEN_LENGTH = 32;

// Methods that don't require CSRF protection (safe methods per RFC 7231)
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Generate a cryptographically secure CSRF token
 */
function generateToken(): string {
  return crypto.randomBytes(TOKEN_LENGTH).toString('base64url');
}

/**
 * Middleware to set CSRF token cookie
 * Call this on routes where you want to issue a CSRF token
 */
export function setCsrfToken(req: Request, res: Response, next: NextFunction) {
  // Check if CSRF cookie already exists
  let csrfToken = req.cookies?.[CSRF_COOKIE_NAME];

  // Generate new token if none exists
  if (!csrfToken) {
    csrfToken = generateToken();

    res.cookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  // Make token available to client via response header (for client to read and include in requests)
  res.setHeader('X-CSRF-Token', csrfToken);

  next();
}

/**
 * Middleware to verify CSRF token
 * Use this on state-changing routes (POST, PUT, DELETE, PATCH)
 */
export function verifyCsrfToken(req: Request, res: Response, next: NextFunction) {
  // Skip verification for safe methods
  if (SAFE_METHODS.includes(req.method)) {
    return next();
  }

  // Get token from cookie
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];

  // Get token from header
  const headerToken = req.headers[CSRF_HEADER_NAME] as string;

  // Both must be present
  if (!cookieToken || !headerToken) {
    logger.warn('CSRF token missing', {
      method: req.method,
      path: req.path,
      hasCookie: !!cookieToken,
      hasHeader: !!headerToken,
      ip: req.ip,
    });

    return res.status(403).json({
      message: 'CSRF token missing',
      code: 'CSRF_TOKEN_MISSING',
    });
  }

  // Tokens must match (timing-safe comparison)
  if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    logger.warn('CSRF token mismatch', {
      method: req.method,
      path: req.path,
      ip: req.ip,
    });

    return res.status(403).json({
      message: 'Invalid CSRF token',
      code: 'CSRF_TOKEN_INVALID',
    });
  }

  // Token is valid, proceed
  next();
}

/**
 * Combined middleware that sets and verifies CSRF token
 * Use this as a general-purpose CSRF protection middleware
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // First set the token (if not exists)
  setCsrfToken(req, res, () => {
    // Then verify it for non-safe methods
    verifyCsrfToken(req, res, next);
  });
}

/**
 * Endpoint to get CSRF token
 * Useful for single-page applications that need to fetch the token
 */
export function getCsrfToken(req: Request, res: Response) {
  let csrfToken = req.cookies?.[CSRF_COOKIE_NAME];

  if (!csrfToken) {
    csrfToken = generateToken();

    res.cookie(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });
  }

  res.json({
    csrfToken,
  });
}
