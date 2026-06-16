/**
 * Reputation service — the single source of truth for all reputation mutations
 * (#217 ledger + #219 derived trust tiers / capped influence).
 *
 * Invariants:
 *  - Transactions are NEVER deleted. Corrections are expressed as reversals
 *    (compensating entry) or voids (status flip, no compensating entry).
 *  - A user's balance is always re-derivable by aggregating their `active`
 *    transactions; `ReputationBalance` is a recomputable cache of that.
 *  - Awards are idempotent on (applicationId, sourceActionId).
 *  - Every constant lives in `reputation.constants.ts`.
 */

import mongoose, { ClientSession } from 'mongoose';

import {
  ReputationTransaction,
  IReputationTransaction,
} from '../models/ReputationTransaction';
import {
  ReputationBalance,
  IReputationBalance,
  ReputationBreakdown,
} from '../models/ReputationBalance';
import { ReputationRule, IReputationRule } from '../models/ReputationRule';
import {
  ReputationDispute,
  IReputationDispute,
} from '../models/ReputationDispute';
import { User } from '../models/User';
import {
  REPORT_CONFIRMED_ACTION,
  REPORT_REJECTED_ACTION,
  type ReputationCategory,
  type ReputationTargetEntityType,
} from '../utils/reputation.constants';
import {
  computeReliability,
  deriveInfluence,
  deriveTrustTier,
} from '../utils/reputationDerive';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/error';
import { logger } from '../utils/logger';

/** Input for `award`. `userId` is the subject whose reputation changes. */
export interface AwardInput {
  userId: string;
  actionType: string;
  applicationId?: string;
  credentialId?: string;
  sourceActionId?: string;
  sourceActionType?: string;
  targetEntityId?: string;
  targetEntityType?: ReputationTargetEntityType;
  reason?: string;
  createdByUserId?: string;
  metadata?: Record<string, unknown>;
}

/** Input for a reversal or void review action. */
export interface ReviewInput {
  reviewedByUserId?: string;
  reason?: string;
}

/** The influence context selecting which capped weight to return. */
export type InfluenceContext = 'default' | 'report' | 'moderation' | 'ranking';

/** Input for upserting a reputation rule. */
export interface UpsertRuleInput {
  actionType: string;
  points: number;
  category: ReputationCategory;
  description: string;
  cooldownInMinutes?: number;
  isEnabled?: boolean;
}

function toObjectId(value: string, field: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new BadRequestError(`Invalid ${field}`);
  }
  return new mongoose.Types.ObjectId(value);
}

/**
 * Run a unit of work inside a Mongo transaction, falling back to a
 * session-less execution when the deployment does not support transactions
 * (e.g. a standalone mongod in local dev). Production runs a single-node
 * replica set, so the transactional path is the norm.
 */
