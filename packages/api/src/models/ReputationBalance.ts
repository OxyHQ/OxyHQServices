import mongoose, { type Document, Schema } from 'mongoose';
import {
  CONDUCT_STANDINGS,
  CONTRIBUTION_TIERS,
  PERSONHOOD_STATUSES,
  TRUST_TIERS,
  type ConductStanding,
  type ContributionTier,
  type PersonhoodStatusValue,
  type TrustTier,
} from '@oxyhq/contracts';

/**
 * Per-category sums of ACTIVE transactions for a user. `penalties` is the
 * absolute sum of all negative-point active transactions (across every
 * category), surfaced as a single "how much has been deducted" figure; the
 * named category buckets carry the signed sum of transactions in that category.
 */
export interface ReputationBreakdown {
  content: number;
  social: number;
  trust: number;
  moderation: number;
  physical: number;
  penalties: number;
}

/**
 * Capped influence weights (#219). Every weight is clamped to
 * [INFLUENCE_MIN, INFLUENCE_MAX]; restricted users are floored to INFLUENCE_MIN
 * on every axis. These are consumed by downstream systems (ranking, moderation,
 * reporting) to weight a user's contributions without letting any single user
 * dominate.
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
 * Personhood axis: whether Oxy believes this is a real, distinct person.
 *
 * Deliberately NOT a trust tier. Being a real person proves neither good conduct
 * nor competence at moderating, so personhood confers nothing on the other axes
 * — it only says the account is not a fabrication.
 */
export interface ReputationPersonhoodSnapshot {
  status: PersonhoodStatusValue;
  /** 0..1 confidence in that status. */
  score: number;
}

/**
 * Contribution axis: what the person built.
 *
 * `points` EXCLUDES conduct penalties. The penalties still count toward the
 * legacy `total` — the ledger stays honest — but they neither lower the
 * contribution tier nor can be bought off by it. This is one half of the
 * separation; {@link ReputationConductSnapshot} is the other.
 */
export interface ReputationContributionSnapshot {
  points: number;
  tier: ContributionTier;
}

/**
 * Conduct axis: the standing moderation outcomes move.
 *
 * `activeRisk` is the sum of risk carried by ACTIVE `ConductStrike` documents,
 * and `standing` derives from `activeRisk` alone. That is the whole point:
 * because standing never reads the point total, earning contribution points
 * cannot cancel an active strike, and a single small penalty cannot restrict an
 * account outright. Risk leaves only by expiry or by reversal.
 */
export interface ReputationConductSnapshot {
  standing: ConductStanding;
  activeRisk: number;
  activeStrikes: number;
  /**
   * When the earliest-expiring active strike lapses. Absent when there is no
   * active strike, or when every active strike requires manual recovery review
   * (critical severity never expires on a timer).
   */
  nextExpiryAt?: Date;
}

/**
 * Reporting axis: how reliable this person's reports are — and NOTHING else.
 *
 * The legacy `reliability.abuseScore` counted every negative transaction, so a
 * penalty for unrelated conduct inflated a report-abuse figure that can force a
 * restriction. This block reads only reporting outcomes, which makes that
 * conflation impossible rather than merely discouraged. `malicious` counts
 * CONFIRMED report abuse; a rejected report is not bad faith.
 */
export interface ReputationReportingSnapshot {
  /** Smoothed 0..1 accuracy estimate (Beta posterior mean, neutral prior). */
  reliability: number;
  /** 0..1 confidence in that estimate, from effective sample size. */
  confidence: number;
  confirmed: number;
  rejected: number;
  malicious: number;
}

/**
 * Reviewing axis: reliability as a REVIEWER, per category and language rather
 * than as one global number — competence in one category says little about
 * another.
 */
export interface ReputationReviewingSnapshot {
  globalReliability: number;
  categoryReliability: Map<string, number>;
  languageReliability: Map<string, number>;
}

/**
 * Contextual weights the V2 model publishes.
 *
 * Report priority, jury-selection probability and ranking are different
 * questions, and none of them is the weight of a vote — a vote inside a jury is
 * never weighted. One qualified person, one vote.
 */
export interface ReputationContextualInfluenceSnapshot {
  reportPriorityWeight: number;
  reviewSelectionWeight: number;
  rankingWeight: number;
}

/**
 * Cached, recomputable snapshot of a user's reputation. Exactly one document
 * per user. Always derivable from that user's `active` transactions (plus their
 * active strikes and moderation profiles) via
 * `reputationService.recalculateBalance`.
 *
 * The V1 fields (`total`, `positive`, `negative`, `breakdown`, `trustTier`,
 * `influence`, `reliability`) are RETAINED, unchanged in meaning, so existing
 * consumers keep working. The V2 axes below are additive and become the source
 * of decision gradually — the multidimensional model replaces a single score
 * that let contribution offset conduct.
 */
