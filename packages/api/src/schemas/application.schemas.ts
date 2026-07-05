import { z } from 'zod';
import { APPLICATION_SCOPES } from '../utils/applicationScopes';
import {
  APPLICATION_CREDENTIAL_TYPES,
  APPLICATION_CREDENTIAL_ENVIRONMENTS,
} from '../models/ApplicationCredential';

/** Route params with :appId. */
export const appIdRouteParams = z.object({
  appId: z.string().trim().min(1),
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
/**
 * Public legal URL (privacy policy / terms of service) shown on the OAuth
 * consent screen. Must be an absolute `https://` URL. An empty string clears the
 * stored value, mirroring `websiteUrlSchema`.
 */
const legalUrlSchema = z
  .string()
  .url()
  .startsWith('https://', 'URL must use https')
  .optional()
  .or(z.literal(''));
const redirectUrisSchema = z.array(z.string().url()).optional();
const appScopesSchema = z.array(z.enum(APPLICATION_SCOPES)).optional();

/** POST /applications — create. Staff-only fields are intentionally absent. */
export const createApplicationSchema = z.object({
  /**
   * The Account that will own the new application. OPTIONAL: when omitted the
   * route defaults to the caller's OWN account (a top-level app they own). When
   * provided the caller must hold `apps:create` over that account.
   */
  ownerAccountId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  websiteUrl: websiteUrlSchema,
  privacyPolicyUrl: legalUrlSchema,
  termsUrl: legalUrlSchema,
  icon: z.string().optional(),
  redirectUris: redirectUrisSchema,
  scopes: appScopesSchema,
});

/** Optional `?ownerAccountId=` filter on GET /applications. */
export const listApplicationsQuerySchema = z.object({
  ownerAccountId: z.string().trim().min(1).optional(),
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
    privacyPolicyUrl: legalUrlSchema,
    termsUrl: legalUrlSchema,
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

/**
 * POST /applications/:appId/credentials — create a credential.
 *
 * `scopes` is constrained to the SAME enum as application scopes (no free-form
 * strings). The route additionally intersects the requested scopes with the
 * owning application's granted scopes, so a credential can never exceed its
 * app's authority.
 */
export const createCredentialSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(APPLICATION_CREDENTIAL_TYPES),
  environment: z.enum(APPLICATION_CREDENTIAL_ENVIRONMENTS),
  scopes: z.array(z.enum(APPLICATION_SCOPES)).optional(),
});
