import { z } from 'zod';

// GET /profiles/username/:username
export const usernameParams = z.object({
  username: z.string().trim().min(3).max(30),
});

// GET /profiles/search
export const profileSearchQuerySchema = z.object({
  query: z.string().trim().min(1),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

// GET /profiles/recommendations
export const paginationQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});
