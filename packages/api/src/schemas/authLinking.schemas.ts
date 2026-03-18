import { z } from 'zod';

// POST /auth/link
export const linkAuthMethodSchema = z.object({
  type: z.enum(['identity', 'password', 'google', 'apple', 'github']),
  publicKey: z.string().trim().optional(),
  signature: z.string().trim().optional(),
  timestamp: z.number().optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(8).optional(),
  providerId: z.string().trim().optional(),
});

// DELETE /auth/link/:type
export const unlinkTypeParams = z.object({
  type: z.enum(['identity', 'password', 'google', 'apple', 'github']),
});
