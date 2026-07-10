import { z } from 'zod';
import {
  createAccountRequestSchema,
  organizationCategorySchema,
} from '@oxyhq/contracts';
import { ACCOUNT_ROLES } from '../utils/accountRoles';
import { ACCOUNT_CREDENTIAL_ENVIRONMENTS } from '../models/AccountCredential';
import { APPLICATION_SCOPES } from '../utils/applicationScopes';

/** Route params with :id (the account id). */
export const accountIdRouteParams = z.object({
  id: z.string().trim().min(1),
});

/** Route params with :id and :memberId. */
export const accountMemberParams = z.object({
  id: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
});

/** Route params with :id and :credId. */
export const accountCredentialParams = z.object({
  id: z.string().trim().min(1),
  credId: z.string().trim().min(1),
});

/** GET /accounts — optional `?tree=true` to request a nested forest. */
export const listAccountsQuerySchema = z.object({
  tree: z.enum(['true', 'false']).optional(),
});

const nameSchema = z
  .object({
    first: z.string().trim().max(100).optional(),
    last: z.string().trim().max(100).optional(),
  })
  .optional();

/**
 * POST /accounts — create an account.
 *
 * `parentAccountId` is OPTIONAL: when omitted the new account is created under
 * the caller's own (personal) account — i.e. a top-level org/project/bot the
 * caller owns. `kind` must be a non-personal kind (personal accounts are roots
 * minted at signup, not here).
 */
export const createAccountSchema = createAccountRequestSchema;

/** PATCH /accounts/:id — partial profile update. */
export const updateAccountSchema = z
  .object({
    username: z.string().trim().min(1).max(100).optional(),
    name: nameSchema,
    bio: z.string().trim().max(500).optional(),
    avatar: z.string().optional(),
    description: z.string().trim().max(1000).optional(),
    color: z.string().trim().max(32).optional(),
    links: z.array(z.string()).optional(),
    organizationCategory: organizationCategorySchema.nullable().optional(),
  })
  .strict();

/** POST /accounts/:id/move — re-parent the account. */
export const moveAccountSchema = z.object({
  newParentId: z.string().trim().min(1),
});

/** Roles assignable to a member (owner is reachable only via transfer-ownership). */
const assignableRoles = ACCOUNT_ROLES.filter((role) => role !== 'owner') as Exclude<
  (typeof ACCOUNT_ROLES)[number],
  'owner'
>[];

/**
 * POST /accounts/:id/members — invite/add a member by username or email.
 * `inherit` controls whether the membership cascades to descendant accounts.
 */
export const inviteAccountMemberSchema = z.object({
  usernameOrEmail: z.string().trim().min(1),
  role: z.enum(assignableRoles as [typeof assignableRoles[number], ...typeof assignableRoles]),
  inherit: z.boolean().optional(),
});

/** PATCH /accounts/:id/members/:memberId — change a member role / inheritance. */
export const updateAccountMemberSchema = z
  .object({
    role: z.enum(assignableRoles as [typeof assignableRoles[number], ...typeof assignableRoles]),
    inherit: z.boolean().optional(),
  })
  .strict();

/** POST /accounts/:id/transfer-ownership. */
export const transferAccountOwnershipSchema = z.object({
  userId: z.string().trim().min(1),
});

/**
 * POST /accounts/:id/credentials — create a service credential (bot accounts).
 * `scopes` is constrained to the application-scope enum.
 */
export const createAccountCredentialSchema = z.object({
  name: z.string().trim().min(1).max(100),
  environment: z.enum(ACCOUNT_CREDENTIAL_ENVIRONMENTS),
  scopes: z.array(z.enum(APPLICATION_SCOPES)).optional(),
});
