import express, { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import {
  authMiddleware,
  serviceAuthMiddleware,
  type AuthRequest,
  type ServiceAuthRequest,
} from '../middleware/auth';
import { requireStaff } from '../middleware/requireStaff';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler, sendSuccess, sendPaginated } from '../utils/asyncHandler';
import { ForbiddenError, UnauthorizedError } from '../utils/error';
import { resolveUserIdToObjectId, validatePagination } from '../utils/validation';
import { logger } from '../utils/logger';
import reputationService, { type InfluenceContext } from '../services/reputation.service';
import {
  DEFAULT_TRANSACTION_LIMIT,
  MAX_TRANSACTION_LIMIT,
  DEFAULT_LEADERBOARD_LIMIT,
  MAX_LEADERBOARD_LIMIT,
  DEFAULT_DISPUTE_LIMIT,
  MAX_DISPUTE_LIMIT,
} from '../utils/reputation.constants';
import {
  reputationUserIdParams,
  reputationTransactionIdParams,
  reputationDisputeIdParams,
  reputationPaginationQuery,
  reputationInfluenceQuery,
  awardReputationSchema,
  reviewTransactionSchema,
  upsertReputationRuleSchema,
  createDisputeSchema,
  resolveDisputeSchema,
} from '../schemas/reputation.schemas';

const router = express.Router();

const WINDOW_15_MIN = 15 * 60 * 1000;
const WINDOW_1_MIN = 60 * 1000;
const REQUIRED_AWARD_SCOPE = 'reputation:write';

/** Read limiter for public/auth read endpoints. */
const readLimiter = rateLimit({
  prefix: 'rl:reputation:read:',
  windowMs: WINDOW_15_MIN,
  max: 300,
});

/** Award limiter — service tokens / staff award reputation. */
const awardLimiter = rateLimit({
  prefix: 'rl:reputation:award:',
  windowMs: WINDOW_1_MIN,
  max: 120,
});

/** Mutating staff actions (reverse/void/recalculate/resolve/rules). */
const adminLimiter = rateLimit({
  prefix: 'rl:reputation:admin:',
  windowMs: WINDOW_15_MIN,
  max: 200,
});

/** Dispute creation limiter (per authenticated user). */
const disputeLimiter = rateLimit({
  prefix: 'rl:reputation:dispute:',
  windowMs: WINDOW_15_MIN,
  max: 30,
});

/**
 * A request that may carry EITHER an authenticated user (`req.user`) or a
 * service principal (`req.serviceApp`). Used by `/award`.
 */
interface UserOrServiceRequest extends AuthRequest, ServiceAuthRequest {}

/**
 * Accept either a user session token or a service token. Peeks at the verified
 * token's `type` claim and dispatches to the matching middleware. A `service`
 * token resolves `req.serviceApp`; anything else falls through to the regular
 * user `authMiddleware`.
 */
function requireReputationWriteScope(req: ServiceAuthRequest): void {
  const scopes = req.serviceApp?.scopes ?? [];
  if (!scopes.includes(REQUIRED_AWARD_SCOPE)) {
    throw new ForbiddenError(`Missing required scope: ${REQUIRED_AWARD_SCOPE}`);
  }
}

function authUserOrService(
  req: UserOrServiceRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Invalid or missing authorization header'));
    return;
  }
  const token = authHeader.slice('Bearer '.length);
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) {
    logger.error('ACCESS_TOKEN_SECRET not configured');
    res.status(500).json({ error: 'Server configuration error', message: 'Server configuration error' });
    return;
  }
  let isServiceToken = false;
  try {
    const decoded = jwt.verify(token, secret) as { type?: string };
    isServiceToken = decoded.type === 'service';
  } catch {
    // Defer to the dispatched middleware to produce the precise 401 (expired vs
    // invalid). Treat an unverifiable token as a user token here.
    isServiceToken = false;
  }
  if (isServiceToken) {
    serviceAuthMiddleware(req, res, next);
    return;
  }
  authMiddleware(req, res, next);
}

/**
 * Shape a transaction for the HTTP response. Ids are emitted as strings.
 */
