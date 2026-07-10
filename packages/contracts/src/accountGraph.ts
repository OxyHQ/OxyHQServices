/**
 * Account graph wire contracts — organization taxonomy and create-account input.
 *
 * `organizationCategory` classifies `kind: 'organization'` accounts (agency,
 * cooperative, landlord, …) without polluting `User.kind`. Meaningful only when
 * `kind === 'organization'`.
 */

import { z } from 'zod';

export const ORGANIZATION_CATEGORIES = [
  'agency',
  'cooperative',
  'landlord',
  'other',
] as const;

export type OrganizationCategory = (typeof ORGANIZATION_CATEGORIES)[number];

export const organizationCategorySchema = z.enum(ORGANIZATION_CATEGORIES);

const accountNameSchema = z
  .object({
    first: z.string().trim().max(100).optional(),
    last: z.string().trim().max(100).optional(),
  })
  .optional();

/**
 * POST /accounts — create a non-personal account under the caller's tree.
 * `organizationCategory` is accepted only when `kind` is `organization`.
 */
export const createAccountRequestSchema = z
  .object({
    parentAccountId: z.string().trim().min(1).optional(),
    kind: z.enum(['organization', 'project', 'bot']),
    username: z.string().trim().min(1).max(100),
    name: accountNameSchema,
    bio: z.string().trim().max(500).optional(),
    avatar: z.string().optional(),
    description: z.string().trim().max(1000).optional(),
    organizationCategory: organizationCategorySchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.organizationCategory !== undefined && data.kind !== 'organization') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'organizationCategory applies only when kind is organization',
        path: ['organizationCategory'],
      });
    }
  });

export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;
