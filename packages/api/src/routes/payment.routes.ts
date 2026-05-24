import express from 'express';
import { getUserPayments } from '../controllers/payment.controller';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = express.Router();

router.use(authMiddleware);

// Transaction history for the authenticated user.
// All other payment flows live under /billing (Stripe-backed).
router.get('/user', asyncHandler(getUserPayments));

export default router;