function serializeTransaction(
  txn: Awaited<ReturnType<typeof reputationService.listTransactions>>['items'][number]
): Record<string, unknown> {
  return {
    id: txn._id.toString(),
    userId: txn.userId.toString(),
    points: txn.points,
    actionType: txn.actionType,
    category: txn.category,
    applicationId: txn.applicationId?.toString(),
    credentialId: txn.credentialId?.toString(),
    sourceActionId: txn.sourceActionId,
    sourceActionType: txn.sourceActionType,
    targetEntityId: txn.targetEntityId,
    targetEntityType: txn.targetEntityType,
    status: txn.status,
    reversedTransactionId: txn.reversedTransactionId?.toString(),
    reason: txn.reason,
    metadata: txn.metadata,
    createdByUserId: txn.createdByUserId?.toString(),
    reviewedByUserId: txn.reviewedByUserId?.toString(),
    reviewedAt: txn.reviewedAt,
    createdAt: txn.createdAt,
    updatedAt: txn.updatedAt,
  };
}

/** Shape a balance for the HTTP response. */
function serializeBalance(
  balance: Awaited<ReturnType<typeof reputationService.getBalance>>
): Record<string, unknown> {
  return {
    userId: balance.userId.toString(),
    total: balance.total,
    positive: balance.positive,
    negative: balance.negative,
    breakdown: balance.breakdown,
    trustTier: balance.trustTier,
    influence: balance.influence,
    reliability: balance.reliability,
    recalculatedAt: balance.recalculatedAt,
    updatedAt: balance.updatedAt,
  };
}

/** Shape a dispute for the HTTP response. */
function serializeDispute(
  dispute: Awaited<ReturnType<typeof reputationService.createDispute>>
): Record<string, unknown> {
  return {
    id: dispute._id.toString(),
    transactionId: dispute.transactionId.toString(),
    userId: dispute.userId.toString(),
    reason: dispute.reason,
    status: dispute.status,
    evidence: dispute.evidence,
    resolvedAt: dispute.resolvedAt,
    resolvedByUserId: dispute.resolvedByUserId?.toString(),
    createdAt: dispute.createdAt,
    updatedAt: dispute.updatedAt,
  };
}

/** Shape a rule for the HTTP response. */
function serializeRule(
  rule: Awaited<ReturnType<typeof reputationService.upsertRule>>
): Record<string, unknown> {
  return {
    id: rule._id.toString(),
    actionType: rule.actionType,
    points: rule.points,
    category: rule.category,
    description: rule.description,
    cooldownInMinutes: rule.cooldownInMinutes,
    isEnabled: rule.isEnabled,
  };
}

// =============================================================================
// PUBLIC ROUTES (no auth)
// =============================================================================

/** GET /reputation/leaderboard — top users by lifetime total. */
router.get(
  '/leaderboard',
  readLimiter,
  validate({ query: reputationPaginationQuery }),
  asyncHandler(async (req, res) => {
    const { limit, offset } = validatePagination(
      req.query.limit,
      req.query.offset,
      MAX_LEADERBOARD_LIMIT,
      DEFAULT_LEADERBOARD_LIMIT
    );
    const { items, total } = await reputationService.getLeaderboard(limit, offset);
    const formatted = items.map((balance, index) => ({
      user: balance.userId,
      total: balance.total,
      trustTier: balance.trustTier,
      rank: offset + index + 1,
    }));
    sendPaginated(res, formatted, total, limit, offset);
  })
);

/** GET /reputation/rules — enabled rules (for client display). */
router.get(
  '/rules',
  readLimiter,
  asyncHandler(async (_req, res) => {
    const rules = await reputationService.listEnabledRules();
    sendSuccess(res, { rules: rules.map(serializeRule) });
  })
);

/** GET /reputation/:userId/balance — derived totals + tier + influence. */
router.get(
  '/:userId/balance',
  readLimiter,
  validate({ params: reputationUserIdParams }),
  asyncHandler(async (req, res) => {
    const userObjectId = await resolveUserIdToObjectId(req.params.userId);
    const balance = await reputationService.getBalance(userObjectId);
    sendSuccess(res, serializeBalance(balance));
  })
);

