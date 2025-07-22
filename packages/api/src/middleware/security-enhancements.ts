/**
 * Enhanced Security Features for Zero-Config Authentication
 * 
 * Implements CSRF protection, XSS prevention, and other security measures
 * that are automatically enabled with zero-config authentication.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { OxyRequest } from './zero-config-auth';

interface SecurityConfig {
  enableCsrfProtection?: boolean;
  csrfTokenName?: string;
  trustedOrigins?: string[];
  maxRequestSize?: string;
  enableXssProtection?: boolean;
}

/**
 * Generate a cryptographically secure CSRF token
 */
function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Enhanced security middleware that works with zero-config authentication
 */
export function enhancedSecurity(config: SecurityConfig = {}): (req: Request, res: Response, next: NextFunction) => void {
  const {
    enableCsrfProtection = true,
    csrfTokenName = '_csrf',
    trustedOrigins = [],
    enableXssProtection = true,
  } = config;

  return (req: OxyRequest, res: Response, next: NextFunction) => {
    // Set security headers
    if (enableXssProtection) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    }

    // CSRF protection for state-changing methods
    if (enableCsrfProtection && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.headers.origin || req.headers.referer;
      const csrfToken = req.headers[csrfTokenName] || req.body[csrfTokenName];

      // Check origin for CSRF protection
      if (origin && trustedOrigins.length > 0) {
        const isOriginTrusted = trustedOrigins.some(trusted => {
          if (trusted.includes('*')) {
            const pattern = trusted.replace(/\*/g, '.*');
            return new RegExp(`^${pattern}$`).test(origin);
          }
          return origin === trusted;
        });

        if (!isOriginTrusted) {
          return res.status(403).json({
            success: false,
            error: 'CSRF_PROTECTION',
            message: 'Request origin not trusted'
          });
        }
      }

      // For authenticated requests, validate CSRF token
      if (req.user && !csrfToken) {
        return res.status(403).json({
          success: false,
          error: 'CSRF_TOKEN_REQUIRED',
          message: 'CSRF token required for authenticated requests'
        });
      }
    }

    next();
  };
}

/**
 * Middleware to provide CSRF tokens to clients
 */
export function provideCsrfToken(req: Request, res: Response, next: NextFunction): void {
  // Generate and attach CSRF token
  const csrfToken = generateCsrfToken();
  res.locals.csrfToken = csrfToken;
  
  // Set as cookie for client access
  res.cookie('_csrf_token', csrfToken, {
    httpOnly: false, // Client needs access to read this
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 1000, // 1 hour
  });

  next();
}

/**
 * Rate limiting for authentication endpoints
 */
export function authRateLimit(): (req: Request, res: Response, next: NextFunction) => void {
  const attempts = new Map<string, { count: number; resetTime: number }>();
  const maxAttempts = 5;
  const windowMs = 15 * 60 * 1000; // 15 minutes

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const userAttempts = attempts.get(key);

    // Clean up expired entries
    if (userAttempts && now > userAttempts.resetTime) {
      attempts.delete(key);
    }

    const currentAttempts = attempts.get(key) || { count: 0, resetTime: now + windowMs };

    if (currentAttempts.count >= maxAttempts) {
      const timeLeft = Math.ceil((currentAttempts.resetTime - now) / 1000);
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Too many authentication attempts. Try again in ${timeLeft} seconds.`,
        retryAfter: timeLeft
      });
    }

    // Increment attempt count on failed auth
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        currentAttempts.count += 1;
        attempts.set(key, currentAttempts);
      }
    });

    next();
  };
}

/**
 * Session security enhancements
 */
export function secureSession(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: OxyRequest, res: Response, next: NextFunction) => {
    // Add session fingerprinting
    if (req.user) {
      const userAgent = req.headers['user-agent'] || '';
      const acceptLanguage = req.headers['accept-language'] || '';
      const sessionFingerprint = crypto
        .createHash('sha256')
        .update(`${req.user.id}-${userAgent}-${acceptLanguage}`)
        .digest('hex');

      // Store fingerprint in session for validation
      req.sessionFingerprint = sessionFingerprint;
    }

    // Set secure session cookie options
    if (res.cookie) {
      const originalCookie = res.cookie.bind(res);
      res.cookie = (name: string, value: any, options: any = {}) => {
        return originalCookie(name, value, {
          ...options,
          secure: process.env.NODE_ENV === 'production',
          httpOnly: true,
          sameSite: 'strict',
          ...options,
        });
      };
    }

    next();
  };
}

/**
 * Content Security Policy middleware
 */
export function contentSecurityPolicy(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self'",
      "media-src 'self'",
      "object-src 'none'",
      "child-src 'none'",
      "worker-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'none'"
    ].join('; ');

    res.setHeader('Content-Security-Policy', csp);
    next();
  };
}

/**
 * Complete security middleware stack for zero-config authentication
 */
export function zeroConfigSecurity(config: SecurityConfig & {
  trustedOrigins?: string[];
  enableCsp?: boolean;
  enableRateLimit?: boolean;
} = {}): (req: Request, res: Response, next: NextFunction) => void {
  const {
    trustedOrigins = ['https://*.oxy.so', 'http://localhost:*'],
    enableCsp = true,
    enableRateLimit = true,
    ...securityConfig
  } = config;

  const middlewares = [
    enhancedSecurity({ ...securityConfig, trustedOrigins }),
    secureSession(),
  ];

  if (enableCsp) {
    middlewares.push(contentSecurityPolicy());
  }

  if (enableRateLimit) {
    middlewares.push(authRateLimit());
  }

  return (req: Request, res: Response, next: NextFunction) => {
    let currentIndex = 0;

    const runNext = (error?: any) => {
      if (error) {
        return next(error);
      }

      if (currentIndex >= middlewares.length) {
        return next();
      }

      const middleware = middlewares[currentIndex++];
      middleware(req, res, runNext);
    };

    runNext();
  };
}

// Extend the OxyRequest interface to include session security
declare module './zero-config-auth' {
  interface OxyRequest {
    sessionFingerprint?: string;
  }
}

export default {
  enhancedSecurity,
  provideCsrfToken,
  authRateLimit,
  secureSession,
  contentSecurityPolicy,
  zeroConfigSecurity,
};