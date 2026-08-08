import express from 'express';
import crypto from 'crypto';
import { and, count, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { getDb } from '../config/postgres';
import { apiKeyUsageEvents, applicationCredentials, applications } from '../db/schema';
import {
  type APPLICATION_SCOPES,
  type ApplicationScope,
  isPaymentsScope,
  isPrivilegedScope,
} from '../utils/applicationScopes';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { isStaffUser } from '../middleware/requireStaff';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/error';
import { logger } from '../utils/logger';
import credentialDomainCache from '../utils/credentialDomainCache';
import { refreshOriginRegistry } from '../config/dynamicOriginRegistry';
import { stripSensitiveUrlQueryParams } from '../utils/sanitizeUrl';
import { isTrustedApplication } from '../utils/trustedApplication';
import { accountService } from '../services/account.service';
import {
  appPermissionsForAccountRole,
  type AccountRole,
  type ApplicationPermission,
} from '../utils/accountRoles';
import {
  appIdRouteParams,
  appCredentialParams,
  periodQuerySchema,
  createApplicationSchema,
  listApplicationsQuerySchema,
  updateApplicationSchema,
  createCredentialSchema,
} from '../schemas/application.schemas';
import { storeListingBody } from '../schemas/store.schemas';
import {
  getListingForApplication,
  submitListing,
  unpublishListing,
  upsertListing,
} from '../services/store.service';

/** A stored application row. */
type ApplicationRow = typeof applications.$inferSelect;

/**
 * A credential row as read by this module — every column EXCEPT `secretHash`.
 * See {@link CREDENTIAL_COLUMNS}.
 */
type CredentialRow = Omit<typeof applicationCredentials.$inferSelect, 'secretHash'>;

/**
 * Resolved application access for the caller.
 *
 * Access to an application is DERIVED from the caller's effective `AccountMember`
 * role over the application's owning account (`app.ownerAccountId`), honouring
 * tree inheritance. The account role is mapped to a concrete set of application
 * permissions via `appPermissionsForAccountRole`. There is no per-app member
 * table.
 */
interface AppAccess {
  application: ApplicationRow;
  /** The caller's effective account role over `ownerAccountId`. */
  role: AccountRole;
  /** Effective application permissions derived from that role. */
  permissions: Set<ApplicationPermission>;
}

/**
 * Request decorated by `loadApplicationContext` / `requireAppPermission` with
 * the resolved application and the caller's access.
 */
interface AppContextRequest extends AuthRequest {
  application?: ApplicationRow;
  access?: AppAccess;
}

const CREDENTIAL_PUBLIC_KEY_PREFIX = 'oxy_dk_';
const PUBLIC_KEY_RANDOM_BYTES = 24;
const SECRET_RANDOM_BYTES = 32;
const WEBHOOK_SECRET_RANDOM_BYTES = 24;

/**
 * Grace window during which a credential that has been rotated away keeps
 * working. On rotation the previous credential is marked `deprecated` and its
 * `expiresAt` is set to `now + CREDENTIAL_ROTATION_GRACE_MS`, giving callers
 * time to roll out the new secret with zero downtime (7 days).
 */
const CREDENTIAL_ROTATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Most-used endpoints reported by the usage summary. */
const USAGE_TOP_ENDPOINTS = 10;

/**
 * The credential columns a client may ever see — every column except
 * `secretHash`.
 *
 * Mongoose expressed this as `.select('-secretHash')`; drizzle enumerates
 * columns explicitly and has no exclusion form, so the selection is named once
 * here and reused by the list read AND by every `returning()`. A credential
 * object in this module therefore never carries the hash in the first place,
 * which is a stronger guarantee than remembering to drop it in the serializer.
 */
const CREDENTIAL_COLUMNS = {
  id: applicationCredentials.id,
  applicationId: applicationCredentials.applicationId,
  name: applicationCredentials.name,
  publicKey: applicationCredentials.publicKey,
  type: applicationCredentials.type,
  environment: applicationCredentials.environment,
  scopes: applicationCredentials.scopes,
  status: applicationCredentials.status,
  lastUsedAt: applicationCredentials.lastUsedAt,
  expiresAt: applicationCredentials.expiresAt,
  rotatedFromCredentialId: applicationCredentials.rotatedFromCredentialId,
  createdByUserId: applicationCredentials.createdByUserId,
  createdAt: applicationCredentials.createdAt,
  updatedAt: applicationCredentials.updatedAt,
};

const router = express.Router();

/**
 * Rebuild the dynamic CORS origin snapshot after an Application
 * create/update/delete. A change to an app's `redirectUris` or `status` changes
 * the registry-derived CORS allowlist, so refresh now instead of waiting for
 * the 60s background tick. Fire-and-forget — never blocks the response.
 */
function refreshDynamicCorsOrigins(): void {
  void refreshOriginRegistry().catch((err) =>
    logger.warn('dynamicOriginRegistry refresh after application change failed', {
      err: err instanceof Error ? err.message : String(err),
    }),
  );
}

// All application routes require an authenticated user.
router.use(authMiddleware);

/** Resolve the authenticated user id, or throw 401. */
function requireUserId(req: AuthRequest): string {
  const userId = req.user?._id?.toString();
  if (!userId) {
    throw new UnauthorizedError('Authentication required');
  }
  return userId;
}

/**
 * The application `requireAppPermission` already loaded, narrowed.
 *
 * The middleware has thrown 404 if it is absent, so this cannot fire; it
 * exists because `req.application` is optional on the request type and the
 * alternative is a non-null assertion, which the house rules forbid for good
 * reason.
 */
function requireApplication(req: AppContextRequest): ApplicationRow {
  if (!req.application) {
    throw new NotFoundError('Application not found');
  }
  return req.application;
}

/** Compute the window start date for a usage period. */
function getStartDate(period: string): Date {
  const now = new Date();
  const startDate = new Date();
  switch (period) {
    case '24h':
      startDate.setHours(now.getHours() - 24);
      break;
    case '7d':
      startDate.setDate(now.getDate() - 7);
      break;
    case '30d':
      startDate.setDate(now.getDate() - 30);
      break;
    case '90d':
      startDate.setDate(now.getDate() - 90);
      break;
    default:
      startDate.setDate(now.getDate() - 7);
  }
  return startDate;
}

/**
 * De-duplicate a redirect-URI input list into a single ordered list of EXACT
 * URI strings. Order is preserved and URI strings are kept verbatim — no
 * trailing-slash or wildcard normalisation, because OAuth authorize matches the
 * `redirect_uri` exactly (RFC 6749 §3.1.2). Returns `undefined` when the field
 * was not supplied so callers can leave the stored value untouched on partial
 * updates.
 */
function resolveRedirectUris(input: { redirectUris?: string[] }): string[] | undefined {
  if (input.redirectUris === undefined) {
    return undefined;
  }
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const uri of input.redirectUris) {
    if (seen.has(uri)) continue;
    seen.add(uri);
    deduped.push(uri);
  }
  return deduped;
}

