import mongoose, { type Document, Schema } from 'mongoose';
import { TRUST_TIERS, type TrustTier } from '../utils/reputation.constants';

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
 * Cached, recomputable snapshot of a user's reputation. Exactly one document
 * per user. Always derivable from that user's `active` transactions via
 * `reputationService.recalculateBalance`.
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

export const ReputationBalance = mongoose.model<IReputationBalance>(
  'ReputationBalance',
  ReputationBalanceSchema
);

export default ReputationBalance;
