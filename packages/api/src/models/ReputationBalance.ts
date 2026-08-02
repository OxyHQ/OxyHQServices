import mongoose, { type Document, Schema } from 'mongoose';
import {
  CONDUCT_STANDINGS,
  CONTRIBUTION_TIERS,
  PERSONHOOD_STATUSES,
  TRUST_TIERS,
  type TrustTier,
} from '@oxyhq/contracts';
import type {
  ReputationBreakdown,
  ReputationConductSnapshot,
  ReputationContextualInfluenceSnapshot,
  ReputationContributionSnapshot,
  ReputationInfluence,
  ReputationPersonhoodSnapshot,
  ReputationReliability,
  ReputationReportingSnapshot,
  ReputationReviewingSnapshot,
} from '../db/schema/reputationBalances';

/**
 * The nine snapshot blocks are owned by `db/schema/reputationBalances.ts`,
 * beside the columns that store them. Re-imported here so this legacy model
 * still describes the same shapes without being the source of them.
 */
export type {
  ReputationBreakdown,
  ReputationConductSnapshot,
  ReputationContextualInfluenceSnapshot,
  ReputationContributionSnapshot,
  ReputationInfluence,
  ReputationPersonhoodSnapshot,
  ReputationReliability,
  ReputationReportingSnapshot,
  ReputationReviewingSnapshot,
};

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
