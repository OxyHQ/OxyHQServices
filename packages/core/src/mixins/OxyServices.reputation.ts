/**
 * Reputation Methods Mixin (Oxy Trust)
 *
 * Provides typed access to the reputation ledger (#217) and the derived
 * trust-tier / capped-influence model (#219) via the `/reputation` API.
 *
 * The reputation ledger is append-only: transactions are NEVER deleted.
 * A correction is expressed either as a compensating REVERSAL (the original is
 * marked `reversed` and a new `active` transaction with negated points is
 * appended) or a VOID (the original is marked `voided` and excluded from the
 * balance). A user's `ReputationBalance` is a recomputable cache of the sum of
 * their `active` transactions, augmented with a trust tier, capped influence
 * weights, and reliability signals.
 *
 * Reference users by their Mongo `_id` (or publicKey, which the API resolves),
 * transactions by their `id`, and disputes by their `id`.
 */
import type { OxyServicesBase } from '../OxyServices.base';
import type { User } from '../models/interfaces';
import { CACHE_TIMES } from './mixinHelpers';

// =============================================================================
// UNION TYPES (mirror packages/api/src/utils/reputation.constants.ts)
// =============================================================================

/**
 * Category bucket a reputation transaction falls into. Drives the per-category
 * balance breakdown.
 */
export type ReputationCategory =
  | 'content'
  | 'social'
  | 'trust'
  | 'moderation'
  | 'physical'
  | 'penalty'
  | 'other';

/** Trust tiers, lowest → highest (plus the punitive `restricted`). */
export type TrustTier = 'new' | 'trusted' | 'high_trust' | 'verified' | 'restricted';

/**
 * Transaction lifecycle status. Only `active` transactions count toward the
 * balance; `disputed` still counts until the dispute resolves; `reversed` and
 * `voided` are excluded.
 */
export type ReputationTransactionStatus = 'active' | 'disputed' | 'reversed' | 'voided';

/** Kind of entity a transaction may target. */
export type ReputationTargetEntityType =
  | 'post'
  | 'comment'
  | 'report'
  | 'purchase'
  | 'event'
  | 'check_in'
  | 'manual_review'
  | 'user'
  | 'other';

/** Dispute lifecycle status. */
export type ReputationDisputeStatus = 'open' | 'accepted' | 'rejected' | 'needs_review';

/** Influence context selecting which capped weight axis to return. */
export type ReputationInfluenceContext = 'default' | 'report' | 'moderation' | 'ranking';

// =============================================================================
// ENTITY SHAPES (mirror the server models; ids are strings, dates ISO strings)
// =============================================================================

/**
 * A single immutable entry in the reputation ledger. Ids are emitted as strings
 * and dates as ISO strings by the API.
 */
export interface ReputationTransaction {
  /** The transaction's Mongo `_id` as a string. */
  id: string;
  /** Subject of the reputation change — the user whose balance moves. */
  userId: string;
  /** Signed point delta. Positive awards, negative penalties/reversals. */
  points: number;
  /** The rule/action key that produced this transaction (e.g. `post_created`). */
  actionType: string;
  /** Category bucket the points fall into. */
  category: ReputationCategory;
  /** Canonical source application that reported the action, if any. */
  applicationId?: string;
  /** The specific credential used by the source application, if any. */
  credentialId?: string;
  /** Opaque id of the originating action in the source system (idempotency key). */
  sourceActionId?: string;
  /** Source-system action type (e.g. `report_confirmed`, `event_check_in`). */
  sourceActionType?: string;
  /** Id of the entity the action targeted (post id, report id, etc.). */
  targetEntityId?: string;
  /** Kind of the targeted entity. */
  targetEntityType?: ReputationTargetEntityType;
  /** Lifecycle status — only `active` transactions count toward the balance. */
  status: ReputationTransactionStatus;
  /**
   * Set ONLY on a compensating reversal transaction; references the original
   * transaction it reverses. The original carries `status: 'reversed'`.
   */
  reversedTransactionId?: string;
  /** Human-readable reason / note. */
  reason?: string;
  /** Free-form structured metadata from the source system. */
  metadata?: Record<string, unknown>;
  /** The user who caused this change (the liker, the reporting user, staff). */
  createdByUserId?: string;
  /** Staff/service principal who reviewed (reversed/voided) this transaction. */
  reviewedByUserId?: string;
  /** ISO timestamp the transaction was reviewed at, if reviewed. */
  reviewedAt?: string;
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO last-update timestamp. */
  updatedAt: string;
}