/**
 * Enforce the staff-only privileged-scope gate when an actor sets an
 * application's scopes.
 *
 * Privileged scopes ({@link isPrivilegedScope}, e.g. `federation:write`,
 * `signals:write`) confer act-on-behalf authority and are ENTIRELY
 * staff-controlled: a non-staff caller may neither grant NOR revoke them. Only
 * platform staff may change an application's privileged-scope set.
 *
 * Because `PATCH /:appId` (and create) replace `application.scopes` wholesale
 * with the submitted array, a naive "reject on newly-added privileged scope"
 * check would still let a non-staff caller SILENTLY DROP an already-granted
 * privileged scope simply by omitting it from the payload — e.g. a console
 * scope-picker form whose canonical option list predates a newly-added
 * privileged scope submits a set that no longer contains it, and the
 * authoritative replace revokes it. That is exactly how Mention's granted,
 * in-use `signals:write` was being wiped on routine app edits, breaking
 * recommendation signal pushes at the next service-token mint (the mint
 * intersects credential scopes with app scopes, so losing it on the app loses
 * it for every credential).
 *
 * The gate is therefore symmetric for non-staff callers:
 * - Adding a privileged scope not already present → 403 (unchanged).
 * - Omitting an already-granted privileged scope → the scope is PRESERVED
 *   (re-added to the result), never silently revoked. Removing a privileged
 *   scope requires staff.
 *
 * `previousScopes` supplies the currently-granted set to reconcile against; it
 * is empty on create (nothing to preserve) and the stored scopes on update. It
 * is `readonly string[]` rather than `ApplicationScope[]` because the stored
 * column is a `text[]` — narrowing back to the vocabulary is what
 * `isPrivilegedScope`'s type predicate does below.
 *
 * Staff callers get an authoritative replace of exactly what they submit,
 * including intentional privileged-scope removal. Returns the validated,
 * deduplicated scope list.
 */
