import { z } from 'zod';
import { APPLICATION_ROLES } from '../utils/applicationRoles';
import { APPLICATION_SCOPES } from '../models/Application';
import {
  APPLICATION_CREDENTIAL_TYPES,
  APPLICATION_CREDENTIAL_ENVIRONMENTS,
} from '../models/ApplicationCredential';

/** Route params with :appId. */
export const appIdRouteParams = z.object({
  appId: z.string().trim().min(1),
});

/** Route params with :appId and :memberId. */
export const appMemberParams = z.object({
  appId: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
});

/** Route params with :appId and :credId. */
export const appCredentialParams = z.object({
  appId: z.string().trim().min(1),
  credId: z.string().trim().min(1),
});

/** Usage window query. */
export const periodQuerySchema = z.object({
  period: z.enum(['24h', '7d', '30d', '90d']).optional(),
});

const websiteUrlSchema = z.string().url().optional().or(z.literal(''));
const redirectUrisSchema = z.array(z.string().url()).optional();
const appScopesSchema = z.array(z.enum(APPLICATION_SCOPES)).optional();

/** POST /applications — create. Staff-only fields are intentionally absent. */
export const createApplicationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  websiteUrl: websiteUrlSchema,
  icon: z.string().optional(),
  redirectUris: redirectUrisSchema,
  scopes: appScopesSchema,
});

/**
 * PATCH /applications/:appId — partial update.
 *
 * Staff-only fields (`type`, `isOfficial`, `isInternal`, `capabilities`) are
 * accepted in the schema but only applied when the caller is platform staff;
 * the route silently drops them for non-staff callers.
 */
export const updateApplicationSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    websiteUrl: websiteUrlSchema,
    icon: z.string().optional(),
    redirectUris: redirectUrisSchema,
    scopes: appScopesSchema,
    webhookUrl: z.string().url().optional().or(z.literal('')),
    devWebhookUrl: z.string().url().optional().or(z.literal('')).nullable(),
    status: z.enum(['active', 'suspended', 'pending_review']).optional(),
    type: z.enum(['first_party', 'third_party', 'internal', 'system']).optional(),
    isOfficial: z.boolean().optional(),
    isInternal: z.boolean().optional(),
    capabilities: z.array(z.string()).optional(),
  })
  .strict();

/** Roles assignable to a member (owner is reachable only via transfer-ownership). */
const assignableRoles = APPLICATION_ROLES.filter((role) => role !== 'owner') as Exclude<
  (typeof APPLICATION_ROLES)[number],
  'owner'
>[];

/** POST /applications/:appId/members — invite/add a member. */
export const inviteMemberSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(assignableRoles as [typeof assignableRoles[number], ...typeof assignableRoles]),
});

/** PATCH /applications/:appId/members/:memberId — change a member role. */
export const updateMemberSchema = z.object({
  role: z.enum(assignableRoles as [typeof assignableRoles[number], ...typeof assignableRoles]),
});

/** POST /applications/:appId/transfer-ownership. */
export const transferOwnershipSchema = z.object({
  userId: z.string().trim().min(1),
});

/** POST /applications/:appId/credentials — create a credential. */
export const createCredentialSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(APPLICATION_CREDENTIAL_TYPES),
  environment: z.enum(APPLICATION_CREDENTIAL_ENVIRONMENTS),
  scopes: z.array(z.string()).optional(),
});
