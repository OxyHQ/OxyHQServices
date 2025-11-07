import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to add appropriate headers for media file streaming
 * Prevents ERR_BLOCKED_BY_ORB (Opaque Response Blocking) errors in browsers
 * 
 * This middleware should be applied to routes that serve media files
 * (images, videos, audio) directly to the browser.
 */
export const mediaHeadersMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Cross-Origin-Resource-Policy allows cross-origin requests to access this resource
  // This is crucial for preventing ORB blocking in modern browsers
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  
  // CORS headers for cross-origin access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
  
  // Expose headers that the client needs to access
  res.setHeader(
    'Access-Control-Expose-Headers', 
    'Content-Type, Content-Length, Content-Range, Accept-Ranges, Content-Disposition'
  );
  
  // Support range requests for video/audio streaming
  res.setHeader('Accept-Ranges', 'bytes');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(204).end();
  }
  
  next();
};

/**
 * Add cache headers for immutable media files
 * Use this for content-addressed files that never change
 */
export const immutableCacheMiddleware = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
};

/**
 * Add cache headers for user-specific media files
 * Use this for files that might change or are user-specific
 */
export const privateCacheMiddleware = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'private, max-age=3600');
  next();
};