export interface IReputationBalance extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  /** Net lifetime total across all active transactions. */
  total: number;
  /** Sum of positive points only. */
  positive: number;
  /** Sum of negative points only (a negative number). */
  negative: number;
  breakdown: ReputationBreakdown;
  trustTier: TrustTier;
  influence: ReputationInfluence;
  reliability: ReputationReliability;
  personhood: ReputationPersonhoodSnapshot;
  contribution: ReputationContributionSnapshot;
  conduct: ReputationConductSnapshot;
  reporting: ReputationReportingSnapshot;
  reviewing: ReputationReviewingSnapshot;
  contextualInfluence: ReputationContextualInfluenceSnapshot;
  /** Most recent transaction folded into this snapshot. */
  lastTransactionId?: mongoose.Types.ObjectId;
  /** When this snapshot was last recomputed. */
  recalculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BreakdownSchema = new Schema<ReputationBreakdown>(
  {
    content: { type: Number, default: 0 },
    social: { type: Number, default: 0 },
    trust: { type: Number, default: 0 },
    moderation: { type: Number, default: 0 },
    physical: { type: Number, default: 0 },
    penalties: { type: Number, default: 0 },
  },
  { _id: false }
);

const InfluenceSchema = new Schema<ReputationInfluence>(
  {
    defaultWeight: { type: Number, default: 0 },
    reportWeight: { type: Number, default: 0 },
    moderationWeight: { type: Number, default: 0 },
    rankingFeedbackWeight: { type: Number, default: 0 },
  },
  { _id: false }
);

const ReliabilitySchema = new Schema<ReputationReliability>(
  {
    accurateReports: { type: Number, default: 0 },
    rejectedReports: { type: Number, default: 0 },
    reportAccuracyScore: { type: Number, default: 0 },
    abuseScore: { type: Number, default: 0 },
  },
  { _id: false }
);

const PersonhoodSnapshotSchema = new Schema<ReputationPersonhoodSnapshot>(
  {
    status: { type: String, enum: PERSONHOOD_STATUSES, default: 'unknown' },
    score: { type: Number, default: 0 },
  },
  { _id: false }
);

const ContributionSnapshotSchema = new Schema<ReputationContributionSnapshot>(
  {
    points: { type: Number, default: 0 },
    tier: { type: String, enum: CONTRIBUTION_TIERS, default: 'new' },
  },
  { _id: false }
);

const ConductSnapshotSchema = new Schema<ReputationConductSnapshot>(
  {
    standing: { type: String, enum: CONDUCT_STANDINGS, default: 'good' },
    activeRisk: { type: Number, default: 0 },
    activeStrikes: { type: Number, default: 0 },
    nextExpiryAt: { type: Date },
  },
  { _id: false }
);

const ReportingSnapshotSchema = new Schema<ReputationReportingSnapshot>(
  {
    reliability: { type: Number, default: 0.5 },
    confidence: { type: Number, default: 0 },
    confirmed: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
    malicious: { type: Number, default: 0 },
  },
  { _id: false }
);

const ReviewingSnapshotSchema = new Schema<ReputationReviewingSnapshot>(
  {
    globalReliability: { type: Number, default: 0.5 },
    categoryReliability: { type: Map, of: Number, default: () => new Map<string, number>() },
    languageReliability: { type: Map, of: Number, default: () => new Map<string, number>() },
  },
  { _id: false }
);

const ContextualInfluenceSchema = new Schema<ReputationContextualInfluenceSnapshot>(
  {
    reportPriorityWeight: { type: Number, default: 0 },
    reviewSelectionWeight: { type: Number, default: 0 },
    rankingWeight: { type: Number, default: 0 },
  },
  { _id: false }
);

const ReputationBalanceSchema = new Schema<IReputationBalance>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    total: {
      type: Number,
      default: 0,
    },
    positive: {
      type: Number,
      default: 0,
    },
    negative: {
      type: Number,
      default: 0,
    },
    breakdown: {
      type: BreakdownSchema,
      default: () => ({}),
    },
    trustTier: {
      type: String,
      enum: TRUST_TIERS,
      default: 'new',
      index: true,
    },
    influence: {
      type: InfluenceSchema,
      default: () => ({}),
    },
    reliability: {
      type: ReliabilitySchema,
      default: () => ({}),
    },
    personhood: {
      type: PersonhoodSnapshotSchema,
      default: () => ({}),
    },
    contribution: {
      type: ContributionSnapshotSchema,
      default: () => ({}),
    },
    conduct: {
      type: ConductSnapshotSchema,
      default: () => ({}),
    },
    reporting: {
      type: ReportingSnapshotSchema,
      default: () => ({}),
    },
    reviewing: {
      type: ReviewingSnapshotSchema,
      default: () => ({}),
    },
    contextualInfluence: {
      type: ContextualInfluenceSchema,
      default: () => ({}),
    },
    lastTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'ReputationTransaction',
    },
    recalculatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Leaderboard ordering.
ReputationBalanceSchema.index({ total: -1 });

// Conduct standing is a query dimension of its own: the reviewer pool excludes
// anyone under consequence, and Trust & Safety reads standing directly. Indexing
// it keeps that a scan of the matching rows rather than of every balance.
ReputationBalanceSchema.index({ 'conduct.standing': 1 });

export const ReputationBalance = mongoose.model<IReputationBalance>(
  'ReputationBalance',
  ReputationBalanceSchema
);

export default ReputationBalance;
