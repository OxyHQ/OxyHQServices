/**
 * Email Proxy Routes
 *
 * Proxy endpoint for external email images and fonts.
 * Provides CORS bypass and tracking protection.
 *
 * Note: This endpoint is public (no auth) because it's called from sandboxed
 * iframes that cannot send credentials. Security is provided by:
 * - Rate limiting by IP
 * - Only proxying image/font content types
 * - SSRF protection
 * - The proxied content is already publicly accessible
 */

import { Router, RequestHandler } from 'express';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { proxyResource } from '../controllers/emailProxy.controller';

const router = Router();

// Rate limit: 100 requests per minute per IP
const proxyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => (req as { ip?: string }).ip || 'unknown',
  message: 'Too many proxy requests, please try again later.',
});

// Add CORS headers to allow iframe access
const corsMiddleware: RequestHandler = (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};

router.use(corsMiddleware);
router.use(proxyRateLimit);

// GET /email/proxy?url=<encoded-url>
// Proxies external images and fonts for email content
router.get('/', asyncHandler(proxyResource));

export default router;
