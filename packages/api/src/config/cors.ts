/**
 * CORS (Cross-Origin Resource Sharing) Configuration
 * 
 * Centralizes CORS settings for consistent security policies across the API.
 * Follows the principle of secure defaults with explicit allow-lists.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Allowed origins for CORS requests
 * Production origins are explicitly allow-listed for security
 */
export const ALLOWED_ORIGINS = [
  'https://mention.earth',
  'https://homiio.com',
  'https://api.oxy.so',
  'https://authenticator.oxy.so',
  'https://noted.oxy.so',
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:19006',
] as const;

/**
 * Allowed origin patterns (regex) for subdomain matching
 */
export const ALLOWED_ORIGIN_PATTERNS = [
  /\.homiio\.com$/,
  /\.mention\.earth$/,
  /\.oxy\.so$/,
] as const;

/**
 * Standard HTTP methods allowed for CORS
 */
export const ALLOWED_METHODS = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
] as const;

/**
 * Headers that clients are allowed to send
 */
export const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-CSRF-Token',
  'X-Requested-With',
  'Accept',
  'Accept-Version',
  'Content-Length',
  'Content-MD5',
  'Date',
  'X-Api-Version',
  'X-File-Name',
  'Range',
  'X-Session-Id',
  'x-session-id',
  'X-Device-Fingerprint',
  'x-device-fingerprint',
] as const;

/**
 * Headers that browsers are allowed to access from responses
 */
export const EXPOSED_HEADERS = [
  'Content-Type',
  'Content-Length',
  'Content-Range',
  'Content-Disposition',
  'Accept-Ranges',
  'Last-Modified',
  'ETag',
  'Cache-Control',
] as const;

/**
 * Cache control for OPTIONS preflight requests (24 hours)
 */
export const PREFLIGHT_MAX_AGE = 86400;

/**
 * Check if an origin is allowed based on allow-list and patterns
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }

  // Check exact matches
  if (ALLOWED_ORIGINS.includes(origin as any)) {
    return true;
  }

  // Check pattern matches
  return ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(origin));
}

/**
 * CORS middleware factory
 * Creates a middleware that applies CORS headers based on configuration
 * 
 * @param options - Optional configuration overrides
 * @returns Express middleware function
 */
export interface CorsOptions {
  allowAllOriginsInDev?: boolean;
  credentials?: boolean;
}

export function createCorsMiddleware(options: CorsOptions = {}) {
  const {
    allowAllOriginsInDev = true,
    credentials = true,
  } = options;

  const allowedMethodsStr = ALLOWED_METHODS.join(', ');
  const allowedHeadersStr = ALLOWED_HEADERS.join(', ');
  const exposedHeadersStr = EXPOSED_HEADERS.join(', ');

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    const isDevelopment = process.env.NODE_ENV !== 'production';

    // Set Access-Control-Allow-Origin
    if (isDevelopment && allowAllOriginsInDev) {
      // In development, allow all origins for easier testing
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    } else if (origin && isOriginAllowed(origin)) {
      // In production, only allow explicitly allowed origins
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    // Set other CORS headers
    res.setHeader('Access-Control-Allow-Methods', allowedMethodsStr);
    res.setHeader('Access-Control-Allow-Headers', allowedHeadersStr);
    res.setHeader('Access-Control-Expose-Headers', exposedHeadersStr);

    if (credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.setHeader('Cache-Control', `public, max-age=${PREFLIGHT_MAX_AGE}`);
      res.setHeader('Vary', 'Origin');
      res.status(204).end();
      return;
    }

    next();
  };
}

/**
 * Socket.IO CORS configuration
 */
export const SOCKET_IO_CORS_CONFIG = {
  origin: [
    ...ALLOWED_ORIGINS,
    ...ALLOWED_ORIGIN_PATTERNS,
  ] as const,
  methods: ['GET', 'POST'] as const,
  credentials: true,
} as const;
