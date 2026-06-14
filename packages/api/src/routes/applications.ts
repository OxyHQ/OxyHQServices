import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Application, IApplication, APPLICATION_SCOPES } from '../models/Application';
import { ApplicationMember, IApplicationMember } from '../models/ApplicationMember';
import {
  ApplicationCredential,
  IApplicationCredential,
} from '../models/ApplicationCredential';
import ApiKeyUsage from '../models/ApiKeyUsage';
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
import {
  permissionsForRole,
  type ApplicationPermission,
  type ApplicationRole,
} from '../utils/applicationRoles';
import {
  appIdRouteParams,
  appMemberParams,
  appCredentialParams,
  periodQuerySchema,
  createApplicationSchema,
  updateApplicationSchema,
  inviteMemberSchema,
  updateMemberSchema,
  transferOwnershipSchema,
  createCredentialSchema,
} from '../schemas/application.schemas';

/**
 * Request decorated by `loadApplicationContext` / `requireAppPermission` with
 * the resolved application and the caller's active membership row. Handlers
 * downstream can rely on both being present.
 */
interface AppContextRequest extends AuthRequest {
  application?: IApplication;
  membership?: IApplicationMember;
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

const router = express.Router();

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
 * Serialise an application for client responses (no webhook secret).
 *
 * When the caller's own membership is supplied it is embedded as
 * `callerMembership` so roles that lack `members:read` (developer, billing) can
 * still discover their own permission set, and the Console can gate UI on
 * `application.callerMembership.permissions`.
 */
function serializeApplication(app: IApplication, callerMembership?: IApplicationMember | null) {
  return {
    _id: app._id.toString(),
    name: app.name,
    description: app.description,
    websiteUrl: app.websiteUrl,
    icon: app.icon,
    type: app.type,
    status: app.status,
    isOfficial: app.isOfficial,
    isInternal: app.isInternal,
    capabilities: app.capabilities ?? [],
    redirectUris: app.redirectUris ?? [],
    scopes: app.scopes ?? [],
    webhookUrl: app.webhookUrl,
    devWebhookUrl: app.devWebhookUrl,
    createdByUserId: app.createdByUserId.toString(),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    callerMembership: callerMembership ? serializeMember(callerMembership) : null,
  };
}

/** Serialise a membership for client responses. */
function serializeMember(member: IApplicationMember) {
  return {
    _id: member._id.toString(),
    applicationId: member.applicationId.toString(),
    userId: member.userId.toString(),
    role: member.role,
    permissions: member.permissions,
    invitedByUserId: member.invitedByUserId?.toString(),
    joinedAt: member.joinedAt,
    status: member.status,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

/** Serialise a credential for client responses — NEVER includes the secret hash. */
function serializeCredential(credential: IApplicationCredential) {
  return {
    _id: credential._id.toString(),
    applicationId: credential.applicationId.toString(),
    name: credential.name,
    publicKey: credential.publicKey,
    type: credential.type,
    environment: credential.environment,
    scopes: credential.scopes,
    status: credential.status,
    lastUsedAt: credential.lastUsedAt,
    expiresAt: credential.expiresAt,
    rotatedFromCredentialId: credential.rotatedFromCredentialId
      ? credential.rotatedFromCredentialId.toString()
      : undefined,
    createdByUserId: credential.createdByUserId.toString(),
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

/** Aggregate usage statistics for the supplied match filter. */
async function getUsageStats(matchFilter: Record<string, unknown>) {
  const [usage] = await ApiKeyUsage.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        totalTokens: { $sum: '$tokensUsed' },
        totalCredits: { $sum: '$creditsUsed' },
        avgResponseTime: { $avg: '$responseTime' },
        successfulRequests: { $sum: { $cond: [{ $lt: ['$statusCode', 400] }, 1, 0] } },
        errorRequests: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
      },
    },
  ]);

  const byDay = await ApiKeyUsage.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        requests: { $sum: 1 },
        tokens: { $sum: '$tokensUsed' },
        credits: { $sum: '$creditsUsed' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const byEndpoint = await ApiKeyUsage.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$endpoint',
        requests: { $sum: 1 },
        tokens: { $sum: '$tokensUsed' },
      },
    },
    { $sort: { requests: -1 } },
    { $limit: 10 },
  ]);

  return {
    summary: usage || {
      totalRequests: 0,
      totalTokens: 0,
      totalCredits: 0,
      avgResponseTime: 0,
      successfulRequests: 0,
      errorRequests: 0,
    },
    byDay,
    byEndpoint,
  };
}

