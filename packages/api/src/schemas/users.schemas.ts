import { z } from 'zod';

// Shared params for routes with :userId
export const userIdParams = z.object({
  userId: z.string().trim().min(1),
});

// POST /users/search
export const searchUsersBodySchema = z.object({
  query: z.string().trim().min(1),
});

// POST /users/verify/request
export const verifyRequestSchema = z.object({
  reason: z.string().trim().min(1),
  evidence: z.string().trim().optional(),
});

// DELETE /users/me
export const deleteAccountSchema = z.object({
  signature: z.string().trim().min(1),
  timestamp: z.number(),
  confirmText: z.string().trim().min(1),
});

// GET /users/me/data
export const dataExportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).optional(),
});

// Pagination query schema
export const paginationQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

// PUT /users/:userId/privacy
export const updatePrivacyBodySchema = z.object({
  privacySettings: z.record(z.unknown()),
});