/**
 * Per-category sums of a user's ACTIVE transactions. `penalties` is the
 * absolute sum of every negative-point transaction; the named buckets carry the
 * signed sum of transactions in that category.
 */
export interface ReputationBalanceBreakdown {
  content: number;
  social: number;
  trust: number;
  moderation: number;
  physical: number;
  penalties: number;
}

/**
 * Capped influence weights (#219). Every weight is clamped to a configured
 * range; restricted users are floored on every axis. Downstream systems
 * (ranking, moderation, reporting) consume these to weight a user's
 * contributions without letting any single user dominate.
 */
export interface ReputationInfluence {
  /** General-purpose trust weight derived from the lifetime total. */
  defaultWeight: number;
  /** Weight applied to this user's reports (scales with report accuracy). */
  reportWeight: number;
  /** Weight applied to this user's moderation actions (scales with tier). */
  moderationWeight: number;
  /** Damped weight applied to this user's ranking feedback. */
  rankingFeedbackWeight: number;
}

/**
 * Reliability signals (#219) derived from the user's moderation track record in
 * the ledger.
 */
export interface ReputationReliability {
  /** Count of active transactions stamped `report_confirmed`. */
  accurateReports: number;
  /** Count of active transactions stamped `report_rejected`. */
  rejectedReports: number;
  /** accurate / (accurate + rejected), or the neutral 0.5 when no history. */
  reportAccuracyScore: number;
  /** Smoothed 0..1 abuse signal; high values force the `restricted` tier. */
  abuseScore: number;
}

/**
 * Cached, recomputable snapshot of a user's reputation. Shape mirrors the
 * `/reputation/:userId/balance` response (which omits internal `lastTransactionId`
 * and `createdAt`).
 */
export interface ReputationBalance {
  userId: string;
  /** Net lifetime total across all active transactions. */
  total: number;
  /** Sum of positive points only. */
  positive: number;
  /** Sum of negative points only (a negative number). */
  negative: number;
  breakdown: ReputationBalanceBreakdown;
  trustTier: TrustTier;
  influence: ReputationInfluence;
  reliability: ReputationReliability;
  /** ISO timestamp the snapshot was last recomputed at. */
  recalculatedAt: string;
  /** ISO last-update timestamp. */
  updatedAt: string;
}

/**
 * A user-initiated dispute against a specific reputation transaction. Ids are
 * strings and dates ISO strings.
 */
export interface ReputationDispute {
  /** The dispute's Mongo `_id` as a string. */
  id: string;
  /** The transaction being disputed. */
  transactionId: string;
  /** The user raising the dispute. */
  userId: string;
  /** Why the user believes the transaction is wrong. */
  reason: string;
  status: ReputationDisputeStatus;
  /** Optional supporting evidence (URLs / references). */
  evidence?: string[];
  /** ISO timestamp the dispute was resolved at, if resolved. */
  resolvedAt?: string;
  /** Staff principal who resolved the dispute, if resolved. */
  resolvedByUserId?: string;
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO last-update timestamp. */
  updatedAt: string;
}

/**
 * A configurable reputation award/penalty rule. The `/reputation/rules`
 * response shape: `id` is the rule's `_id`; no timestamps are emitted.
 */
export interface ReputationRule {
  /** The rule's Mongo `_id` as a string. */
  id: string;
  /** Unique action key (e.g. `post_created`). */
  actionType: string;
  /** Signed points the rule awards (may be negative for penalties). */
  points: number;
  /** Category the resulting transaction is filed under. */
  category: ReputationCategory;
  description: string;
  /** Per (user, actionType) cooldown in minutes; 0 disables the cooldown. */
  cooldownInMinutes: number;
  isEnabled: boolean;
}

/**
 * A single leaderboard entry. `user` is the populated user document the API
 * returns alongside the lifetime total, derived trust tier, and 1-based rank.
 */