/** Generate a fresh credential public key + plaintext secret + its hash. */
function generateCredentialMaterial(): { publicKey: string; secret: string; secretHash: string } {
  const publicKey =
    CREDENTIAL_PUBLIC_KEY_PREFIX + crypto.randomBytes(PUBLIC_KEY_RANDOM_BYTES).toString('hex');
  const secret = crypto.randomBytes(SECRET_RANDOM_BYTES).toString('hex');
  const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
  return { publicKey, secret, secretHash };
}

/**
 * Resolve the application (non-deleted) and the caller's active membership for
 * `:appId`. Returns 404 when the app is missing/deleted and 403 when the caller
 * is not an active member. Attaches both to the request.
 */
async function loadApplicationContext(req: AppContextRequest): Promise<{
  application: IApplication;
  membership: IApplicationMember;
}> {
  const userId = requireUserId(req);
  const appId = req.params.appId;

  if (!mongoose.isValidObjectId(appId)) {
    throw new NotFoundError('Application not found');
  }

  const application = await Application.findOne({
    _id: appId,
    status: { $ne: 'deleted' },
  });
  if (!application) {
    throw new NotFoundError('Application not found');
  }

  const membership = await ApplicationMember.findOne({
    applicationId: application._id,
    userId,
    status: 'active',
  });
  if (!membership) {
    throw new ForbiddenError('You are not a member of this application');
  }

  req.application = application;
  req.membership = membership;
  return { application, membership };
}

/**
 * RBAC middleware factory. Resolves the application + caller's active membership
 * for `:appId`, then enforces that the membership carries `permission`.
 */
function requireAppPermission(permission: ApplicationPermission) {
  return asyncHandler(async (req: AppContextRequest, _res, next) => {
    const { membership } = await loadApplicationContext(req);
    if (!membership.permissions.includes(permission)) {
      throw new ForbiddenError(`Missing required permission: ${permission}`);
    }
    next();
  });
}

// ============================================================================
// Applications — CRUD
// ============================================================================

/**
 * List applications the caller is an active member of.
 */
router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = requireUserId(req);

    const memberships = await ApplicationMember.find({ userId, status: 'active' });
    const membershipByAppId = new Map<string, IApplicationMember>();
    for (const membership of memberships) {
      membershipByAppId.set(membership.applicationId.toString(), membership);
    }

    const applications = await Application.find({
      _id: { $in: memberships.map((m) => m.applicationId) },
      status: { $ne: 'deleted' },
    }).sort({ createdAt: -1 });

    res.json({
      applications: applications.map((app) =>
        serializeApplication(app, membershipByAppId.get(app._id.toString()))
      ),
    });
  })
);

/**
 * Create a new application. The creator is automatically added as an active
 * `owner` member. Staff-only fields default and are not settable here.
 */