function authorizeRequestedScopes(
  req: AuthRequest,
  requestedScopes: ApplicationScope[],
  previousScopes: readonly string[]
): ApplicationScope[] {
  const deduped = Array.from(new Set(requestedScopes));

  if (isStaffUser(req)) {
    return deduped;
  }

  const previouslyGranted = new Set(previousScopes);
  const requested = new Set<string>(deduped);

  const newlyAddedPrivileged = deduped.filter(
    (scope) => isPrivilegedScope(scope) && !previouslyGranted.has(scope)
  );

  if (newlyAddedPrivileged.length > 0) {
    logger.warn('Non-staff actor attempted to grant privileged application scope', {
      userId: requireUserId(req),
      scopes: newlyAddedPrivileged,
    });
    throw new ForbiddenError(
      `Granting the scope(s) [${newlyAddedPrivileged.join(', ')}] requires Oxy platform staff privileges`
    );
  }

  // Preserve already-granted privileged scopes a non-staff caller omitted:
  // revoking a privileged scope is a staff-only mutation, so an omission is
  // treated as "leave it untouched" rather than a silent revoke.
  const preservedPrivileged = Array.from(previouslyGranted).filter(
    (scope): scope is ApplicationScope => isPrivilegedScope(scope) && !requested.has(scope)
  );
  if (preservedPrivileged.length > 0) {
    logger.warn('Preserving already-granted privileged application scope omitted by non-staff actor', {
      userId: requireUserId(req),
      scopes: preservedPrivileged,
    });
  }

  return [...deduped, ...preservedPrivileged];
}

/**
 * Serialised caller membership embedded on an application. Derived from the
 * caller's effective account role over `ownerAccountId` (no per-app member row).
 */
interface SerializedCallerMembership {
  role: AccountRole;
  permissions: ApplicationPermission[];
  source: 'account';
  ownerAccountId: string;
}

/**
 * The wire shape of an application. Declared explicitly so a column rename or a
 * dropped field fails `tsc` here rather than silently changing the response.
 *
 * Every optional field is `?: T` and is fed `?? undefined` from its nullable
 * column: Mongo omitted an unset field entirely, and `JSON.stringify` drops an
 * `undefined` property but emits an explicit `null`. Mapping the column's NULL
 * back to `undefined` is what keeps the response byte-identical.
 */
interface SerializedApplication {
  _id: string;
  name: string;
  description?: string;
  websiteUrl?: string;
  privacyPolicyUrl?: string;
  termsUrl?: string;
  icon?: string;
  type: ApplicationRow['type'];
  status: ApplicationRow['status'];
  isOfficial: boolean;
  isInternal: boolean;
  capabilities: string[];
  redirectUris: string[];
  scopes: string[];
  webhookUrl?: string;
  devWebhookUrl?: string;
  ownerAccountId: string;
  createdByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  callerMembership: SerializedCallerMembership | null;
}

