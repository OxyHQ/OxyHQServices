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

import mongoose, { type ClientSession } from 'mongoose';
import type {
  ReputationCategory,
  ReputationInfluenceContext,
  ReputationTargetEntityType,
} from '@oxyhq/contracts';

import {
  ReputationTransaction,
  type IReputationTransaction,
} from '../models/ReputationTransaction';
import {
  ReputationBalance,
  type IReputationBalance,
  type ReputationBreakdown,
  type ReputationConductSnapshot,
  type ReputationPersonhoodSnapshot,
  type ReputationReviewingSnapshot,
} from '../models/ReputationBalance';
import { ConductStrike } from '../models/ConductStrike';
import { PersonhoodStatus } from '../models/PersonhoodStatus';
import { ReporterReputationProfile } from '../models/ReporterReputationProfile';
import { ReviewerReputationProfile } from '../models/ReviewerReputationProfile';
import { ReputationRule, type IReputationRule } from '../models/ReputationRule';
import {
  ReputationDispute,
  type IReputationDispute,
} from '../models/ReputationDispute';
import { User } from '../models/User';
import {
  REPORT_CONFIRMED_ACTION,
  REPORT_REJECTED_ACTION,
  ENDORSEMENT_RECEIVED_ACTION,
  ENDORSEMENT_RECEIVED_POINTS,
  REAL_LIFE_ATTESTED_ACTION,
  REAL_LIFE_ATTESTED_POINTS,
  PEER_VALIDATED_ACTION,
  PEER_VALIDATED_POINTS,
  VALIDATION_CORRECT_ACTION,
  VALIDATION_CORRECT_POINTS,
  VALIDATION_INCORRECT_ACTION,
  VALIDATION_INCORRECT_POINTS,
  PERSONHOOD_VOUCHED_ACTION,
  PERSONHOOD_VOUCHED_POINTS,
  VOUCH_SLASHED_ACTION,
  VOUCH_SLASHED_POINTS,
  LEASE_SIGNED_ACTION,
  LEASE_SIGNED_POINTS,
  LEASE_COMPLETED_ACTION,
  LEASE_COMPLETED_POINTS,
  CLEAN_MOVEOUT_ACTION,
  CLEAN_MOVEOUT_POINTS,
  LEASE_DEFAULT_ACTION,
  LEASE_DEFAULT_POINTS,

} from '../utils/reputation.constants';
import {
  CONDUCT_ACTION_TYPES,
  NEUTRAL_REVIEWER_RELIABILITY,
  REPORT_ABUSE_ACTION_TYPES,
} from '../utils/moderation.constants';
import { attestAward } from './civic/attestation.service';
import {
  computeReliability,
  computeReporting,
  deriveConductStanding,
  deriveContextualInfluence,
  deriveContributionTier,
  deriveInfluence,
  deriveTrustTier,
} from '../utils/reputationDerive';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/error';
import { logger } from '../utils/logger';
import userCache from '../utils/userCache';

/**
 * A points/category pair supplied by a VERSIONED policy instead of by a
 * `ReputationRule` row.
 *
 * Exists for exactly one caller: the moderation reputation bridge. A conduct
 * consequence's points come from the `ModerationPolicy` document of the version
 * the decision was made under, because a consequence must be recomputable under
 * the original policy — a mutable `ReputationRule` row cannot express that, and
 * keeping one alongside the policy would be a second authority for the same
 * number, free to drift.
 *
 * NOT reachable from HTTP: `awardReputationSchema` does not declare the field,
 * and `POST /reputation/award` passes each input field explicitly rather than
 * spreading the body, so a client cannot choose its own points.
 */
export interface AwardRuleOverride {
  /** Signed points, already multiplied and capped by the policy engine. */
  points: number;
  category: ReputationCategory;
  /** Human-readable reason recorded on the transaction. */
  description: string;
  /** The policy version the figures came from, recorded for provenance. */
  policyVersion: string;
}

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
  /**
   * When `true`, emit an Oxy-signed `reputation_attestation` record onto the
   * subject's hash chain after the award commits (crypto-owned reputation —
   * Fase 1). Default `false`: the 14 existing call sites are unaffected. Civic
   * awards pass `true`. Emission is non-fatal and never blocks the award.
   */
  emitAttestation?: boolean;
  /**
   * The `recordId`s of the user-signed envelopes that originated this award
   * (e.g. the counterparty's real-life attestation, the jurors' verdicts) —
   * embedded in the Oxy attestation as the proof chain. Only used when
   * `emitAttestation` is `true`.
   */
  sourceEnvelopeIds?: string[];
  /**
   * Bridge-only: take the points and category from a versioned policy instead of
   * from a `ReputationRule`. When present the rule lookup and the per-action
   * cooldown are both skipped — a moderation consequence is governed by the
   * decision's idempotency key, not by a rate limit on the action key.
   */
  ruleOverride?: AwardRuleOverride;
  /**
   * Run the ledger write inside a session the CALLER already opened, so the
   * transaction, its strike and its effect record commit together or not at all.
   * Without this the bridge could leave a ledger row with no strike behind it.
   */
  session?: ClientSession;
}

