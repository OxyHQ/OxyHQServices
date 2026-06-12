/**
 * CORS (Cross-Origin Resource Sharing) Configuration
 *
 * Strict Origin allowlist (MED-1 CSRF hardening, Phase A). Only first-party
 * Oxy ecosystem origins (and their https subdomains) receive
 * `Access-Control-Allow-Origin` — and ALWAYS with the specific origin echoed
 * back, NEVER `*`, because responses carry `Access-Control-Allow-Credentials:
 * true`. Non-allowlisted origins get no ACAO header at all, so the browser
 * fails the preflight/response check and never delivers a credentialed
 * cross-origin response.
 *
 * The allowlist itself lives in `./allowedOrigins` and is shared with the
 * Origin guard middleware (single source of truth).
 */

import { Request, Response, NextFunction } from 'express';
import { isAllowedOrigin } from './allowedOrigins';

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
  'X-Native-App',
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
 * CORS middleware factory.
 *
 * Echoes the request origin in `Access-Control-Allow-Origin` ONLY when it
 * passes the strict allowlist. Disallowed origins receive no ACAO header
 * (the preflight fails; the browser will not send the credentialed request).
 * `Vary: Origin` is always set so caches never serve one origin's headers
 * to another.
 */
export function createCorsMiddleware() {
  const allowedMethodsStr = ALLOWED_METHODS.join(', ');
  const allowedHeadersStr = ALLOWED_HEADERS.join(', ');
  const exposedHeadersStr = EXPOSED_HEADERS.join(', ');

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    res.setHeader('Access-Control-Allow-Methods', allowedMethodsStr);
    res.setHeader('Access-Control-Allow-Headers', allowedHeadersStr);
    res.setHeader('Access-Control-Expose-Headers', exposedHeadersStr);
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
 * Socket.IO CORS configuration — same strict allowlist as the HTTP layer.
 */
export const SOCKET_IO_CORS_CONFIG = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ): void => {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  methods: ['GET', 'POST'],
  credentials: true,
};
