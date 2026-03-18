import { z } from 'zod';

// POST /billing/checkout/credits
export const checkoutCreditsSchema = z.object({
  packageId: z.string().trim().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

// POST /billing/checkout/subscription
export const checkoutSubscriptionSchema = z.object({
  planId: z.string().trim().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

// POST /billing/portal
export const portalSchema = z.object({
  returnUrl: z.string().url(),
});

// GET /billing/transactions
export const transactionsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});