/** Input for a reversal or void review action. */
export interface ReviewInput {
  reviewedByUserId?: string;
  reason?: string;
}

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

    // Coerced once, here, because `award` has fourteen call sites and is exported:
    // most of them never pass through an HTTP schema at all. A Mongo filter handed
    // `{ $ne: null }` where it expects an action key matches EVERY rule, which
    // would resolve the wrong points and category — and in the idempotency
    // short-circuit it would return an unrelated transaction and silently swallow
    // a legitimate award.
    const actionType = String(input.actionType);
    const sourceActionId =
      input.sourceActionId === undefined ? undefined : String(input.sourceActionId);

    // The figures come from ONE of two authorities, never from both: a
    // `ReputationRule` row (every ordinary award) or a versioned policy the
    // bridge resolved (a moderation consequence, which must stay recomputable
    // under the policy version it was decided under).
    const override = input.ruleOverride;
    let points: number;
    let category: ReputationCategory;
    let defaultReason: string;
    let cooldownInMinutes: number;

    if (override) {
      points = override.points;
      category = override.category;
      defaultReason = override.description;
      // No cooldown: a moderation consequence is bounded by the decision's
      // idempotency key, and a cooldown here would silently drop the second
      // legitimate incident of the same severity.
      cooldownInMinutes = 0;
    } else {
      const rule = await ReputationRule.findOne({
        actionType,
        isEnabled: true,
      });
      if (!rule) {
        throw new BadRequestError('Unknown or disabled reputation action');
      }
      points = rule.points;
      category = rule.category;
      defaultReason = rule.description;
      cooldownInMinutes = rule.cooldownInMinutes;
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
    if (applicationId && sourceActionId) {
      const existing = await ReputationTransaction.findOne({
        applicationId,
        sourceActionId,
      });
      if (existing) {
        return existing;
      }
    }

    // Cooldown: reject a repeat of the same action for the same subject within
    // the rule's window.
    if (cooldownInMinutes > 0) {
      const threshold = new Date(Date.now() - cooldownInMinutes * 60 * 1000);
      const recent = await ReputationTransaction.findOne({
        userId: subjectId,
        actionType,
        status: 'active',
        createdAt: { $gt: threshold },
      });
      if (recent) {
        throw new ConflictError('This action is on cooldown. Please try again later.');
      }
    }

    // Provenance for a policy-derived award: the version the figures came from
    // is recorded on the transaction itself, so the row explains itself without
    // a join and stays explainable after the policy moves on.
    const metadata = override
      ? { ...(input.metadata ?? {}), policyVersion: override.policyVersion }
      : input.metadata;

    const writeTransaction = async (
      session: ClientSession | undefined
    ): Promise<IReputationTransaction> => {
      let created: IReputationTransaction;
      try {
        const docs = await ReputationTransaction.create(
          [
            {
              userId: subjectId,
              points,
              actionType,
              category,
              applicationId,
              credentialId,
              sourceActionId,
              sourceActionType: input.sourceActionType,
              targetEntityId: input.targetEntityId,
              targetEntityType: input.targetEntityType,
              status: 'active',
              reason: input.reason ?? defaultReason,
              metadata,
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
          sourceActionId
        ) {
          const winner = await ReputationTransaction.findOne({
            applicationId,
            sourceActionId,
          });
          if (winner) {
            return winner;
          }
        }
        throw error;
      }

      await this.recalculateBalance(input.userId, session);
      return created;
    };

    // A caller-supplied session means the ledger write is one part of a larger
    // atomic unit (the bridge commits the transaction, its strike and its effect
    // record together). Without one, open a transaction as before.
    const transaction = input.session
      ? await writeTransaction(input.session)
      : await withTransaction(writeTransaction);

    // Crypto-owned reputation (Fase 1): emit an Oxy-signed attestation onto the
    // subject's hash chain AFTER the award commits, so a signing/chain failure
    // can never roll back or block the award. Idempotent per txn + non-fatal.
    if (input.emitAttestation) {
      try {
        await attestAward(transaction, { sourceEnvelopes: input.sourceEnvelopeIds });
      } catch (error) {
        logger.warn('Reputation attestation emission failed (non-fatal)', {
          component: 'reputation.service',
          actionType,
          userId: input.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return transaction;
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

    const result = await withTransaction(async (session) => {
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

    // Staking slash (Fase 2): a reversed civic award slashes the jurors /
    // attestor who vouched for it. Non-fatal + dynamically imported to avoid a
    // reputation↔slash module cycle; never blocks or rolls back the reversal.
    try {
      const { slashForReversedTransaction } = await import('./civic/slash.service.js');
      await slashForReversedTransaction(result.original);
    } catch (error) {
      logger.warn('Reputation slash hook failed (non-fatal)', {
        component: 'reputation.service',
        transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
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
    let reportAbuseCount = 0;
    // Net of everything OUTSIDE the conduct axis. The legacy `restricted`
    // trigger reads this instead of `total`, so a conduct penalty is judged on
    // the conduct axis rather than also forcing a restriction through a negative
    // total — a low-severity finding is worth `watch`, not a restriction.
    let nonConductTotal = 0;
    // Contribution counts only what was BUILT: positive points outside the
    // conduct axis. Conduct penalties still land in `total`, so the ledger stays
    // honest, but they neither lower the contribution tier nor can be offset by
    // it.
    let contributionPoints = 0;
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
      const isConduct = CONDUCT_ACTION_TYPES.has(txn.actionType);

      // Monetary aggregation over the not-voided set.
      total += txn.points;
      if (txn.points > 0) {
        positive += txn.points;
      } else if (txn.points < 0) {
        negative += txn.points;
        penalties += Math.abs(txn.points);
      }

      if (!isConduct) {
        nonConductTotal += txn.points;
        if (txn.points > 0) {
          contributionPoints += txn.points;
        }
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
      //
      // Only CONFIRMED REPORT ABUSE feeds the abuse signal. It used to be every
      // negative transaction at double weight, which meant a penalty for
      // unrelated conduct drove a report-abuse verdict — and that verdict forces
      // the `restricted` tier. Conduct now lands on the conduct axis instead.
      if (txn.status === 'active') {
        if (REPORT_ABUSE_ACTION_TYPES.has(txn.actionType)) {
          reportAbuseCount += 1;
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
      reportAbuseCount,
    });

    const user = await User.findById(subjectId).select('verified').lean();
    const verified = user?.verified === true;

    const conduct = await this.deriveConductSnapshot(subjectId, session);

    const trustTier = deriveTrustTier({
      total,
      nonConductTotal,
      verified,
      reliability,
      conductStanding: conduct.standing,
    });
    const influence = deriveInfluence(total, trustTier, reliability);

    const [personhood, reporting, reviewing] = await Promise.all([
      this.derivePersonhoodSnapshot(subjectId, session),
      this.deriveReportingSnapshot(subjectId, session),
      this.deriveReviewingSnapshot(subjectId, session),
    ]);

    const contribution = {
      points: contributionPoints,
      tier: deriveContributionTier(contributionPoints),
    };

    const contextualInfluence = deriveContextualInfluence({
      contributionPoints,
      conductStanding: conduct.standing,
      reportingReliability: reporting.reliability,
      reportingConfidence: reporting.confidence,
      reviewingReliability: reviewing.globalReliability,
    });

    const update = {
      total,
      positive,
      negative,
      breakdown,
      trustTier,
      influence,
      reliability,
      personhood,
      contribution,
      conduct,
      reporting,
      reviewing,
      contextualInfluence,
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

    // Denormalize the ranking weight + tier onto the user so the recommendation
    // scorer can join the reputation signal cheaply at query time (a sort/floor
    // on User fields instead of a per-user lookup into reputationbalances). Kept
    // in the same recompute path/session as the balance write so the two never
    // diverge.
    await User.updateOne(
      { _id: subjectId },
      {
        $set: {
          reputationRankWeight: influence.rankingFeedbackWeight,
          reputationTier: trustTier,
        },
      },
      session ? { session } : {}
    );
    userCache.invalidate(subjectId.toString());

    return balance;
  }

  /**
   * The conduct snapshot: active risk, active strike count, and when the
   * earliest-expiring strike lapses.
   *
   * Read from `ConductStrike` rather than from the ledger, because the ledger
   * cannot express "still under consequence". A reversed or expired strike stops
   * contributing immediately while its transaction stays in the ledger, which is
   * how traceability survives forgiveness. Critical strikes carry no `expiresAt`
   * and so never appear as a next expiry — they need a recovery review.
   */
  private async deriveConductSnapshot(
    subjectId: mongoose.Types.ObjectId,
    session?: ClientSession
  ): Promise<ReputationConductSnapshot> {
    const query = ConductStrike.find({ userId: subjectId, status: 'active' });
    const strikes = session ? await query.session(session) : await query;

    let activeRisk = 0;
    let nextExpiryAt: Date | undefined;
    for (const strike of strikes) {
      activeRisk += strike.riskPoints;
      if (strike.expiresAt && (!nextExpiryAt || strike.expiresAt < nextExpiryAt)) {
        nextExpiryAt = strike.expiresAt;
      }
    }

    return {
      standing: deriveConductStanding(activeRisk),
      activeRisk,
      activeStrikes: strikes.length,
      nextExpiryAt,
    };
  }

  /**
   * The personhood snapshot, mirrored from the web-of-trust's own recomputable
   * status. Its own axis: being a real person proves neither conduct nor
   * competence, so it confers nothing on the others.
   */
  private async derivePersonhoodSnapshot(
    subjectId: mongoose.Types.ObjectId,
    session?: ClientSession
  ): Promise<ReputationPersonhoodSnapshot> {
    // The session travels as a query OPTION rather than through `.session()`:
    // these are single-document reads, and the options form keeps them
    // expressible against any query implementation instead of requiring a
    // chainable one.
    const status = await PersonhoodStatus.findOne(
      { userId: subjectId },
      null,
      session ? { session } : {}
    );
    if (!status) {
      return { status: 'unknown', score: 0 };
    }
    return {
      status: status.isRealPerson ? 'verified' : status.score > 0 ? 'probable' : 'unknown',
      score: status.score,
    };
  }

  /**
   * The reporting snapshot, from the reporter profile only.
   *
   * Absent profile means no reporting history, which is a NEUTRAL prior rather
   * than a zero — a person who has never filed a report is not an unreliable
   * reporter.
   */
  private async deriveReportingSnapshot(
    subjectId: mongoose.Types.ObjectId,
    session?: ClientSession
  ): Promise<ReturnType<typeof computeReporting>> {
    const profile = await ReporterReputationProfile.findOne(
      { userId: subjectId },
      null,
      session ? { session } : {}
    );
    return computeReporting({
      confirmed: profile?.confirmed ?? 0,
      rejected: profile?.rejected ?? 0,
      malicious: profile?.malicious ?? 0,
    });
  }

  /**
   * The reviewing snapshot, from the reviewer profile only. Per category and
   * language, because competence in one category says little about another.
   */
  private async deriveReviewingSnapshot(
    subjectId: mongoose.Types.ObjectId,
    session?: ClientSession
  ): Promise<ReputationReviewingSnapshot> {
    const profile = await ReviewerReputationProfile.findOne(
      { userId: subjectId },
      null,
      session ? { session } : {}
    );
    if (!profile) {
      return {
        globalReliability: NEUTRAL_REVIEWER_RELIABILITY,
        categoryReliability: new Map<string, number>(),
        languageReliability: new Map<string, number>(),
      };
    }
    return {
      globalReliability: profile.globalReliability,
      categoryReliability: profile.categoryReliability ?? new Map<string, number>(),
      languageReliability: profile.languageReliability ?? new Map<string, number>(),
    };
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
    context: ReputationInfluenceContext
  ): Promise<{ context: ReputationInfluenceContext; weight: number; influence: IReputationBalance['influence'] }> {
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
    const eligibleUserStages = [
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $match: {
          'user.accountStatus': { $ne: 'archived' },
          'user.reputationTier': { $ne: 'restricted' },
        },
      },
    ] as const;

    const [rows, countRows] = await Promise.all([
      ReputationBalance.aggregate([
        ...eligibleUserStages,
        { $sort: { total: -1 } },
        { $skip: offset },
        { $limit: limit },
        {
          $project: {
            total: 1,
            positive: 1,
            negative: 1,
            breakdown: 1,
            trustTier: 1,
            influence: 1,
            reliability: 1,
            lastTransactionId: 1,
            recalculatedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            userId: {
              _id: '$user._id',
              username: '$user.username',
              name: '$user.name',
              avatar: '$user.avatar',
              publicKey: '$user.publicKey',
            },
          },
        },
      ]),
      ReputationBalance.aggregate([...eligibleUserStages, { $count: 'total' }]),
    ]);

    return { items: rows as IReputationBalance[], total: countRows[0]?.total ?? 0 };
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

  /**
   * Idempotently seed the platform-default reputation rules that the code awards
   * directly (not migrated from legacy karma). Currently the cross-app
   * `endorsement_received` rule. Safe to call repeatedly — it upserts by
   * `actionType` and performs no write when the rule is already up to date.
   */
  async seedDefaultRules(): Promise<void> {
    await this.upsertRule({
      actionType: ENDORSEMENT_RECEIVED_ACTION,
      points: ENDORSEMENT_RECEIVED_POINTS,
      category: 'social',
      description: 'Endorsed by another user in a connected app',
      cooldownInMinutes: 0,
      isEnabled: true,
    });

    // Civic / Commons rules (Fase 1) — crypto-owned reputation.
    await this.upsertRule({
      actionType: REAL_LIFE_ATTESTED_ACTION,
      points: REAL_LIFE_ATTESTED_POINTS,
      category: 'physical',
      description: 'A real-world interaction a counterparty cryptographically attested',
      cooldownInMinutes: 0,
      isEnabled: true,
    });
    await this.upsertRule({
      actionType: PEER_VALIDATED_ACTION,
      points: PEER_VALIDATED_POINTS,
      category: 'trust',
      description: 'Validated by a randomly-selected jury of peers',
      cooldownInMinutes: 0,
      isEnabled: true,
    });
    await this.upsertRule({
      actionType: VALIDATION_CORRECT_ACTION,
      points: VALIDATION_CORRECT_POINTS,
      category: 'trust',
      description: 'Voted with the resolving majority on a peer validation',
      cooldownInMinutes: 0,
      isEnabled: true,
    });
    await this.upsertRule({
      actionType: VALIDATION_INCORRECT_ACTION,
      points: VALIDATION_INCORRECT_POINTS,
      category: 'penalty',
      description: 'Endorsed a verdict later reverted as fraud',
      cooldownInMinutes: 0,
      isEnabled: true,
    });
    await this.upsertRule({
      actionType: PERSONHOOD_VOUCHED_ACTION,
      points: PERSONHOOD_VOUCHED_POINTS,
      category: 'trust',
      description: 'Vouched for as a real person by a staking voucher',
      cooldownInMinutes: 0,
      isEnabled: true,
    });
    await this.upsertRule({
      actionType: VOUCH_SLASHED_ACTION,
      points: VOUCH_SLASHED_POINTS,
      category: 'penalty',
      description: 'Vouched for a person found to be fake (staking slash)',
      cooldownInMinutes: 0,
      isEnabled: true,
    });

    // Homiio RE lifecycle — awarded by the Homiio service credential (`reputation:write`).
    await this.upsertRule({
      actionType: LEASE_SIGNED_ACTION,
      points: LEASE_SIGNED_POINTS,
      category: 'trust',
      description: 'Lease fully signed by landlord and tenant (Homiio)',
      cooldownInMinutes: 0,
      isEnabled: true,
    });
    await this.upsertRule({
      actionType: LEASE_COMPLETED_ACTION,
      points: LEASE_COMPLETED_POINTS,
      category: 'trust',
      description: 'Lease completed without early termination (Homiio)',
      cooldownInMinutes: 0,
      isEnabled: true,
    });
    await this.upsertRule({
      actionType: CLEAN_MOVEOUT_ACTION,
      points: CLEAN_MOVEOUT_POINTS,
      category: 'trust',
      description: 'Clean move-out with no damage or outstanding obligations (Homiio)',
      cooldownInMinutes: 0,
      isEnabled: true,
    });
    await this.upsertRule({
      actionType: LEASE_DEFAULT_ACTION,
      points: LEASE_DEFAULT_POINTS,
      category: 'penalty',
      description: 'Lease ended in default — unpaid rent, abandonment, or breach (Homiio)',
      cooldownInMinutes: 0,
      isEnabled: true,
    });
  }

  /** Create or update a rule keyed by `actionType`. */
  async upsertRule(input: UpsertRuleInput): Promise<IReputationRule> {
    // Same reasoning as `award`: an operator object here would match an arbitrary
    // existing rule and this upsert would then REWRITE its points and category.
    const actionType = String(input.actionType);
    const rule = await ReputationRule.findOneAndUpdate(
      { actionType },
      {
        $set: {
          points: input.points,
          category: input.category,
          description: input.description,
          cooldownInMinutes: input.cooldownInMinutes ?? 0,
          isEnabled: input.isEnabled ?? true,
        },
        $setOnInsert: { actionType },
      },
      { new: true, upsert: true }
    );
    return rule;
  }
}

export const reputationService = new ReputationService();
export default reputationService;