router.post(
  '/',
  validate({ body: createApplicationSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = requireUserId(req);
    const body = req.body as {
      name: string;
      description?: string;
      websiteUrl?: string;
      icon?: string;
      redirectUris?: string[];
      scopes?: typeof APPLICATION_SCOPES[number][];
    };

    const application = await Application.create({
      name: body.name,
      description: body.description,
      websiteUrl: body.websiteUrl || undefined,
      icon: body.icon,
      redirectUris: resolveRedirectUris(body) ?? [],
      scopes: body.scopes ?? [],
      createdByUserId: new mongoose.Types.ObjectId(userId),
    });

    await ApplicationMember.create({
      applicationId: application._id,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'owner',
      permissions: permissionsForRole('owner'),
      status: 'active',
      joinedAt: new Date(),
    });

    logger.info('Application created', {
      userId,
      applicationId: application._id.toString(),
      name: application.name,
    });

    res.status(201).json({ application: serializeApplication(application) });
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
    res.json({ application: serializeApplication(application, req.membership) });
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
    const application = req.application;
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    const body = req.body as {
      name?: string;
      description?: string;
      websiteUrl?: string;
      icon?: string;
      redirectUris?: string[];
      scopes?: typeof APPLICATION_SCOPES[number][];
      webhookUrl?: string;
      devWebhookUrl?: string | null;
      status?: 'active' | 'suspended' | 'pending_review';
      type?: IApplication['type'];
      isOfficial?: boolean;
      isInternal?: boolean;
      capabilities?: string[];
    };

    if (body.name !== undefined) application.name = body.name;
    if (body.description !== undefined) application.description = body.description;
    if (body.websiteUrl !== undefined) application.websiteUrl = body.websiteUrl || undefined;
    if (body.icon !== undefined) application.icon = body.icon;
    if (body.scopes !== undefined) application.scopes = body.scopes;
    if (body.status !== undefined) application.status = body.status;
    if (body.devWebhookUrl !== undefined) {
      application.devWebhookUrl = body.devWebhookUrl || undefined;
    }

    const resolvedRedirectUris = resolveRedirectUris(body);
    if (resolvedRedirectUris !== undefined) {
      application.redirectUris = resolvedRedirectUris;
    }

    // Rotate the webhook secret whenever the webhook URL changes.
    if (body.webhookUrl !== undefined && body.webhookUrl !== application.webhookUrl) {
      application.webhookUrl = body.webhookUrl || undefined;
      application.webhookSecret = body.webhookUrl
        ? crypto.randomBytes(WEBHOOK_SECRET_RANDOM_BYTES).toString('hex')
        : undefined;
    }

    // Staff-only fields — applied only for platform staff, silently dropped otherwise.
    if (isStaffUser(req)) {
      if (body.type !== undefined) application.type = body.type;
      if (body.isOfficial !== undefined) application.isOfficial = body.isOfficial;
      if (body.isInternal !== undefined) application.isInternal = body.isInternal;
      if (body.capabilities !== undefined) application.capabilities = body.capabilities;
    }

    await application.save();

    logger.info('Application updated', {
      userId: requireUserId(req),
      applicationId: application._id.toString(),
    });

    res.json({ application: serializeApplication(application) });
  })
);

/**
 * Soft-delete an application (owner only).
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

    application.status = 'deleted';
    await application.save();

    logger.info('Application deleted', {
      userId: requireUserId(req),
      applicationId: application._id.toString(),
    });

    res.json({ success: true });
  })
);

// ============================================================================
// Members
// ============================================================================

/**
 * List members of an application.
 */
router.get(
  '/:appId/members',
  validate({ params: appIdRouteParams }),
  requireAppPermission('members:read'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    const members = await ApplicationMember.find({
      applicationId: application._id,
      status: { $ne: 'removed' },
    }).sort({ createdAt: 1 });

    res.json({ members: members.map(serializeMember) });
  })
);

/**
 * Add a member to an application (role != owner). Re-activates a previously
 * removed membership instead of creating a duplicate.
 */
router.post(
  '/:appId/members',
  validate({ params: appIdRouteParams, body: inviteMemberSchema }),
  requireAppPermission('members:invite'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    const { userId: targetUserId, role } = req.body as { userId: string; role: ApplicationRole };
    if (!mongoose.isValidObjectId(targetUserId)) {
      throw new BadRequestError('Invalid userId');
    }

    const callerUserId = requireUserId(req);
    const targetUserObjectId = new mongoose.Types.ObjectId(targetUserId);

    const existing = await ApplicationMember.findOne({
      applicationId: application._id,
      userId: targetUserObjectId,
    });

    if (existing && existing.status === 'active') {
      throw new BadRequestError('User is already a member of this application');
    }

    const permissions = permissionsForRole(role);

    let member: IApplicationMember;
    if (existing) {
      existing.role = role;
      existing.permissions = permissions;
      existing.status = 'active';
      existing.invitedByUserId = new mongoose.Types.ObjectId(callerUserId);
      existing.joinedAt = new Date();
      member = await existing.save();
    } else {
      member = await ApplicationMember.create({
        applicationId: application._id,
        userId: targetUserObjectId,
        role,
        permissions,
        status: 'active',
        invitedByUserId: new mongoose.Types.ObjectId(callerUserId),
        joinedAt: new Date(),
      });
    }

    logger.info('Application member added', {
      applicationId: application._id.toString(),
      memberId: member._id.toString(),
      role,
      by: callerUserId,
    });

    res.status(201).json({ member: serializeMember(member) });
  })
);

/**
 * Change a member's role. An owner's role can only be changed via
 * transfer-ownership; only an owner may modify another owner.
 */