async function withTransaction<T>(
  work: (session: ClientSession | undefined) => Promise<T>
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    // `withTransaction` resolves only after the callback succeeds, so `result`
    // is always assigned here.
    return result as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transactionsUnsupported =
      message.includes('Transaction numbers are only allowed') ||
      message.includes('replica set') ||
      message.includes('does not support transactions');
    if (transactionsUnsupported) {
      logger.warn(
        'Reputation: transactions unsupported by this MongoDB deployment; ' +
          'executing without a transaction',
        { component: 'reputation.service' }
      );
      return work(undefined);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

class ReputationService {
  /**
   * Award (or penalise) reputation to a user by `actionType`.
   *
   * Resolves the enabled rule, enforces the per (user, actionType) cooldown,
   * enforces idempotency on (applicationId, sourceActionId), creates the
   * transaction, and recomputes the balance. Returns the created (or, on an
   * idempotent hit, the pre-existing) transaction.
   */
  async award(input: AwardInput): Promise<IReputationTransaction> {
    const subjectId = toObjectId(input.userId, 'userId');

    const rule = await ReputationRule.findOne({
      actionType: input.actionType,
      isEnabled: true,
    });
    if (!rule) {
      throw new BadRequestError('Unknown or disabled reputation action');
    }

    const applicationId = input.applicationId
      ? toObjectId(input.applicationId, 'applicationId')
      : undefined;
    const credentialId = input.credentialId
      ? toObjectId(input.credentialId, 'credentialId')
      : undefined;
    const createdByUserId = input.createdByUserId
      ? toObjectId(input.createdByUserId, 'createdByUserId')
      : undefined;

    // Idempotency: a given (applicationId, sourceActionId) may award at most
    // once. Short-circuit BEFORE the cooldown check so a retried delivery of
    // the same source action returns the original transaction rather than a
    // cooldown conflict.
    if (applicationId && input.sourceActionId) {
      const existing = await ReputationTransaction.findOne({
        applicationId,
        sourceActionId: input.sourceActionId,
      });
      if (existing) {
        return existing;
      }
    }

    // Cooldown: reject a repeat of the same action for the same subject within
    // the rule's window.
    if (rule.cooldownInMinutes > 0) {
      const threshold = new Date(Date.now() - rule.cooldownInMinutes * 60 * 1000);
      const recent = await ReputationTransaction.findOne({
        userId: subjectId,
        actionType: input.actionType,
        status: 'active',
        createdAt: { $gt: threshold },
      });
      if (recent) {
        throw new ConflictError('This action is on cooldown. Please try again later.');
      }
    }

    return withTransaction(async (session) => {
      let created: IReputationTransaction;
      try {
        const docs = await ReputationTransaction.create(
          [
            {
              userId: subjectId,
              points: rule.points,
              actionType: input.actionType,
              category: rule.category,
              applicationId,
              credentialId,
              sourceActionId: input.sourceActionId,
              sourceActionType: input.sourceActionType,
              targetEntityId: input.targetEntityId,
              targetEntityType: input.targetEntityType,
              status: 'active',
              reason: input.reason ?? rule.description,
              metadata: input.metadata,
              createdByUserId,
            },
          ],
          session ? { session } : {}
        );
        created = docs[0];
      } catch (error) {
        // Idempotency race: the partial-unique index rejected a concurrent
        // duplicate. Return the winner.
        if (
          error instanceof Error &&
          'code' in error &&
          (error as { code?: number }).code === 11000 &&
          applicationId &&
          input.sourceActionId
        ) {
          const winner = await ReputationTransaction.findOne({
            applicationId,
            sourceActionId: input.sourceActionId,
          });
          if (winner) {
            return winner;
          }
        }
        throw error;
      }

      await this.recalculateBalance(input.userId, session);
      return created;
    });
  }

  /**
   * Reverse a transaction: mark the original `reversed` and append a
   * compensating `active` transaction with negated points that references the
   * original. Never deletes. Recomputes the balance. Idempotent — a transaction
   * already reversed is returned unchanged.
   */
  async reverseTransaction(
    transactionId: string,
    review: ReviewInput
  ): Promise<{ original: IReputationTransaction; reversal: IReputationTransaction }> {
    const id = toObjectId(transactionId, 'transactionId');
    const reviewedByUserId = review.reviewedByUserId
      ? toObjectId(review.reviewedByUserId, 'reviewedByUserId')
      : undefined;

    const original = await ReputationTransaction.findById(id);
    if (!original) {
      throw new NotFoundError('Transaction not found');
    }

    if (original.status === 'reversed') {
      const existingReversal = await ReputationTransaction.findOne({
        reversedTransactionId: original._id,
      });
      if (existingReversal) {
        return { original, reversal: existingReversal };
      }
    }

    if (original.status === 'voided') {
      throw new ConflictError('A voided transaction cannot be reversed');
    }

    return withTransaction(async (session) => {
      original.status = 'reversed';
      original.reviewedByUserId = reviewedByUserId;
      original.reviewedAt = new Date();
      if (review.reason) {
        original.reason = review.reason;
      }
      await original.save(session ? { session } : {});

      const reversalDocs = await ReputationTransaction.create(
        [
          {
            userId: original.userId,
            points: -original.points,
            actionType: original.actionType,
            category: original.category,
            applicationId: original.applicationId,
            credentialId: original.credentialId,
            sourceActionType: original.sourceActionType,
            targetEntityId: original.targetEntityId,
            targetEntityType: original.targetEntityType,
            status: 'active',
            reversedTransactionId: original._id,
            reason: review.reason ?? `Reversal of ${original._id.toString()}`,
            createdByUserId: reviewedByUserId,
            reviewedByUserId,
            reviewedAt: new Date(),
          },
        ],
        session ? { session } : {}
      );

      await this.recalculateBalance(original.userId.toString(), session);
      return { original, reversal: reversalDocs[0] };
    });
  }

  /**
   * Void a transaction: mark it `voided` so it is excluded from the balance,
   * with NO compensating entry. Never deletes. Recomputes the balance.
   */
  async voidTransaction(
    transactionId: string,
    review: ReviewInput
  ): Promise<IReputationTransaction> {
    const id = toObjectId(transactionId, 'transactionId');
    const reviewedByUserId = review.reviewedByUserId
      ? toObjectId(review.reviewedByUserId, 'reviewedByUserId')
      : undefined;

    const txn = await ReputationTransaction.findById(id);
    if (!txn) {
      throw new NotFoundError('Transaction not found');
    }
    if (txn.status === 'voided') {
      return txn;
    }
    if (txn.status === 'reversed') {
      throw new ConflictError('A reversed transaction cannot be voided');
    }

    return withTransaction(async (session) => {
      txn.status = 'voided';
      txn.reviewedByUserId = reviewedByUserId;
      txn.reviewedAt = new Date();
      if (review.reason) {
        txn.reason = review.reason;
      }
      await txn.save(session ? { session } : {});

      await this.recalculateBalance(txn.userId.toString(), session);
      return txn;
    });
  }

  /**
   * Recompute and persist a user's balance snapshot. This is the function #219
   * hinges on.
   *
   * Counting model:
   *  - MONETARY aggregation (total/positive/negative/breakdown) sums every
   *    transaction EXCEPT `voided` ones. A reversal is expressed as a pair —
   *    the `reversed` original (its points retained for audit) and a `active`
   *    compensating entry with negated points — so the pair nets to ZERO. A
   *    `voided` transaction contributes nothing. A `disputed` transaction still
   *    counts until its dispute resolves.
   *  - RELIABILITY counts (accurate/rejected reports, penalties) are derived
   *    from `active` transactions ONLY, so a cancelled (reversed) report no
   *    longer inflates a user's reliability.
   *  - `penalties` = absolute sum of all negative-point counted transactions.
   *  - trust tier needs `User.verified`; influence weights are derived last.
   */
  async recalculateBalance(
    userId: string | mongoose.Types.ObjectId,
    session?: ClientSession
  ): Promise<IReputationBalance> {
    const subjectId =
      userId instanceof mongoose.Types.ObjectId
        ? userId
        : toObjectId(userId, 'userId');

    const baseQuery = ReputationTransaction.find({
      userId: subjectId,
      status: { $ne: 'voided' },
    });
    const transactions = session
      ? await baseQuery.session(session)
      : await baseQuery;

    let total = 0;
    let positive = 0;
    let negative = 0;
    let penalties = 0;
    let accurateReports = 0;
    let rejectedReports = 0;
    let penaltyCount = 0;
    let lastTransactionId: mongoose.Types.ObjectId | undefined;
    let lastCreatedAt = 0;

    const breakdown: ReputationBreakdown = {
      content: 0,
      social: 0,
      trust: 0,
      moderation: 0,
      physical: 0,
      penalties: 0,
    };

    for (const txn of transactions) {
      // Monetary aggregation over the not-voided set.
      total += txn.points;
      if (txn.points > 0) {
        positive += txn.points;
      } else if (txn.points < 0) {
        negative += txn.points;
        penalties += Math.abs(txn.points);
      }

      // Category breakdown carries the signed sum per named category. The
      // `penalty` category folds into the dedicated `penalties` bucket below.
      switch (txn.category) {
        case 'content':
          breakdown.content += txn.points;
          break;
        case 'social':
          breakdown.social += txn.points;
          break;
        case 'trust':
          breakdown.trust += txn.points;
          break;
        case 'moderation':
          breakdown.moderation += txn.points;
          break;
        case 'physical':
          breakdown.physical += txn.points;
          break;
        case 'penalty':
        case 'other':
          break;
      }

      // Reliability is derived from ACTIVE transactions only — cancelled
      // (reversed) or disputed reports do not count toward report accuracy.
      if (txn.status === 'active') {
        if (txn.category === 'penalty' || txn.points < 0) {
          penaltyCount += 1;
        }
        if (txn.sourceActionType === REPORT_CONFIRMED_ACTION) {
          accurateReports += 1;
        } else if (txn.sourceActionType === REPORT_REJECTED_ACTION) {
          rejectedReports += 1;
        }
      }

      const createdMs = txn.createdAt ? txn.createdAt.getTime() : 0;
      if (createdMs >= lastCreatedAt) {
        lastCreatedAt = createdMs;
        lastTransactionId = txn._id;
      }
    }

    breakdown.penalties = penalties;

    const reliability = computeReliability({
      accurateReports,
      rejectedReports,
      penaltyCount,
    });

    const user = await User.findById(subjectId).select('verified').lean();
    const verified = user?.verified === true;

    const trustTier = deriveTrustTier(total, verified, reliability);
    const influence = deriveInfluence(total, trustTier, reliability);

    const update = {
      total,
      positive,
      negative,
      breakdown,
      trustTier,
      influence,
      reliability,
      lastTransactionId,
      recalculatedAt: new Date(),
    };

    const balance = await ReputationBalance.findOneAndUpdate(
      { userId: subjectId },
      { $set: update, $setOnInsert: { userId: subjectId } },
      {
        new: true,
        upsert: true,
        ...(session ? { session } : {}),
      }
    );

    return balance;
  }

  /** Return the cached balance, recomputing it when absent. */
  async getBalance(userId: string): Promise<IReputationBalance> {
    const subjectId = toObjectId(userId, 'userId');
    const existing = await ReputationBalance.findOne({ userId: subjectId });
    if (existing) {
      return existing;
    }
    return this.recalculateBalance(userId);
  }

  /**
   * Return the capped influence weight(s) for a user. `context` selects a single
   * axis; the full block is always recomputed when no snapshot exists yet.
   */
  async getInfluence(
    userId: string,
    context: InfluenceContext
  ): Promise<{ context: InfluenceContext; weight: number; influence: IReputationBalance['influence'] }> {
    const balance = await this.getBalance(userId);
    const { influence } = balance;
    const weight =
      context === 'report'
        ? influence.reportWeight
        : context === 'moderation'
          ? influence.moderationWeight
          : context === 'ranking'
            ? influence.rankingFeedbackWeight
            : influence.defaultWeight;
    return { context, weight, influence };
  }

  /**
   * Open a dispute against a transaction and mark the transaction `disputed`.
   * The disputing user must own the transaction (be its subject).
   */
  async createDispute(
    transactionId: string,
    userId: string,
    reason: string,
    evidence?: string[]
  ): Promise<IReputationDispute> {
    const txnId = toObjectId(transactionId, 'transactionId');
    const disputerId = toObjectId(userId, 'userId');

    const txn = await ReputationTransaction.findById(txnId);
    if (!txn) {
      throw new NotFoundError('Transaction not found');
    }
    if (!txn.userId.equals(disputerId)) {
      throw new BadRequestError('You can only dispute your own transactions');
    }
    if (txn.status === 'reversed' || txn.status === 'voided') {
      throw new ConflictError('This transaction can no longer be disputed');
    }

    return withTransaction(async (session) => {
      const disputeDocs = await ReputationDispute.create(
        [
          {
            transactionId: txn._id,
            userId: disputerId,
            reason,
            evidence,
            status: 'open',
          },
        ],
        session ? { session } : {}
      );

      txn.status = 'disputed';
      await txn.save(session ? { session } : {});

      return disputeDocs[0];
    });
  }

  /**
   * Resolve a dispute. Accepting reverses the disputed transaction; rejecting
   * restores it to `active`. Sets resolution metadata on the dispute.
   */
  async resolveDispute(
    disputeId: string,
    params: { status: 'accepted' | 'rejected'; resolvedByUserId: string }
  ): Promise<IReputationDispute> {
    const id = toObjectId(disputeId, 'disputeId');
    const resolvedByUserId = toObjectId(params.resolvedByUserId, 'resolvedByUserId');

    const dispute = await ReputationDispute.findById(id);
    if (!dispute) {
      throw new NotFoundError('Dispute not found');
    }
    if (dispute.status === 'accepted' || dispute.status === 'rejected') {
      throw new ConflictError('Dispute is already resolved');
    }

    if (params.status === 'accepted') {
      await this.reverseTransaction(dispute.transactionId.toString(), {
        reviewedByUserId: params.resolvedByUserId,
        reason: `Dispute ${dispute._id.toString()} accepted`,
      });
    } else {
      const txn = await ReputationTransaction.findById(dispute.transactionId);
      if (txn && txn.status === 'disputed') {
        txn.status = 'active';
        txn.reviewedByUserId = resolvedByUserId;
        txn.reviewedAt = new Date();
        await txn.save();
      }
    }

    dispute.status = params.status;
    dispute.resolvedByUserId = resolvedByUserId;
    dispute.resolvedAt = new Date();
    await dispute.save();

    return dispute;
  }

  /** Leaderboard ordered by lifetime total descending. */
  async getLeaderboard(
    limit: number,
    offset: number
  ): Promise<{ items: IReputationBalance[]; total: number }> {
    const [items, total] = await Promise.all([
      ReputationBalance.find({})
        .sort({ total: -1 })
        .skip(offset)
        .limit(limit)
        .populate('userId', 'username name avatar publicKey _id'),
      ReputationBalance.countDocuments({}),
    ]);
    return { items, total };
  }

  /** Paginated ledger for a user, newest first. */
  async listTransactions(
    userId: string,
    limit: number,
    offset: number
  ): Promise<{ items: IReputationTransaction[]; total: number }> {
    const subjectId = toObjectId(userId, 'userId');
    const [items, total] = await Promise.all([
      ReputationTransaction.find({ userId: subjectId })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
      ReputationTransaction.countDocuments({ userId: subjectId }),
    ]);
    return { items, total };
  }

  /** Disputes raised by a single user. */
  async listDisputesForUser(
    userId: string,
    limit: number,
    offset: number
  ): Promise<{ items: IReputationDispute[]; total: number }> {
    const subjectId = toObjectId(userId, 'userId');
    const [items, total] = await Promise.all([
      ReputationDispute.find({ userId: subjectId })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
      ReputationDispute.countDocuments({ userId: subjectId }),
    ]);
    return { items, total };
  }

  /** Open disputes across all users (staff queue). */
  async listOpenDisputes(
    limit: number,
    offset: number
  ): Promise<{ items: IReputationDispute[]; total: number }> {
    const filter = { status: { $in: ['open', 'needs_review'] } };
    const [items, total] = await Promise.all([
      ReputationDispute.find(filter)
        .sort({ createdAt: 1 })
        .skip(offset)
        .limit(limit),
      ReputationDispute.countDocuments(filter),
    ]);
    return { items, total };
  }

  /** Enabled rules (for client display). */
  async listEnabledRules(): Promise<IReputationRule[]> {
    return ReputationRule.find({ isEnabled: true }).sort({ category: 1, actionType: 1 });
  }

  /** Create or update a rule keyed by `actionType`. */
  async upsertRule(input: UpsertRuleInput): Promise<IReputationRule> {
    const rule = await ReputationRule.findOneAndUpdate(
      { actionType: input.actionType },
      {
        $set: {
          points: input.points,
          category: input.category,
          description: input.description,
          cooldownInMinutes: input.cooldownInMinutes ?? 0,
          isEnabled: input.isEnabled ?? true,
        },
        $setOnInsert: { actionType: input.actionType },
      },
      { new: true, upsert: true }
    );
    return rule;
  }
}

export const reputationService = new ReputationService();
export default reputationService;
