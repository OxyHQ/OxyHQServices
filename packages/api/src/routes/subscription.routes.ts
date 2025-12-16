import express, { Request, Response } from 'express';
import { getSubscription, updateSubscription, cancelSubscription } from '../controllers/subscription.controller';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = express.Router();

// All subscription routes require authentication
router.use(authMiddleware);

/**
 * GET /api/subscription/:userId
 * Get user subscription
 */
router.get('/:userId', asyncHandler(async (req: Request, res: Response) => {
  await getSubscription(req, res);
}));

/**
 * PUT /api/subscription/:userId
 * Update user subscription
 */
router.put('/:userId', asyncHandler(async (req: Request, res: Response) => {
  await updateSubscription(req, res);
}));

/**
 * DELETE /api/subscription/:userId
 * Cancel user subscription
 */
router.delete('/:userId', asyncHandler(async (req: Request, res: Response) => {
  await cancelSubscription(req, res);
}));

export default router;