export interface ReputationLeaderboardEntry {
  /** The populated user (id, username, name, avatar, publicKey). */
  user: Pick<User, 'id' | 'username' | 'name' | 'avatar' | 'publicKey'> & Partial<User>;
  /** Net lifetime total. */
  total: number;
  /** Derived trust tier. */
  trustTier: TrustTier;
  /** 1-based rank within the leaderboard (`offset + index + 1`). */
  rank: number;
}

/**
 * Result of `getReputationInfluence` — the requested context, the single capped
 * weight for that context, and the full influence block.
 */
export interface ReputationInfluenceResult {
  context: ReputationInfluenceContext;
  weight: number;
  influence: ReputationInfluence;
}

/**
 * Result of `reverseReputationTransaction` — the now-`reversed` original plus
 * the compensating `active` reversal entry.
 */
export interface ReverseReputationTransactionResult {
  original: ReputationTransaction;
  reversal: ReputationTransaction;
}

// =============================================================================
// INPUT TYPES (mirror packages/api/src/schemas/reputation.schemas.ts)
// =============================================================================

/**
 * Input for `awardReputation`. Awarding is restricted to service tokens (the
 * canonical path) and platform staff; regular users may NOT award reputation.
 * When called with a service token, `applicationId` / `credentialId` are
 * resolved from the token and any client-supplied values are ignored.
 */
export interface AwardReputationInput {
  /** The subject whose reputation changes (`_id` or publicKey). */
  userId: string;
  /** The enabled rule's action key (e.g. `post_created`). */
  actionType: string;
  /** Source application id (ignored for service tokens). */
  applicationId?: string;
  /** Source credential id (ignored for service tokens). */
  credentialId?: string;
  /** Opaque originating-action id used as the idempotency key. */
  sourceActionId?: string;
  /** Source-system action type. */
  sourceActionType?: string;
  /** Id of the targeted entity. */
  targetEntityId?: string;
  /** Kind of the targeted entity. */
  targetEntityType?: ReputationTargetEntityType;
  /** Optional human-readable reason (max 500 chars). */
  reason?: string;
  /** Free-form structured metadata from the source system. */
  metadata?: Record<string, unknown>;
}

/** Input for `createReputationDispute`. The disputer is the authenticated user. */
export interface CreateReputationDisputeInput {
  /** The transaction being disputed. */
  transactionId: string;
  /** Why the transaction is believed to be wrong (1..1000 chars). */
  reason: string;
  /** Optional supporting evidence (URLs / references; max 20). */
  evidence?: string[];
}

/** Input for `resolveReputationDispute` (staff). */
export interface ResolveReputationDisputeInput {
  /** Accepting reverses the disputed transaction; rejecting restores it. */
  status: 'accepted' | 'rejected';
}

/** Input for `upsertReputationRule` (staff). Keyed by `actionType`. */
export interface UpsertReputationRuleInput {
  /** Unique action key (e.g. `post_created`). */
  actionType: string;
  /** Signed points the rule awards (may be negative). */
  points: number;
  /** Category the resulting transaction is filed under. */
  category: ReputationCategory;
  /** Human-readable description (1..500 chars). */
  description: string;
  /** Per (user, actionType) cooldown in minutes; defaults to 0. */
  cooldownInMinutes?: number;
  /** Whether the rule is active; defaults to true. */
  isEnabled?: boolean;
}

/**
 * Input for `reverseReputationTransaction` / `voidReputationTransaction`
 * (staff). The reviewing principal is the authenticated user.
 */
export interface ReverseReputationTransactionInput {
  /** Optional human-readable reason (max 500 chars). */
  reason?: string;
}

/** Cache-key prefix for every cached `GET /reputation/...` response. */
const REPUTATION_CACHE_PREFIX = 'GET:/reputation/';

