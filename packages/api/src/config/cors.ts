/**
 * CORS (Cross-Origin Resource Sharing) Configuration
 *
 * Reflects the request origin in Access-Control-Allow-Origin.
 * The Oxy ecosystem has many apps — maintaining a whitelist creates
 * friction for new apps. Authentication and authorization are handled
 * by session/token validation, not by CORS origin checks.
 */

import { Request, Response, NextFunction } from 'express';

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
  'X-CSRF-Token',
] as const;

/**
 * Cache control for OPTIONS preflight requests (24 hours)
 */
export const PREFLIGHT_MAX_AGE = 86400;

/**
 * CORS middleware factory
 * Reflects the request origin with credentials support.
 */
export function createCorsMiddleware() {
  const allowedMethodsStr = ALLOWED_METHODS.join(', ');
  const allowedHeadersStr = ALLOWED_HEADERS.join(', ');
  const exposedHeadersStr = EXPOSED_HEADERS.join(', ');

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', allowedMethodsStr);
    res.setHeader('Access-Control-Allow-Headers', allowedHeadersStr);
    res.setHeader('Access-Control-Expose-Headers', exposedHeadersStr);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      res.setHeader('Cache-Control', `public, max-age=${PREFLIGHT_MAX_AGE}`);
      res.status(204).end();
      return;
    }

    next();
  };
}

/**
 * Socket.IO CORS configuration — allows all origins with credentials
 */
export const SOCKET_IO_CORS_CONFIG = {
  origin: true,
  methods: ['GET', 'POST'] as const,
  credentials: true,
} as const;
