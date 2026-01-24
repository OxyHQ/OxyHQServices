/**
 * ⚠️ WARNING: STUB IMPLEMENTATION - NOT PRODUCTION READY ⚠️
 *
 * This payment controller contains MOCK implementations only.
 * DO NOT use in production without integrating a real payment processor.
 *
 * Current limitations:
 * - processPayment: Uses Math.random() for success/failure (90% success rate)
 * - validatePaymentMethod: Random validation for non-card types
 * - getPaymentMethods: Always returns empty array
 * - No PCI-DSS compliance
 * - No actual payment processor integration (Stripe, PayPal, etc.)
 *
 * Required for production:
 * 1. Integrate with payment processor (Stripe recommended)
 * 2. Implement proper PCI-DSS compliant card handling
 * 3. Add webhook handling for payment status updates
 * 4. Implement proper error handling and retry logic
 * 5. Add payment method storage and retrieval
 * 6. Implement refunds and dispute handling
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import Transaction from '../models/Transaction';
import { logger } from '../utils/logger';
import { sendSuccess } from '../utils/asyncHandler';
import { UnauthorizedError, InternalServerError } from '../utils/error';

// Log warning on module load
logger.warn('⚠️ Payment controller loaded with STUB implementation - NOT production ready!');

// Validation schemas
const paymentMethodSchema = z.object({
  type: z.enum(['card', 'applePay', 'googlePay']),
  cardNumber: z.string().optional(),
  expiryMonth: z.string().optional(),
  expiryYear: z.string().optional(),
  cvc: z.string().optional(),
  token: z.string().optional(),
});

const processPaymentSchema = z.object({
  userId: z.string(),
  plan: z.string(),
  paymentMethod: paymentMethodSchema,
  platform: z.string(),
});

/**
 * ⚠️ STUB IMPLEMENTATION - DO NOT USE IN PRODUCTION ⚠️
 *
 * This function uses Math.random() to simulate payment success/failure.
 * Replace with actual payment processor integration before production use.
 */
export const processPayment = async (req: Request, res: Response) => {
  logger.warn('⚠️ STUB: processPayment called - using mock implementation');

  try {
    const paymentData = processPaymentSchema.parse(req.body);

    // STUB IMPLEMENTATION: Uses Math.random() for testing only
    // TODO: Integrate with actual payment processor (Stripe, etc.)
    const success = Math.random() > 0.1; // 90% success rate for testing

    if (success) {
      res.json({
        success: true,
        transactionId: `trans_${Date.now()}`,
        warning: 'STUB_IMPLEMENTATION',
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Payment processing failed',
        warning: 'STUB_IMPLEMENTATION',
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Invalid payment data', errors: error.errors });
    } else {
      res.status(500).json({ message: 'Payment processing failed', error });
    }
  }
};

/**
 * ⚠️ STUB IMPLEMENTATION - DO NOT USE IN PRODUCTION ⚠️
 *
 * Non-card payment methods use Math.random() for validation.
 * Card validation uses basic Luhn algorithm without processor verification.
 */
export const validatePaymentMethod = async (req: Request, res: Response) => {
  logger.warn('⚠️ STUB: validatePaymentMethod called - using mock implementation');

  try {
    const { paymentMethod } = req.body;
    const validatedPaymentMethod = paymentMethodSchema.parse(paymentMethod);

    // STUB IMPLEMENTATION: Random validation for non-card types
    // TODO: Integrate with payment processor for actual validation
    const isValid = validatedPaymentMethod.type === 'card' ?
      isValidCard(validatedPaymentMethod) :
      Math.random() > 0.1;

    res.json({
      valid: isValid,
      warning: 'STUB_IMPLEMENTATION',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Invalid payment method data', errors: error.errors });
    } else {
      res.status(500).json({ message: 'Validation failed', error });
    }
  }
};

/**
 * ⚠️ STUB IMPLEMENTATION - DO NOT USE IN PRODUCTION ⚠️
 *
 * Always returns empty array. No payment method storage implemented.
 */
export const getPaymentMethods = async (req: Request, res: Response) => {
  logger.warn('⚠️ STUB: getPaymentMethods called - always returns empty array');

  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // STUB IMPLEMENTATION: Always returns empty
    // TODO: Integrate with payment processor to get saved payment methods
    res.json({
      methods: [],
      warning: 'STUB_IMPLEMENTATION',
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch payment methods', error });
  }
};

/**
 * Get all payments for the authenticated user
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const getUserPayments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Validate user authentication
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const userId = req.user._id.toString();

    // Fetch payment-related transactions (deposit and purchase types)
    const transactions = await Transaction.find({
      userId,
      type: { $in: ['deposit', 'purchase'] },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Format transactions for response
    const payments = transactions.map((transaction) => ({
      id: transaction._id.toString(),
      userId: transaction.userId.toString(),
      type: transaction.type,
      amount: transaction.amount,
      status: transaction.status,
      description: transaction.description,
      itemId: transaction.itemId,
      itemType: transaction.itemType,
      timestamp: transaction.createdAt,
      completedAt: transaction.completedAt,
    }));

    sendSuccess(res, payments);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    logger.error('Error fetching user payments', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Server error when fetching user payments');
  }
};

// Helper function for basic card validation
function isValidCard(paymentMethod: z.infer<typeof paymentMethodSchema>) {
  if (!paymentMethod.cardNumber || !paymentMethod.expiryMonth || !paymentMethod.expiryYear || !paymentMethod.cvc) {
    return false;
  }

  // Basic Luhn algorithm check for card number
  const number = paymentMethod.cardNumber.replace(/\D/g, '');
  let sum = 0;
  let isEven = false;

  for (let i = number.length - 1; i >= 0; i--) {
    let digit = parseInt(number[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  // Check expiry date
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear() % 100;
  const currentMonth = currentDate.getMonth() + 1;
  const expYear = parseInt(paymentMethod.expiryYear, 10);
  const expMonth = parseInt(paymentMethod.expiryMonth, 10);

  if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
    return false;
  }

  // Check CVC
  const cvc = paymentMethod.cvc.replace(/\D/g, '');
  if (cvc.length < 3 || cvc.length > 4) {
    return false;
  }

  return sum % 10 === 0;
}