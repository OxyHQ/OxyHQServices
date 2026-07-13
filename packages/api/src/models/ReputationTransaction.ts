import mongoose, { type Document, Schema } from 'mongoose';
import {
  REPUTATION_CATEGORIES,
  REPUTATION_TRANSACTION_STATUSES,
  REPUTATION_TARGET_ENTITY_TYPES,
  type ReputationCategory,
  type ReputationTransactionStatus,
  type ReputationTargetEntityType,
} from '../utils/reputation.constants';

/**
 * A single immutable entry in the reputation ledger (#217).
 *
 * Transactions are NEVER deleted. A correction is expressed as either a
 * compensating REVERSAL transaction (`reverseTransaction` — the original is
 * marked `reversed` and a new `active` transaction with negated points and
 * `reversedTransactionId` pointing at the original is appended) or a VOID
 * (`voidTransaction` — the original is marked `voided` and simply excluded from
 * the balance, with no compensating entry).
 *
 * A user's balance is always derivable by aggregating their `active`
 * transactions; `ReputationBalance` is a cache of that aggregation.
 */
export interface IReputationTransaction extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  /** Subject of the reputation change — the user whose balance moves. */
  userId: mongoose.Types.ObjectId;
  /** Signed point delta. Positive awards, negative penalties/reversals. */
  points: number;
  /** The rule/action key that produced this transaction (e.g. `post_created`). */
  actionType: string;
  /** Category bucket the points fall into (drives the balance breakdown). */
  category: ReputationCategory;
  /** Canonical source application that reported the action, if any. */
  applicationId?: mongoose.Types.ObjectId;
  /** The specific credential used by the source application, if any. */
  credentialId?: mongoose.Types.ObjectId;
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
  reversedTransactionId?: mongoose.Types.ObjectId;
  /** Human-readable reason / note. */
  reason?: string;
  /** Free-form structured metadata from the source system. */
  metadata?: Record<string, unknown>;
  /** The user who caused this change (e.g. the liker, the reporting user, staff). */
  createdByUserId?: mongoose.Types.ObjectId;
  /** Staff/service principal who reviewed (reversed/voided/resolved) this txn. */
  reviewedByUserId?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReputationTransactionSchema = new Schema<IReputationTransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    points: {
      type: Number,
      required: true,
    },
    actionType: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: REPUTATION_CATEGORIES,
      required: true,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      index: true,
    },
    credentialId: {
      type: Schema.Types.ObjectId,
      ref: 'ApplicationCredential',
    },
    sourceActionId: {
      type: String,
      trim: true,
    },
    sourceActionType: {
      type: String,
      trim: true,
    },
    targetEntityId: {
      type: String,
      trim: true,
    },
    targetEntityType: {
      type: String,
      enum: REPUTATION_TARGET_ENTITY_TYPES,
    },
    status: {
      type: String,
      enum: REPUTATION_TRANSACTION_STATUSES,
      default: 'active',
      index: true,
    },
    reversedTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'ReputationTransaction',
    },
    reason: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Balance recomputation reads active transactions for a user.
ReputationTransactionSchema.index({ userId: 1, status: 1 });
// Ledger listing is newest-first per user.
ReputationTransactionSchema.index({ userId: 1, createdAt: -1 });
// Per-application usage / auditing.
ReputationTransactionSchema.index({ applicationId: 1 });
// Idempotency guard: a given (applicationId, sourceActionId) pair can award at
// most once. Sparse + partial so transactions that lack either field (manual /
// staff awards) are exempt from the uniqueness constraint entirely.
ReputationTransactionSchema.index(
  { applicationId: 1, sourceActionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      applicationId: { $exists: true },
      sourceActionId: { $exists: true },
    },
  }
);

export const ReputationTransaction = mongoose.model<IReputationTransaction>(
  'ReputationTransaction',
  ReputationTransactionSchema
);

export default ReputationTransaction;
