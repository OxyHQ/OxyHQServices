import mongoose, { type Document, Schema } from 'mongoose';
import {
  REPUTATION_DISPUTE_STATUSES,
  type ReputationDisputeStatus,
} from '../utils/reputation.constants';

/**
 * A user-initiated dispute against a specific reputation transaction (#217).
 *
 * Opening a dispute marks the target transaction `disputed`. Resolving it either
 * `accepted` (the transaction is reversed via a compensating entry) or
 * `rejected` (the transaction is restored to `active`).
 */
export interface IReputationDispute extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  /** The transaction being disputed. */
  transactionId: mongoose.Types.ObjectId;
  /** The user raising the dispute. */
  userId: mongoose.Types.ObjectId;
  /** Why the user believes the transaction is wrong. */
  reason: string;
  status: ReputationDisputeStatus;
  /** Optional supporting evidence (URLs / references). */
  evidence?: string[];
  resolvedAt?: Date;
  resolvedByUserId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ReputationDisputeSchema = new Schema<IReputationDispute>(
  {
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'ReputationTransaction',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: REPUTATION_DISPUTE_STATUSES,
      default: 'open',
      index: true,
    },
    evidence: {
      type: [String],
      default: undefined,
    },
    resolvedAt: {
      type: Date,
    },
    resolvedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

ReputationDisputeSchema.index({ userId: 1, status: 1 });

export const ReputationDispute = mongoose.model<IReputationDispute>(
  'ReputationDispute',
  ReputationDisputeSchema
);

export default ReputationDispute;
