import { z } from 'zod';
import {
  REPUTATION_CATEGORIES,
  REPUTATION_TARGET_ENTITY_TYPES,
} from '../utils/reputation.constants';

/** Route params with :userId (ObjectId or publicKey accepted by the route). */
export const reputationUserIdParams = z.object({
  userId: z.string().trim().min(1),
});

/** Route params with :id (transaction id). */
export const reputationTransactionIdParams = z.object({
  id: z.string().trim().min(1),
});

/** Route params with :id (dispute id). */
export const reputationDisputeIdParams = z.object({
  id: z.string().trim().min(1),
});

/** Pagination query (?limit, ?offset). Coerced from string query values. */
export const reputationPaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** GET /reputation/:userId/influence — ?context= selects the weight axis. */
export const reputationInfluenceQuery = z.object({
  context: z.enum(['default', 'report', 'moderation', 'ranking']).optional(),
});

/**
 * POST /reputation/award.
 *
 * `userId` (the subject) is OPTIONAL: a service token resolves it from the
 * request (no implicit self) and staff may target any user. The route enforces
 * who is allowed to award and to whom.
 */
export const awardReputationSchema = z.object({
  userId: z.string().trim().min(1),
  actionType: z.string().trim().min(1),
  applicationId: z.string().trim().min(1).optional(),
  credentialId: z.string().trim().min(1).optional(),
  sourceActionId: z.string().trim().min(1).optional(),
  sourceActionType: z.string().trim().min(1).optional(),
  targetEntityId: z.string().trim().min(1).optional(),
  targetEntityType: z.enum(REPUTATION_TARGET_ENTITY_TYPES).optional(),
  reason: z.string().trim().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** POST /reputation/transactions/:id/reverse | /void. */
export const reviewTransactionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/** POST /reputation/rules — upsert a rule (staff). */
export const upsertReputationRuleSchema = z.object({
  actionType: z.string().trim().min(1),
  points: z.number(),
  category: z.enum(REPUTATION_CATEGORIES),
  description: z.string().trim().min(1).max(500),
  cooldownInMinutes: z.number().int().min(0).default(0),
  isEnabled: z.boolean().default(true),
});

/** POST /reputation/disputes — open a dispute (auth). */
export const createDisputeSchema = z.object({
  transactionId: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(1000),
  evidence: z.array(z.string().trim().min(1)).max(20).optional(),
});

/** POST /reputation/disputes/:id/resolve — staff resolution. */
export const resolveDisputeSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});
