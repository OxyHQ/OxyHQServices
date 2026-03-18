import { z } from 'zod';

// GET /search
export const searchQuerySchema = z.object({
  query: z.string().trim().optional(),
  type: z.enum(['all', 'users']).optional().default('all'),
  page: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
});
