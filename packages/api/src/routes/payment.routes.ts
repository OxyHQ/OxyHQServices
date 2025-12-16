import express from 'express';
import { processPayment, validatePaymentMethod, getPaymentMethods, getUserPayments } from '../controllers/payment.controller';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = express.Router();

router.use(authMiddleware);

router.post('/process', processPayment);
router.post('/validate', validatePaymentMethod);
router.get('/methods/:userId', getPaymentMethods);
router.get('/user', asyncHandler(getUserPayments));

export default router;