router.patch(
  '/:appId/members/:memberId',
  validate({ params: appMemberParams, body: updateMemberSchema }),
  requireAppPermission('members:update'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    const callerMembership = req.membership;
    if (!application || !callerMembership) {
      throw new NotFoundError('Application not found');
    }

    if (!mongoose.isValidObjectId(req.params.memberId)) {
      throw new NotFoundError('Member not found');
    }

    const member = await ApplicationMember.findOne({
      _id: req.params.memberId,
      applicationId: application._id,
      status: { $ne: 'removed' },
    });
    if (!member) {
      throw new NotFoundError('Member not found');
    }

    if (member.role === 'owner') {
      throw new ForbiddenError(
        "An owner's role can only be changed via transfer-ownership"
      );
    }

    const { role } = req.body as { role: ApplicationRole };
    member.role = role;
    member.permissions = permissionsForRole(role);
    await member.save();

    logger.info('Application member role updated', {
      applicationId: application._id.toString(),
      memberId: member._id.toString(),
      role,
      by: requireUserId(req),
    });

    res.json({ member: serializeMember(member) });
  })
);

/**
 * Remove a member. The last owner cannot be removed; an owner can only be
 * removed by another owner.
 */
router.delete(
  '/:appId/members/:memberId',
  validate({ params: appMemberParams }),
  requireAppPermission('members:remove'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    const callerMembership = req.membership;
    if (!application || !callerMembership) {
      throw new NotFoundError('Application not found');
    }

    if (!mongoose.isValidObjectId(req.params.memberId)) {
      throw new NotFoundError('Member not found');
    }

    const member = await ApplicationMember.findOne({
      _id: req.params.memberId,
      applicationId: application._id,
      status: { $ne: 'removed' },
    });
    if (!member) {
      throw new NotFoundError('Member not found');
    }

    if (member.role === 'owner') {
      if (callerMembership.role !== 'owner') {
        throw new ForbiddenError('Only an owner may remove another owner');
      }
      const ownerCount = await ApplicationMember.countDocuments({
        applicationId: application._id,
        role: 'owner',
        status: 'active',
      });
      if (ownerCount <= 1) {
        throw new BadRequestError('Cannot remove the last owner of an application');
      }
    }

    member.status = 'removed';
    await member.save();

    logger.info('Application member removed', {
      applicationId: application._id.toString(),
      memberId: member._id.toString(),
      by: requireUserId(req),
    });

    res.json({ success: true });
  })
);

/**
 * Transfer ownership to another active member (owner only). The current owner
 * is demoted to `admin`; the target is promoted to `owner`.
 */