// =============================================================================
// STAFF-ONLY RULE WRITE (auth + staff)
// =============================================================================

/** POST /reputation/rules — upsert a rule (staff only). */
router.post(
  '/rules',
  adminLimiter,
  authMiddleware,
  requireStaff,
  validate({ body: upsertReputationRuleSchema }),
  asyncHandler(async (req, res) => {
    const rule = await reputationService.upsertRule(req.body);
    sendSuccess(res, { rule: serializeRule(rule) });
  })
);

// =============================================================================
// AWARD (service token OR staff)
// =============================================================================

/**
 * POST /reputation/award.
 *
 * Awarding is restricted to service tokens with the privileged
 * `reputation:write` scope (the canonical path — a source app reports an
 * action) and platform staff. Regular users may NOT award reputation
 * (no self-award). When called with a service token the `applicationId` /
 * `credentialId` are resolved from `req.serviceApp` and any client-supplied
 * values for those fields are ignored.
 */
router.post(
  '/award',
  awardLimiter,
  authUserOrService,
  validate({ body: awardReputationSchema }),
  asyncHandler(async (req: UserOrServiceRequest, res) => {
    const serviceApp = req.serviceApp;
    const user = req.user;

    let applicationId: string | undefined = req.body.applicationId;
    let credentialId: string | undefined = req.body.credentialId;
    let createdByUserId: string | undefined;

    if (serviceApp) {
      requireReputationWriteScope(req);

      // Canonical service path — source app identity is the token's, not the
      // client body's.
      applicationId = serviceApp.appId;
      credentialId = serviceApp.credentialId;
    } else if (user?.isStaff === true) {
      createdByUserId = user._id?.toString();
    } else {
      throw new ForbiddenError('Awarding reputation requires a service token or staff privileges');
    }

    const subjectObjectId = await resolveUserIdToObjectId(req.body.userId);

    const txn = await reputationService.award({
      userId: subjectObjectId,
      actionType: req.body.actionType,
      applicationId,
      credentialId,
      sourceActionId: req.body.sourceActionId,
      sourceActionType: req.body.sourceActionType,
      targetEntityId: req.body.targetEntityId,
      targetEntityType: req.body.targetEntityType,
      reason: req.body.reason,
      createdByUserId,
      metadata: req.body.metadata,
    });

    sendSuccess(res, { transaction: serializeTransaction(txn) }, 201);
  })
);

// =============================================================================
// AUTHENTICATED USER ROUTES
// =============================================================================

router.use(authMiddleware);

/** Resolve the authenticated user id, or throw 401. */
function requireUserId(req: AuthRequest): string {
  const userId = req.user?._id?.toString();
  if (!userId) {
    throw new UnauthorizedError('Authentication required');
  }
  return userId;
}

/** GET /reputation/:userId/transactions — paginated ledger (auth). */
router.get(
  '/:userId/transactions',
  readLimiter,
  validate({ params: reputationUserIdParams, query: reputationPaginationQuery }),
  asyncHandler(async (req, res) => {
    const userObjectId = await resolveUserIdToObjectId(req.params.userId);
    const { limit, offset } = validatePagination(
      req.query.limit,
      req.query.offset,
      MAX_TRANSACTION_LIMIT,
      DEFAULT_TRANSACTION_LIMIT
    );
    const { items, total } = await reputationService.listTransactions(
      userObjectId,
      limit,
      offset
    );
    sendPaginated(res, items.map(serializeTransaction), total, limit, offset);
  })
);

/** GET /reputation/:userId/influence — capped weight(s) (auth or service). */
router.get(
  '/:userId/influence',
  readLimiter,
  validate({ params: reputationUserIdParams, query: reputationInfluenceQuery }),
  asyncHandler(async (req, res) => {
    const userObjectId = await resolveUserIdToObjectId(req.params.userId);
    const context = (req.query.context as InfluenceContext | undefined) ?? 'default';
    const result = await reputationService.getInfluence(userObjectId, context);
    sendSuccess(res, result);
  })
);

