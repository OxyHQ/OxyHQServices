/**
 * Media Headers Middleware
 * 
 * Provides middleware functions for serving media files (images, videos, audio)
 * with proper CORS and security headers to prevent browser blocking.
 * 
 * Key features:
 * - Prevents ERR_BLOCKED_BY_ORB (Opaque Response Blocking) errors
 * - Enables cross-origin media loading
 * - Supports HTTP range requests for video/audio streaming
 * - Optimized for performance with pre-built header strings
 * 
 * @see https://developer.chrome.com/blog/opaque-response-blocking/
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Headers for media file streaming
 * Pre-built strings for performance optimization
 *
 * Note: General CORS headers (Allow-Origin, Allow-Methods, Allow-Headers,
 * Allow-Credentials) are handled by the global CORS middleware in config/cors.ts.
 * This middleware only adds media-specific headers.
 */
const MEDIA_EXPOSE_HEADERS = 'Content-Type, Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Last-Modified, ETag';
const MEDIA_ACCEPT_RANGES = 'bytes';

/**
 * Cache durations (in seconds)
 */
export const CACHE_DURATION = {
  /** For content-addressed immutable files (1 year) */
  IMMUTABLE: 31536000,
  /** For user-specific or frequently updated files (1 hour) */
  PRIVATE: 3600,
  /** For OPTIONS preflight requests (24 hours) */
  PREFLIGHT: 86400,
  /** For development/testing (no cache) */
  NO_CACHE: 0,
} as const;

/**
 * Middleware to add appropriate headers for media file streaming.
 * Prevents ERR_BLOCKED_BY_ORB (Opaque Response Blocking) errors in browsers.
 * 
 * This middleware should be applied to routes that serve media files
 * (images, videos, audio) directly to the browser.
 * 
 * @example
 * ```typescript
 * router.get('/media/:id', mediaHeadersMiddleware, async (req, res) => {
 *   // Stream media file
 * });
 * ```
 */
export function mediaHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Cross-Origin-Resource-Policy: defense-in-depth (also set globally via Helmet)
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  // Expose media-specific headers the client needs (Content-Range, Accept-Ranges, etc.)
  // General CORS headers are handled by the global CORS middleware.
  res.setHeader('Access-Control-Expose-Headers', MEDIA_EXPOSE_HEADERS);
  
  // Support range requests for video/audio streaming
  res.setHeader('Accept-Ranges', MEDIA_ACCEPT_RANGES);
  
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Cache-Control', `public, max-age=${CACHE_DURATION.PREFLIGHT}`);
    res.setHeader('Vary', 'Origin');
    res.status(204).end();
    return;
  }
  
  next();
}

/**
 * Add cache headers for immutable media files.
 * Use this for content-addressed files that never change.
 * 
 * @example
 * ```typescript
 * router.get('/assets/:hash', immutableCacheMiddleware, handler);
 * ```
 */
export function immutableCacheMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('Cache-Control', `public, max-age=${CACHE_DURATION.IMMUTABLE}, immutable`);
  next();
}

/**
 * Add cache headers for user-specific media files.
 * Use this for files that might change or are user-specific.
 * 
 * @example
 * ```typescript
 * router.get('/user/:id/avatar', privateCacheMiddleware, handler);
 * ```
 */
export function privateCacheMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('Cache-Control', `private, max-age=${CACHE_DURATION.PRIVATE}`);
  next();
}

/**
 * Disable caching entirely.
 * Use this for sensitive or frequently changing content.
 * 
 * @example
 * ```typescript
 * router.get('/sensitive', noCacheMiddleware, handler);
 * ```
 */
export function noCacheMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

