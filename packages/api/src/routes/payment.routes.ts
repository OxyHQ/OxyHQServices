import express, { Request, Response, NextFunction } from 'express';
import { processPayment, validatePaymentMethod, getPaymentMethods, getUserPayments } from '../controllers/payment.controller';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { validate } from '../middleware/validate';
import { processPaymentSchema, validatePaymentMethodSchema, paymentMethodsUserIdParams } from '../schemas/payment.schemas';

const router = express.Router();

router.use(authMiddleware);

/**
 * Guard for stub payment endpoints. Returns 503 unless ENABLE_STUB_PAYMENTS=true.
 * getUserPayments (transaction history) is a real endpoint and is not gated.
 */
function stubGuard(_req: Request, res: Response, next: NextFunction): void {
  if (process.env.ENABLE_STUB_PAYMENTS === 'true') {
    next();
    return;
  }
  res.status(503).json({
    error: 'SERVICE_UNAVAILABLE',
    message: 'Payment processing is not yet available',
  });
}

router.post('/process', stubGuard, validate({ body: processPaymentSchema }), processPayment);
router.post('/validate', stubGuard, validate({ body: validatePaymentMethodSchema }), validatePaymentMethod);
router.get('/methods/:userId', stubGuard, validate({ params: paymentMethodsUserIdParams }), getPaymentMethods);
router.get('/user', asyncHandler(getUserPayments));

export default router;
