import { z } from 'zod';

// Params with :id (app id)
export const appIdParams = z.object({
  id: z.string().trim().min(1),
});

// Params with :appId
export const appIdRouteParams = z.object({
  appId: z.string().trim().min(1),
});

// Params with :appId and :keyId
export const appKeyParams = z.object({
  appId: z.string().trim().min(1),
  keyId: z.string().trim().min(1),
});

// Query with period
export const periodQuerySchema = z.object({
  period: z.enum(['24h', '7d', '30d', '90d']).optional(),
});
