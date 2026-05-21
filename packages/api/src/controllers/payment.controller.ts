/**
 * Payment controller.
 *
 * Real payment processing lives in `routes/billing.ts` (Stripe-backed checkout, subscriptions,
 * and webhook handling). The legacy `processPayment` / `validatePaymentMethod` /
 * `getPaymentMethods` endpoints were never integrated with a real payment processor and
 * now return 501 Not Implemented.
 *
 * `getUserPayments` remains a real read-only endpoint that returns the authenticated user's
 * payment transaction history.
 */

import type { Request, Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import Transaction from '../models/Transaction';
import { logger } from '../utils/logger';
import { sendSuccess } from '../utils/asyncHandler';
import { UnauthorizedError, InternalServerError } from '../utils/error';

const NOT_IMPLEMENTED_RESPONSE = {
  error: 'NOT_IMPLEMENTED',
  message: 'Use /billing endpoints (Stripe-backed) instead.',
} as const;

/**
 * Removed stub. Real checkout flow is `POST /billing/checkout/credits` or
 * `POST /billing/checkout/subscription`.
 */
export const processPayment = async (_req: Request, res: Response): Promise<void> => {
  res.status(501).json(NOT_IMPLEMENTED_RESPONSE);
};

/**
 * Removed stub. Stripe Elements / Stripe Checkout handles payment-method validation
 * server-side via webhooks. Clients should not call this endpoint.
 */
export const validatePaymentMethod = async (_req: Request, res: Response): Promise<void> => {
  res.status(501).json(NOT_IMPLEMENTED_RESPONSE);
};

/**
 * Removed stub. Stripe-backed payment methods are managed via the Stripe Customer Portal
 * (`POST /billing/portal`). Clients should not call this endpoint.
 */
export const getPaymentMethods = async (_req: Request, res: Response): Promise<void> => {
  res.status(501).json(NOT_IMPLEMENTED_RESPONSE);
};

/**
 * Get all payments for the authenticated user.
 * Reads `Transaction` records of type `deposit` or `purchase`.
 */
export const getUserPayments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const userId = req.user._id.toString();

    const transactions = await Transaction.find({
      userId,
      type: { $in: ['deposit', 'purchase'] },
    })
      .sort({ createdAt: -1 })
      .lean();

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