/** The wire shape of a credential — NEVER carries secret material. */
interface SerializedCredential {
  _id: string;
  applicationId: string;
  name: string;
  publicKey: string;
  type: CredentialRow['type'];
  environment: CredentialRow['environment'];
  scopes: string[];
  status: CredentialRow['status'];
  lastUsedAt?: Date;
  expiresAt?: Date;
  rotatedFromCredentialId?: string;
  createdByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Serialise an application for client responses (no webhook secret). */
function serializeApplication(
  app: ApplicationRow,
  callerMembership?: SerializedCallerMembership | null
): SerializedApplication {
  return {
    _id: app.id,
    name: app.name,
    description: app.description ?? undefined,
    websiteUrl: app.websiteUrl ?? undefined,
    privacyPolicyUrl: app.privacyPolicyUrl ?? undefined,
    termsUrl: app.termsUrl ?? undefined,
    icon: app.icon ?? undefined,
    type: app.type,
    status: app.status,
    isOfficial: app.isOfficial,
    isInternal: app.isInternal,
    capabilities: app.capabilities,
    redirectUris: app.redirectUris,
    scopes: app.scopes,
    webhookUrl: app.webhookUrl ?? undefined,
    devWebhookUrl: app.devWebhookUrl ?? undefined,
    ownerAccountId: app.ownerAccountId,
    createdByUserId: app.createdByUserId ?? undefined,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    callerMembership: callerMembership ?? null,
  };
}

/** Serialise a credential for client responses — NEVER includes the secret hash. */
function serializeCredential(credential: CredentialRow): SerializedCredential {
  return {
    _id: credential.id,
    applicationId: credential.applicationId,
    name: credential.name,
    publicKey: credential.publicKey,
    type: credential.type,
    environment: credential.environment,
    scopes: credential.scopes,
    status: credential.status,
    lastUsedAt: credential.lastUsedAt ?? undefined,
    expiresAt: credential.expiresAt ?? undefined,
    rotatedFromCredentialId: credential.rotatedFromCredentialId ?? undefined,
    createdByUserId: credential.createdByUserId ?? undefined,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

/** Aggregate totals over the requested window. */
interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCredits: number;
  avgResponseTime: number;
  successfulRequests: number;
  errorRequests: number;
}

/** Per-day usage bucket. `_id` is the UTC day key (`YYYY-MM-DD`). */
interface UsageByDay {
  _id: string;
  requests: number;
  tokens: number;
  credits: number;
}

/** Per-endpoint usage bucket. `_id` is the endpoint. */
interface UsageByEndpoint {
  _id: string;
  requests: number;
  tokens: number;
}

/** Usage statistics for one application over a period. */
interface UsageStats {
  summary: UsageSummary;
  byDay: UsageByDay[];
  byEndpoint: UsageByEndpoint[];
}

/**
 * Usage statistics for one application since `startDate`.
 *
 * `sum()` over an integer column yields `bigint`, which postgres.js hands back
 * as a STRING; every integer total is therefore cast in SQL rather than
 * converted in TypeScript. `avg` and the credit sum are already
 * double-precision. `count(*) filter (where …)` replaces Mongo's
 * `$sum: {$cond: […]}`.
 */
async function getUsageStats(applicationId: string, startDate: Date): Promise<UsageStats> {
  const db = getDb();
  const window = and(
    eq(apiKeyUsageEvents.applicationId, applicationId),
    gte(apiKeyUsageEvents.createdAt, startDate)
  );

  // Mongo's `$dateToString` formats in UTC; `to_char` over a `timestamptz`
  // formats in the SESSION time zone, so the day key is pinned to UTC here or
  // the buckets silently shift with the server's `TimeZone`.
  const dayKey = sql<string>`to_char(${apiKeyUsageEvents.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const tokenTotal = sql<number>`coalesce(sum(${apiKeyUsageEvents.tokensUsed}), 0)::int`;
  const creditTotal = sql<number>`coalesce(sum(${apiKeyUsageEvents.creditsUsed}), 0)::double precision`;

  const [summary] = await db
    .select({
      totalRequests: count(),
      totalTokens: tokenTotal,
      totalCredits: creditTotal,
      avgResponseTime: sql<number>`coalesce(avg(${apiKeyUsageEvents.responseTime}), 0)::double precision`,
      successfulRequests: sql<number>`(count(*) filter (where ${apiKeyUsageEvents.statusCode} < 400))::int`,
      errorRequests: sql<number>`(count(*) filter (where ${apiKeyUsageEvents.statusCode} >= 400))::int`,
    })
    .from(apiKeyUsageEvents)
    .where(window);

  const byDay = await db
    .select({ _id: dayKey, requests: count(), tokens: tokenTotal, credits: creditTotal })
    .from(apiKeyUsageEvents)
    .where(window)
    .groupBy(dayKey)
    .orderBy(dayKey);

  const byEndpoint = await db
    .select({ _id: apiKeyUsageEvents.endpoint, requests: count(), tokens: tokenTotal })
    .from(apiKeyUsageEvents)
    .where(window)
    .groupBy(apiKeyUsageEvents.endpoint)
    .orderBy(sql`count(*) desc`)
    .limit(USAGE_TOP_ENDPOINTS);

  return { summary, byDay, byEndpoint };
}

/** Generate a fresh credential public key + plaintext secret + its hash. */
function generateCredentialMaterial(): { publicKey: string; secret: string; secretHash: string } {
  const publicKey =
    CREDENTIAL_PUBLIC_KEY_PREFIX + crypto.randomBytes(PUBLIC_KEY_RANDOM_BYTES).toString('hex');
  const secret = crypto.randomBytes(SECRET_RANDOM_BYTES).toString('hex');
  const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
  return { publicKey, secret, secretHash };
}

/** Build the `callerMembership` projection from resolved access. */
function callerMembershipFromAccess(access: AppAccess | undefined): SerializedCallerMembership | null {
  if (!access) return null;
  return {
    role: access.role,
    permissions: [...access.permissions],
    source: 'account',
    ownerAccountId: access.application.ownerAccountId,
  };
}

/**
 * Resolve the application (non-deleted) and the caller's effective access for
 * `:appId`. Access is the caller's effective `AccountMember` role over
 * `app.ownerAccountId` (with inheritance), mapped to application permissions.
 * Returns 404 when the app is missing/deleted and 403 when the caller has no
 * account access to its owner.
 */
async function loadApplicationContext(req: AppContextRequest): Promise<AppAccess> {
  const userId = requireUserId(req);
  const db = getDb();

  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, req.params.appId), ne(applications.status, 'deleted')))
    .limit(1);
  if (!application) {
    throw new NotFoundError('Application not found');
  }

  const accountAccess = await accountService.resolveEffectiveAccess(
    userId,
    application.ownerAccountId
  );
  if (!accountAccess) {
    throw new ForbiddenError('You do not have access to this application');
  }

  const permissions = new Set<ApplicationPermission>(
    appPermissionsForAccountRole(accountAccess.role)
  );

  const access: AppAccess = { application, role: accountAccess.role, permissions };
  req.application = application;
  req.access = access;
  return access;
}

/**
 * RBAC middleware factory. Resolves the application + caller's effective access
 * for `:appId`, then enforces that the access carries `permission`.
 */
function requireAppPermission(permission: ApplicationPermission) {
  return asyncHandler(async (req: AppContextRequest, _res, next) => {
    const { permissions } = await loadApplicationContext(req);
    if (!permissions.has(permission)) {
      throw new ForbiddenError(`Missing required permission: ${permission}`);
    }
    next();
  });
}

// ============================================================================
// Applications — CRUD
// ============================================================================

/**
 * List applications the caller can access — i.e. every app whose owning account
 * is in the caller's accessible account forest (their own account + every
 * account they are a member of, with subtrees).
 *
 * With `?ownerAccountId=<id>`: returns only that account's applications, and
 * only if the caller has effective access to that account (otherwise 403).
 */
router.get(
  '/',
  validate({ query: listApplicationsQuerySchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = requireUserId(req);
    const ownerAccountIdFilter = req.query.ownerAccountId as string | undefined;

    // The caller's effective account role per accessible account id.
    const roleByAccountId = new Map<string, AccountRole>();

    if (ownerAccountIdFilter !== undefined) {
      const access = await accountService.resolveEffectiveAccess(userId, ownerAccountIdFilter);
      if (!access) {
        throw new ForbiddenError('You do not have access to this account');
      }
      roleByAccountId.set(ownerAccountIdFilter, access.role);
    } else {
      const nodes = await accountService.listAccessibleAccounts(userId);
      for (const node of nodes) {
        const role: AccountRole | undefined =
          node.relationship === 'self' ? 'owner' : node.callerMembership?.role;
        if (role) {
          roleByAccountId.set(node.accountId, role);
        }
      }
    }

    const accountIds = [...roleByAccountId.keys()];
    if (accountIds.length === 0) {
      res.json({ applications: [] });
      return;
    }

    const rows = await getDb()
      .select()
      .from(applications)
      .where(
        and(
          inArray(applications.ownerAccountId, accountIds),
          ne(applications.status, 'deleted')
        )
      )
      .orderBy(desc(applications.createdAt));

    res.json({
      applications: rows.map((app) => {
        const role = roleByAccountId.get(app.ownerAccountId);
        const callerMembership = role
          ? {
              role,
              permissions: appPermissionsForAccountRole(role),
              source: 'account' as const,
              ownerAccountId: app.ownerAccountId,
            }
          : null;
        return serializeApplication(app, callerMembership);
      }),
    });
  })
);

/**
 * Create a new application owned by an account.
 *
 * `ownerAccountId` defaults to the caller's OWN account when omitted (a
 * top-level app they own). The caller must hold `apps:create` over the owning
 * account. Staff-only fields default and are not settable here.
 */
router.post(
  '/',
  validate({ body: createApplicationSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = requireUserId(req);
    const body = req.body as {
      ownerAccountId?: string;
      name: string;
      description?: string;
      websiteUrl?: string;
      privacyPolicyUrl?: string;
      termsUrl?: string;
      icon?: string;
      redirectUris?: string[];
      scopes?: typeof APPLICATION_SCOPES[number][];
    };

    const ownerAccountId = body.ownerAccountId ?? userId;

    const access = await accountService.resolveEffectiveAccess(userId, ownerAccountId);
    if (!access) {
      throw new ForbiddenError('You do not have access to the owning account');
    }
    if (!access.permissions.includes('apps:create')) {
      throw new ForbiddenError('Missing required permission: apps:create');
    }

    // Privileged scopes (e.g. federation:write) are NOT self-grantable.
    const scopes = authorizeRequestedScopes(req, body.scopes ?? [], []);

    const [application] = await getDb()
      .insert(applications)
      .values({
        name: body.name,
        description: body.description,
        websiteUrl: body.websiteUrl || undefined,
        privacyPolicyUrl: body.privacyPolicyUrl || undefined,
        termsUrl: body.termsUrl || undefined,
        icon: body.icon ? stripSensitiveUrlQueryParams(body.icon) : body.icon,
        redirectUris: resolveRedirectUris(body) ?? [],
        scopes,
        ownerAccountId,
        createdByUserId: userId,
      })
      .returning();

    // A newly-created app is `active` and may carry redirectUris, so it can add
    // origins to the approved-clients allow-list. Drop the cached set.
    if (application.status === 'active' && application.redirectUris.length > 0) {
      refreshDynamicCorsOrigins();
    }

    logger.info('Application created', {
      userId,
      applicationId: application.id,
      ownerAccountId: ownerAccountId,
      name: application.name,
    });

    const callerMembership: SerializedCallerMembership = {
      role: access.role,
      permissions: appPermissionsForAccountRole(access.role),
      source: 'account',
      ownerAccountId: ownerAccountId,
    };

    res.status(201).json({
      application: serializeApplication(application, callerMembership),
    });
  })
);

/**
 * Get a single application the caller can read.
 */
router.get(
  '/:appId',
  validate({ params: appIdRouteParams }),
  requireAppPermission('app:read'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    if (!application) {
      throw new NotFoundError('Application not found');
    }
    res.json({
      application: serializeApplication(application, callerMembershipFromAccess(req.access)),
    });
  })
);

/**
 * Partially update an application. Staff-only fields are applied only when the
 * caller is platform staff; otherwise they are silently dropped.
 */
router.patch(
  '/:appId',
  validate({ params: appIdRouteParams, body: updateApplicationSchema }),
  requireAppPermission('app:update'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const stored = req.application;
    if (!stored) {
      throw new NotFoundError('Application not found');
    }

    const body = req.body as {
      name?: string;
      description?: string;
      websiteUrl?: string;
      privacyPolicyUrl?: string;
      termsUrl?: string;
      icon?: string;
      redirectUris?: string[];
      scopes?: typeof APPLICATION_SCOPES[number][];
      webhookUrl?: string;
      devWebhookUrl?: string | null;
      status?: 'active' | 'suspended' | 'pending_review';
      type?: ApplicationRow['type'];
      isOfficial?: boolean;
      isInternal?: boolean;
      capabilities?: string[];
    };

    // Only the fields the caller actually supplied are written, so a partial
    // update never rewrites a column it did not name.
    const updates: Partial<typeof applications.$inferInsert> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.websiteUrl !== undefined) updates.websiteUrl = body.websiteUrl || null;
    if (body.privacyPolicyUrl !== undefined) {
      updates.privacyPolicyUrl = body.privacyPolicyUrl || null;
    }
    if (body.termsUrl !== undefined) updates.termsUrl = body.termsUrl || null;
    if (body.icon !== undefined) updates.icon = stripSensitiveUrlQueryParams(body.icon);
    if (body.scopes !== undefined) {
      // Privileged scopes (e.g. federation:write) are staff-only. A non-staff
      // caller may keep an already-granted privileged scope but may not add one.
      updates.scopes = authorizeRequestedScopes(req, body.scopes, stored.scopes);
    }
    if (body.status !== undefined) updates.status = body.status;
    if (body.devWebhookUrl !== undefined) {
      updates.devWebhookUrl = body.devWebhookUrl || null;
    }

    const resolvedRedirectUris = resolveRedirectUris(body);
    if (resolvedRedirectUris !== undefined) {
      updates.redirectUris = resolvedRedirectUris;
    }

    // Rotate the webhook secret whenever the webhook URL changes.
    if (body.webhookUrl !== undefined && body.webhookUrl !== stored.webhookUrl) {
      updates.webhookUrl = body.webhookUrl || null;
      updates.webhookSecret = body.webhookUrl
        ? crypto.randomBytes(WEBHOOK_SECRET_RANDOM_BYTES).toString('hex')
        : null;
    }

    // Staff-only fields — applied only for platform staff, silently dropped otherwise.
    if (isStaffUser(req)) {
      if (body.type !== undefined) updates.type = body.type;
      if (body.isOfficial !== undefined) updates.isOfficial = body.isOfficial;
      if (body.isInternal !== undefined) updates.isInternal = body.isInternal;
      if (body.capabilities !== undefined) updates.capabilities = body.capabilities;
    }

    // An empty patch writes nothing at all — matching Mongoose's `save()` on a
    // document with no modified paths, which also left `updatedAt` untouched.
    let application = stored;
    if (Object.keys(updates).length > 0) {
      const [updated] = await getDb()
        .update(applications)
        .set(updates)
        .where(eq(applications.id, stored.id))
        .returning();
      if (!updated) {
        throw new NotFoundError('Application not found');
      }
      application = updated;
    }

    // The federation-domain allow-list is DERIVED from this app's redirectUris
    // and status; invalidate eagerly so revoked redirectUris or a suspended
    // status stop authorising federation signing immediately.
    credentialDomainCache.invalidate(application.id);
    refreshDynamicCorsOrigins();

    logger.info('Application updated', {
      userId: requireUserId(req),
      applicationId: application.id,
    });

    res.json({
      application: serializeApplication(application, callerMembershipFromAccess(req.access)),
    });
  })
);

/**
 * Soft-delete an application (`app:delete`).
 */
router.delete(
  '/:appId',
  validate({ params: appIdRouteParams }),
  requireAppPermission('app:delete'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    const [deleted] = await getDb()
      .update(applications)
      .set({ status: 'deleted' })
      .where(eq(applications.id, application.id))
      .returning({ id: applications.id });
    if (!deleted) {
      throw new NotFoundError('Application not found');
    }

    // A deleted app must immediately stop authorising federation signing.
    credentialDomainCache.invalidate(application.id);
    refreshDynamicCorsOrigins();

    logger.info('Application deleted', {
      userId: requireUserId(req),
      applicationId: application.id,
    });

    res.json({ success: true });
  })
);

// ============================================================================
// Credentials
// ============================================================================

/**
 * List credentials for an application. Never includes secret material.
 */
router.get(
  '/:appId/credentials',
  validate({ params: appIdRouteParams }),
  requireAppPermission('credentials:read'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    const credentials = await getDb()
      .select(CREDENTIAL_COLUMNS)
      .from(applicationCredentials)
      .where(eq(applicationCredentials.applicationId, application.id))
      .orderBy(desc(applicationCredentials.createdAt));

    res.json({ credentials: credentials.map(serializeCredential) });
  })
);

/**
 * Create a credential.
 *
 * The plaintext `secret` is returned in the response body EXACTLY ONCE and can
 * never be retrieved again — only its SHA-256 hash is persisted. `public`
 * credentials carry no secret (the `secret` field is `null`).
 */
router.post(
  '/:appId/credentials',
  validate({ params: appIdRouteParams, body: createCredentialSchema }),
  requireAppPermission('credentials:create'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    const body = req.body as {
      name: string;
      type: CredentialRow['type'];
      environment: CredentialRow['environment'];
      scopes?: ApplicationScope[];
    };

    // A credential may never exceed its owning application's authority.
    const requestedScopes = body.scopes ?? [];

    // Service credentials mint bearer service tokens for Oxy-to-Oxy / internal
    // routes. Only platform-trusted applications may hold them — EXCEPT a
    // narrow Oxy Pay carve-out: a non-trusted (`third_party`) application MAY
    // create a service credential when every requested scope is a payments
    // scope ({@link isPaymentsScope}, i.e. `payments:read`/`payments:write`).
    // Those two scopes are already non-privileged/self-grantable and bounded
    // to the app's own Oxy Pay Gateway tenant (see `applicationScopes.ts`),
    // and the resulting service token's downstream authority is bounded by
    // its scopes — the Oxy Pay Gateway only honours `payments:*`. This lets
    // external Oxy Pay merchants (WooCommerce, Mercaria, etc.) self-serve the
    // service credential the `@oxyhq/pay` SDK needs, without ever letting a
    // self-service app mint a trusted service token for files/user/
    // federation/etc. Requesting ANY non-payments scope on a service
    // credential still requires platform trust — the check below is
    // unaffected for that case.
    const isPaymentsOnlyServiceCredential =
      requestedScopes.length > 0 && requestedScopes.every(isPaymentsScope);
    if (
      body.type === 'service' &&
      !isTrustedApplication(application) &&
      !isPaymentsOnlyServiceCredential
    ) {
      throw new ForbiddenError('Service credentials are only available to trusted applications');
    }

    const grantableScopes = new Set(application.scopes);
    const ungrantable = requestedScopes.filter((scope) => !grantableScopes.has(scope));
    if (ungrantable.length > 0) {
      throw new BadRequestError(
        `Credential scope(s) [${ungrantable.join(', ')}] are not granted to this application`
      );
    }

    const { publicKey, secret, secretHash } = generateCredentialMaterial();
    const isPublicClient = body.type === 'public';

    const [credential] = await getDb()
      .insert(applicationCredentials)
      .values({
        applicationId: application.id,
        name: body.name,
        secretHash: isPublicClient ? null : secretHash,
        publicKey,
        type: body.type,
        environment: body.environment,
        scopes: requestedScopes,
        status: 'active',
        createdByUserId: requireUserId(req),
      })
      .returning(CREDENTIAL_COLUMNS);

    logger.info('Application credential created', {
      applicationId: application.id,
      credentialId: credential.id,
      type: credential.type,
      by: requireUserId(req),
    });

    res.status(201).json({
      credential: serializeCredential(credential),
      secret: isPublicClient ? null : secret,
    });
  })
);

/**
 * Rotate a credential — zero-downtime. Mints a replacement (fresh keys) then
 * deprecates the previous one with a 7-day grace `expiresAt`. The new plaintext
 * `secret` is returned EXACTLY ONCE.
 *
 * Both writes run in ONE transaction: a mint that landed without its matching
 * deprecation would leave two live credentials for the same client, which is
 * exactly the state the grace window exists to avoid.
 */
router.post(
  '/:appId/credentials/:credId/rotate',
  validate({ params: appCredentialParams }),
  requireAppPermission('credentials:rotate'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    const { publicKey, secret, secretHash } = generateCredentialMaterial();
    const graceExpiresAt = new Date(Date.now() + CREDENTIAL_ROTATION_GRACE_MS);

    const { previousId, rotated } = await getDb().transaction(async (tx) => {
      const [previous] = await tx
        .select(CREDENTIAL_COLUMNS)
        .from(applicationCredentials)
        .where(
          and(
            eq(applicationCredentials.id, req.params.credId),
            eq(applicationCredentials.applicationId, application.id),
            ne(applicationCredentials.status, 'revoked')
          )
        )
        .limit(1);
      if (!previous) {
        throw new NotFoundError('Credential not found');
      }
      if (previous.type === 'public') {
        throw new BadRequestError('Public credentials do not have a rotatable secret');
      }

      const [minted] = await tx
        .insert(applicationCredentials)
        .values({
          applicationId: application.id,
          name: previous.name,
          publicKey,
          secretHash,
          type: previous.type,
          environment: previous.environment,
          scopes: previous.scopes,
          status: 'active',
          rotatedFromCredentialId: previous.id,
          createdByUserId: requireUserId(req),
        })
        .returning(CREDENTIAL_COLUMNS);

      await tx
        .update(applicationCredentials)
        .set({ status: 'deprecated', expiresAt: graceExpiresAt })
        .where(eq(applicationCredentials.id, previous.id));

      return { previousId: previous.id, rotated: minted };
    });

    logger.info('Application credential rotated', {
      applicationId: application.id,
      previousCredentialId: previousId,
      newCredentialId: rotated.id,
      graceExpiresAt: graceExpiresAt.toISOString(),
      by: requireUserId(req),
    });

    res.json({
      credential: serializeCredential(rotated),
      secret,
      rotatedFrom: previousId,
      graceExpiresAt,
    });
  })
);

/**
 * Revoke a credential. Revoked credentials can no longer authenticate.
 */
router.delete(
  '/:appId/credentials/:credId',
  validate({ params: appCredentialParams }),
  requireAppPermission('credentials:revoke'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    // One statement, and its RESULT decides the outcome: a credential that does
    // not belong to this application updates no row and is a 404.
    const [credential] = await getDb()
      .update(applicationCredentials)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(applicationCredentials.id, req.params.credId),
          eq(applicationCredentials.applicationId, application.id)
        )
      )
      .returning({ id: applicationCredentials.id });
    if (!credential) {
      throw new NotFoundError('Credential not found');
    }

    logger.info('Application credential revoked', {
      applicationId: application.id,
      credentialId: credential.id,
      by: requireUserId(req),
    });

    res.json({ success: true });
  })
);

// ============================================================================
// Usage
// ============================================================================

/**
 * Per-application usage statistics over the requested window (`24h`, `7d`,
 * `30d`, `90d`; defaults to `7d`).
 */
router.get(
  '/:appId/usage',
  validate({ params: appIdRouteParams, query: periodQuerySchema }),
  requireAppPermission('usage:read'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    const period = (req.query.period as string) || '7d';
    res.json(await getUsageStats(application.id, getStartDate(period)));
  })
);

// ============================================================================
// Store listing
//
// The publisher's side of the app store hangs off the application, beside
// credentials, webhooks and usage, because that is what it is: one more thing
// an app has, edited by whoever may edit the app. It reuses
// `requireAppPermission` wholesale — a store page must not become a second,
// weaker way to act for somebody's application.
//
// The storefront that READS these pages is `/store`, and knows nothing about
// applications the caller may administer.
// ============================================================================

/** The application's listing in whatever state, or null when it has none. */
router.get(
  '/:appId/listing',
  validate({ params: appIdRouteParams }),
  requireAppPermission('app:read'),
  asyncHandler(async (req: AppContextRequest, res) => {
    res.json(await getListingForApplication(requireApplication(req).id));
  })
);

/**
 * Create the listing or replace its content. Never its status: publishing is
 * the store's decision and has its own routes.
 */
router.put(
  '/:appId/listing',
  validate({ params: appIdRouteParams, body: storeListingBody }),
  requireAppPermission('app:update'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const body = req.body as {
      slug: string;
      tagline?: string | null;
      description?: string | null;
      categorySlug?: string | null;
      supportUrl?: string | null;
      supportEmail?: string | null;
    };
    res.json(await upsertListing({ applicationId: requireApplication(req).id, ...body }));
  })
);

/** Hand the page to the store for review. */
router.post(
  '/:appId/listing/submit',
  validate({ params: appIdRouteParams }),
  requireAppPermission('app:update'),
  asyncHandler(async (req: AppContextRequest, res) => {
    res.json(await submitListing(requireApplication(req).id));
  })
);

/** Take it down, or withdraw it from the queue. Back to a draft, never deleted. */
router.post(
  '/:appId/listing/unpublish',
  validate({ params: appIdRouteParams }),
  requireAppPermission('app:update'),
  asyncHandler(async (req: AppContextRequest, res) => {
    res.json(await unpublishListing(requireApplication(req).id));
  })
);

export default router;