export function OxyServicesReputationMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Get a user's cached reputation balance — derived totals, per-category
     * breakdown, trust tier, capped influence weights, and reliability signals.
     * @param userId - The subject user's `_id` or publicKey.
     */
    async getReputationBalance(userId: string): Promise<ReputationBalance> {
      try {
        return await this.makeRequest<ReputationBalance>(
          'GET',
          `/reputation/${encodeURIComponent(userId)}/balance`,
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.MEDIUM },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get the reputation leaderboard, ordered by lifetime total descending.
     * @param limit - Page size (server-capped).
     * @param offset - Page offset.
     */
    async getReputationLeaderboard(
      limit?: number,
      offset?: number,
    ): Promise<ReputationLeaderboardEntry[]> {
      try {
        const params: { limit?: number; offset?: number } = {};
        if (limit !== undefined) params.limit = limit;
        if (offset !== undefined) params.offset = offset;
        const res = await this.makeRequest<{ data?: ReputationLeaderboardEntry[] }>(
          'GET',
          '/reputation/leaderboard',
          Object.keys(params).length > 0 ? params : undefined,
          { cache: true, cacheTTL: CACHE_TIMES.LONG },
        );
        return res.data ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * List the enabled reputation rules (for client display).
     */
    async getReputationRules(): Promise<ReputationRule[]> {
      try {
        const res = await this.makeRequest<{ rules?: ReputationRule[] }>(
          'GET',
          '/reputation/rules',
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.EXTRA_LONG },
        );
        return res.rules ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get a user's paginated reputation ledger, newest first (auth required).
     * @param userId - The subject user's `_id` or publicKey.
     * @param limit - Page size (server-capped).
     * @param offset - Page offset.
     */
    async getReputationTransactions(
      userId: string,
      limit?: number,
      offset?: number,
    ): Promise<ReputationTransaction[]> {
      try {
        const params: { limit?: number; offset?: number } = {};
        if (limit !== undefined) params.limit = limit;
        if (offset !== undefined) params.offset = offset;
        const res = await this.makeRequest<{ data?: ReputationTransaction[] }>(
          'GET',
          `/reputation/${encodeURIComponent(userId)}/transactions`,
          Object.keys(params).length > 0 ? params : undefined,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT },
        );
        return res.data ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get a user's capped influence weight for a given context (auth required).
     * @param userId - The subject user's `_id` or publicKey.
     * @param context - The weight axis to read (defaults server-side to `default`).
     */
    async getReputationInfluence(
      userId: string,
      context?: ReputationInfluenceContext,
    ): Promise<ReputationInfluenceResult> {
      try {
        return await this.makeRequest<ReputationInfluenceResult>(
          'GET',
          `/reputation/${encodeURIComponent(userId)}/influence`,
          context ? { context } : undefined,
          { cache: true, cacheTTL: CACHE_TIMES.MEDIUM },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Award (or penalise) reputation to a user by `actionType`. Restricted to
     * service tokens and platform staff. Invalidates cached reputation reads.
     * @param input - The award payload (subject, action, source, target, etc.).
     */
    async awardReputation(input: AwardReputationInput): Promise<ReputationTransaction> {
      try {
        const res = await this.makeRequest<{ transaction: ReputationTransaction }>(
          'POST',
          '/reputation/award',
          input,
          { cache: false },
        );
        this.clearCacheByPrefix(REPUTATION_CACHE_PREFIX);
        return res.transaction;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Open a dispute against a transaction (auth required; the disputer is the
     * authenticated user and must own the transaction).
     * @param input - The transaction id, reason, and optional evidence.
     */
    async createReputationDispute(
      input: CreateReputationDisputeInput,
    ): Promise<ReputationDispute> {
      try {
        const res = await this.makeRequest<{ dispute: ReputationDispute }>(
          'POST',
          '/reputation/disputes',
          input,
          { cache: false },
        );
        this.clearCacheByPrefix(REPUTATION_CACHE_PREFIX);
        return res.dispute;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * List a user's own reputation disputes (auth required; the caller must be
     * the subject or platform staff).
     * @param userId - The subject user's `_id` or publicKey.
     * @param limit - Page size (server-capped).
     * @param offset - Page offset.
     */
    async getUserReputationDisputes(
      userId: string,
      limit?: number,
      offset?: number,
    ): Promise<ReputationDispute[]> {
      try {
        const params: { limit?: number; offset?: number } = {};
        if (limit !== undefined) params.limit = limit;
        if (offset !== undefined) params.offset = offset;
        const res = await this.makeRequest<{ data?: ReputationDispute[] }>(
          'GET',
          `/reputation/${encodeURIComponent(userId)}/disputes`,
          Object.keys(params).length > 0 ? params : undefined,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT },
        );
        return res.data ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    // =========================================================================
    // STAFF / ADMIN METHODS (require staff privileges server-side)
    // =========================================================================

    /**
     * Create or update a reputation rule, keyed by `actionType` (staff only).
     * Invalidates the cached rule list.
     * @param input - The rule definition.
     */
    async upsertReputationRule(input: UpsertReputationRuleInput): Promise<ReputationRule> {
      try {
        const res = await this.makeRequest<{ rule: ReputationRule }>(
          'POST',
          '/reputation/rules',
          input,
          { cache: false },
        );
        this.clearCacheByPrefix(REPUTATION_CACHE_PREFIX);
        return res.rule;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Reverse a transaction (staff only): mark the original `reversed` and append
     * a compensating `active` reversal with negated points. Invalidates cached
     * reputation reads.
     * @param transactionId - The transaction's id.
     * @param input - Optional reason for the reversal.
     */
    async reverseReputationTransaction(
      transactionId: string,
      input?: ReverseReputationTransactionInput,
    ): Promise<ReverseReputationTransactionResult> {
      try {
        const res = await this.makeRequest<ReverseReputationTransactionResult>(
          'POST',
          `/reputation/transactions/${encodeURIComponent(transactionId)}/reverse`,
          input ?? {},
          { cache: false },
        );
        this.clearCacheByPrefix(REPUTATION_CACHE_PREFIX);
        return res;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Void a transaction (staff only): mark it `voided` so it is excluded from
     * the balance, with NO compensating entry. Invalidates cached reputation
     * reads.
     * @param transactionId - The transaction's id.
     * @param input - Optional reason for the void.
     */
    async voidReputationTransaction(
      transactionId: string,
      input?: ReverseReputationTransactionInput,
    ): Promise<ReputationTransaction> {
      try {
        const res = await this.makeRequest<{ transaction: ReputationTransaction }>(
          'POST',
          `/reputation/transactions/${encodeURIComponent(transactionId)}/void`,
          input ?? {},
          { cache: false },
        );
        this.clearCacheByPrefix(REPUTATION_CACHE_PREFIX);
        return res.transaction;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Force a recompute of a user's balance snapshot from their active ledger
     * (staff only). Invalidates cached reputation reads.
     * @param userId - The subject user's `_id` or publicKey.
     */
    async recalculateReputation(userId: string): Promise<ReputationBalance> {
      try {
        const res = await this.makeRequest<ReputationBalance>(
          'POST',
          `/reputation/${encodeURIComponent(userId)}/recalculate`,
          undefined,
          { cache: false },
        );
        this.clearCacheByPrefix(REPUTATION_CACHE_PREFIX);
        return res;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get the open dispute queue across all users (staff only).
     * @param limit - Page size (server-capped).
     * @param offset - Page offset.
     */
    async getReputationDisputeQueue(
      limit?: number,
      offset?: number,
    ): Promise<ReputationDispute[]> {
      try {
        const params: { limit?: number; offset?: number } = {};
        if (limit !== undefined) params.limit = limit;
        if (offset !== undefined) params.offset = offset;
        const res = await this.makeRequest<{ data?: ReputationDispute[] }>(
          'GET',
          '/reputation/disputes',
          Object.keys(params).length > 0 ? params : undefined,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT },
        );
        return res.data ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Resolve a dispute (staff only). Accepting reverses the disputed
     * transaction; rejecting restores it to `active`. Invalidates cached
     * reputation reads.
     * @param disputeId - The dispute's id.
     * @param input - The resolution (`accepted` or `rejected`).
     */
    async resolveReputationDispute(
      disputeId: string,
      input: ResolveReputationDisputeInput,
    ): Promise<ReputationDispute> {
      try {
        const res = await this.makeRequest<{ dispute: ReputationDispute }>(
          'POST',
          `/reputation/disputes/${encodeURIComponent(disputeId)}/resolve`,
          input,
          { cache: false },
        );
        this.clearCacheByPrefix(REPUTATION_CACHE_PREFIX);
        return res.dispute;
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}
