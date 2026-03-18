import { z } from 'zod';

// Params for :userId
export const subscriptionUserIdParams = z.object({
  userId: z.string().trim().min(1),
});

// PUT /subscription/:userId
export const updateSubscriptionSchema = z.object({
  plan: z.string().trim().min(1),
});
