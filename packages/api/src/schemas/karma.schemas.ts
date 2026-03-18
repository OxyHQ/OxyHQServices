import { z } from 'zod';

// GET /karma/:userId/total, GET /karma/:userId/history
export const karmaUserIdParams = z.object({
  userId: z.string().trim().min(1),
});

// POST /karma/award
export const awardKarmaSchema = z.object({
  userId: z.string().trim().min(1),
  action: z.string().trim().min(1),
  description: z.string().trim().optional(),
  targetContentId: z.string().trim().optional(),
});

// POST /karma/deduct
export const deductKarmaSchema = z.object({
  userId: z.string().trim().min(1),
  action: z.string().trim().min(1),
  points: z.number().positive(),
  description: z.string().trim().optional(),
  targetContentId: z.string().trim().optional(),
});

// POST /karma/rules
export const karmaRuleSchema = z.object({
  action: z.string().trim().min(1),
  points: z.number(),
  description: z.string().trim().optional(),
  cooldownInMinutes: z.number().min(0).default(0),
  isEnabled: z.boolean().default(true),
  category: z.string().trim().default('other'),
});
