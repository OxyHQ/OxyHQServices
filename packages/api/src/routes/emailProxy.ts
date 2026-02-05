/**
 * Email Proxy Routes
 *
 * Proxy endpoint for external email images and fonts.
 * Provides CORS bypass and tracking protection.
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { proxyResource } from '../controllers/emailProxy.controller';

const router = Router();

// Rate limit: 100 requests per minute per user
const proxyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => (req as any).user?.id || req.ip || 'unknown',
  message: 'Too many proxy requests, please try again later.',
});

// All proxy routes require authentication
router.use(authMiddleware);
router.use(proxyRateLimit);

// GET /email/proxy?url=<encoded-url>
// Proxies external images and fonts for email content
router.get('/', asyncHandler(proxyResource));

export default router;
