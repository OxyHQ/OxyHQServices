import { z } from 'zod';

// POST /payment/process
export const processPaymentSchema = z.object({
  userId: z.string().trim().min(1),
  plan: z.string().trim().min(1),
  paymentMethod: z.object({
    type: z.enum(['card', 'applePay', 'googlePay']),
    cardNumber: z.string().optional(),
    expiryMonth: z.string().optional(),
    expiryYear: z.string().optional(),
    cvc: z.string().optional(),
    token: z.string().optional(),
  }),
  platform: z.string().trim().min(1),
});

// POST /payment/validate
export const validatePaymentMethodSchema = z.object({
  type: z.enum(['card', 'applePay', 'googlePay']),
  cardNumber: z.string().optional(),
  expiryMonth: z.string().optional(),
  expiryYear: z.string().optional(),
  cvc: z.string().optional(),
  token: z.string().optional(),
});

// GET /payment/methods/:userId
export const paymentMethodsUserIdParams = z.object({
  userId: z.string().trim().min(1),
});
