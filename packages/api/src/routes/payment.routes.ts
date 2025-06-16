import express from 'express';
import { processPayment, validatePaymentMethod, getPaymentMethods } from '../controllers/payment.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

router.use(authMiddleware);

router.post('/process', processPayment);
router.post('/validate', validatePaymentMethod);
router.get('/methods/:userId', getPaymentMethods);

export default router;