router.post(
  '/:appId/transfer-ownership',
  validate({ params: appIdRouteParams, body: transferOwnershipSchema }),
  requireAppPermission('ownership:transfer'),
  asyncHandler(async (req: AppContextRequest, res) => {
    const application = req.application;
    const callerMembership = req.membership;
    if (!application || !callerMembership) {
      throw new NotFoundError('Application not found');
    }

    const { userId: targetUserId } = req.body as { userId: string };
    if (!mongoose.isValidObjectId(targetUserId)) {
      throw new BadRequestError('Invalid userId');
    }

    const targetMember = await ApplicationMember.findOne({
      applicationId: application._id,
      userId: new mongoose.Types.ObjectId(targetUserId),
      status: 'active',
    });
    if (!targetMember) {
      throw new NotFoundError('Target user is not an active member of this application');
    }

    if (targetMember._id.equals(callerMembership._id)) {
      throw new BadRequestError('You already own this application');
    }

    targetMember.role = 'owner';
    targetMember.permissions = permissionsForRole('owner');

    callerMembership.role = 'admin';
    callerMembership.permissions = permissionsForRole('admin');

    await targetMember.save();
    await callerMembership.save();

    logger.info('Application ownership transferred', {
      applicationId: application._id.toString(),
      from: requireUserId(req),
      to: targetUserId,
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

    const credentials = await ApplicationCredential.find({
      applicationId: application._id,
    })
      .select('-secretHash')
      .sort({ createdAt: -1 });

    res.json({ credentials: credentials.map(serializeCredential) });
  })
);

/**
 * Create a credential.
 *
 * The plaintext `secret` is returned in the response body EXACTLY ONCE and can
 * never be retrieved again — only its SHA-256 hash is persisted. Store it
 * immediately; if lost, rotate the credential to obtain a fresh secret.
 * `public` credentials carry no secret (the `secret` field is `null`).
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
      type: IApplicationCredential['type'];
      environment: IApplicationCredential['environment'];
      scopes?: string[];
    };

    const { publicKey, secret, secretHash } = generateCredentialMaterial();
    const isPublicClient = body.type === 'public';

    const credential = await ApplicationCredential.create({
      applicationId: application._id,
      name: body.name,
      publicKey,
      secretHash: isPublicClient ? undefined : secretHash,
      type: body.type,
      environment: body.environment,
      scopes: body.scopes ?? [],
      status: 'active',
      createdByUserId: new mongoose.Types.ObjectId(requireUserId(req)),
    });

    logger.info('Application credential created', {
      applicationId: application._id.toString(),
      credentialId: credential._id.toString(),
      type: credential.type,
      by: requireUserId(req),
    });

    res.status(201).json({
      credential: serializeCredential(credential),
      // Public clients have no secret; only confidential/service credentials do.
      secret: isPublicClient ? null : secret,
    });
  })
);

/**
 * Rotate a credential — zero-downtime.
 *
 * Rotation does NOT overwrite the existing secret in place. Instead it issues a
 * brand-new credential (fresh `publicKey` + `secret`) that inherits the source
 * credential's `name`, `type`, `environment`, and `scopes`, and links back via
 * `rotatedFromCredentialId`. The previous credential is marked `deprecated` and
 * given an `expiresAt` `CREDENTIAL_ROTATION_GRACE_MS` (7 days) in the future, so
 * it keeps authenticating until then — callers can roll out the new secret with
 * no downtime. Once the grace window elapses (or the old credential is revoked),
 * the previous secret stops working.
 *
 * The new plaintext `secret` is returned EXACTLY ONCE and cannot be retrieved
 * again — only its hash is stored.
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

    if (!mongoose.isValidObjectId(req.params.credId)) {
      throw new NotFoundError('Credential not found');
    }

    const previous = await ApplicationCredential.findOne({
      _id: req.params.credId,
      applicationId: application._id,
      status: { $ne: 'revoked' },
    });
    if (!previous) {
      throw new NotFoundError('Credential not found');
    }

    if (previous.type === 'public') {
      throw new BadRequestError('Public credentials do not have a rotatable secret');
    }

    const { publicKey, secret, secretHash } = generateCredentialMaterial();

    // Mint the replacement credential first; only then deprecate the old one so
    // a failure mid-rotation never leaves the application without a usable
    // credential during the grace window.
    const rotated = await ApplicationCredential.create({
      applicationId: application._id,
      name: previous.name,
      publicKey,
      secretHash,
      type: previous.type,
      environment: previous.environment,
      scopes: previous.scopes,
      status: 'active',
      rotatedFromCredentialId: previous._id,
      createdByUserId: new mongoose.Types.ObjectId(requireUserId(req)),
    });

    const graceExpiresAt = new Date(Date.now() + CREDENTIAL_ROTATION_GRACE_MS);
    previous.status = 'deprecated';
    previous.expiresAt = graceExpiresAt;
    await previous.save();

    logger.info('Application credential rotated', {
      applicationId: application._id.toString(),
      previousCredentialId: previous._id.toString(),
      newCredentialId: rotated._id.toString(),
      graceExpiresAt: graceExpiresAt.toISOString(),
      by: requireUserId(req),
    });

    res.json({
      credential: serializeCredential(rotated),
      secret,
      rotatedFrom: previous._id.toString(),
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

    if (!mongoose.isValidObjectId(req.params.credId)) {
      throw new NotFoundError('Credential not found');
    }

    const credential = await ApplicationCredential.findOne({
      _id: req.params.credId,
      applicationId: application._id,
    });
    if (!credential) {
      throw new NotFoundError('Credential not found');
    }

    credential.status = 'revoked';
    await credential.save();

    logger.info('Application credential revoked', {
      applicationId: application._id.toString(),
      credentialId: credential._id.toString(),
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
    const startDate = getStartDate(period);

    const stats = await getUsageStats({
      appId: application._id,
      timestamp: { $gte: startDate },
    });

    res.json(stats);
  })
);

export default router;