/** GET /reputation/:userId/disputes — a user's own disputes (auth). */
router.get(
  '/:userId/disputes',
  readLimiter,
  validate({ params: reputationUserIdParams, query: reputationPaginationQuery }),
  asyncHandler(async (req: AuthRequest, res) => {
    const callerId = requireUserId(req);
    const userObjectId = await resolveUserIdToObjectId(req.params.userId);
    if (userObjectId !== callerId && req.user?.isStaff !== true) {
      throw new ForbiddenError('You can only view your own disputes');
    }
    const { limit, offset } = validatePagination(
      req.query.limit,
      req.query.offset,
      MAX_DISPUTE_LIMIT,
      DEFAULT_DISPUTE_LIMIT
    );
    const { items, total } = await reputationService.listDisputesForUser(
      userObjectId,
      limit,
      offset
    );
    sendPaginated(res, items.map(serializeDispute), total, limit, offset);
  })
);

/** POST /reputation/disputes — open a dispute (auth; disputer = req.user). */
router.post(
  '/disputes',
  disputeLimiter,
  validate({ body: createDisputeSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const callerId = requireUserId(req);
    const dispute = await reputationService.createDispute(
      req.body.transactionId,
      callerId,
      req.body.reason,
      req.body.evidence
    );
    sendSuccess(res, { dispute: serializeDispute(dispute) }, 201);
  })
);

/** GET /reputation/disputes — open dispute queue (staff). */
router.get(
  '/disputes',
  readLimiter,
  requireStaff,
  validate({ query: reputationPaginationQuery }),
  asyncHandler(async (req, res) => {
    const { limit, offset } = validatePagination(
      req.query.limit,
      req.query.offset,
      MAX_DISPUTE_LIMIT,
      DEFAULT_DISPUTE_LIMIT
    );
    const { items, total } = await reputationService.listOpenDisputes(limit, offset);
    sendPaginated(res, items.map(serializeDispute), total, limit, offset);
  })
);

// =============================================================================
// STAFF-ONLY MUTATIONS
// =============================================================================

/** POST /reputation/transactions/:id/reverse — reverse a transaction (staff). */
router.post(
  '/transactions/:id/reverse',
  adminLimiter,
  requireStaff,
  validate({ params: reputationTransactionIdParams, body: reviewTransactionSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const reviewedByUserId = requireUserId(req);
    const result = await reputationService.reverseTransaction(req.params.id, {
      reviewedByUserId,
      reason: req.body.reason,
    });
    sendSuccess(res, {
      original: serializeTransaction(result.original),
      reversal: serializeTransaction(result.reversal),
    });
  })
);

/** POST /reputation/transactions/:id/void — void a transaction (staff). */
router.post(
  '/transactions/:id/void',
  adminLimiter,
  requireStaff,
  validate({ params: reputationTransactionIdParams, body: reviewTransactionSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const reviewedByUserId = requireUserId(req);
    const txn = await reputationService.voidTransaction(req.params.id, {
      reviewedByUserId,
      reason: req.body.reason,
    });
    sendSuccess(res, { transaction: serializeTransaction(txn) });
  })
);

/** POST /reputation/:userId/recalculate — force a balance recompute (staff). */
router.post(
  '/:userId/recalculate',
  adminLimiter,
  requireStaff,
  validate({ params: reputationUserIdParams }),
  asyncHandler(async (req, res) => {
    const userObjectId = await resolveUserIdToObjectId(req.params.userId);
    const balance = await reputationService.recalculateBalance(userObjectId);
    sendSuccess(res, serializeBalance(balance));
  })
);

/** POST /reputation/disputes/:id/resolve — resolve a dispute (staff). */
router.post(
  '/disputes/:id/resolve',
  adminLimiter,
  requireStaff,
  validate({ params: reputationDisputeIdParams, body: resolveDisputeSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const resolvedByUserId = requireUserId(req);
    const dispute = await reputationService.resolveDispute(req.params.id, {
      status: req.body.status,
      resolvedByUserId,
    });
    sendSuccess(res, { dispute: serializeDispute(dispute) });
  })
);

export default router;
