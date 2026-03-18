import { z } from 'zod';

// GET /credits/usage
export const creditsUsageQuerySchema = z.object({
  period: z.enum(['7d', '30d']).optional(),
});
