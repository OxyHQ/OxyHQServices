import mongoose, { Document, Schema } from 'mongoose';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';

/**
 * ValidationVote (civic / Commons — Fase 2 Part B jury)
 *
 * A juror's SIGNED verdict on a {@link IValidationRequest}. The juror signs a
 * `validation_verdict` record with their own key (bound to the request id +
 * payload hash), so a vote cannot be forged or altered. One vote per
 * (request, validator) — the unique index makes a second submission an
 * idempotent no-op / conflict.
 *
 * `stakeWeight` snapshots the juror's capped influence at vote time; the tally
 * can weight by it. Reversed-outcome SLASHING reads the votes to find who
 * endorsed a verdict later found fraudulent.
 */
export interface IValidationVote extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  requestId: mongoose.Types.ObjectId;
  validatorUserId: mongoose.Types.ObjectId;
  verdict: 'valid' | 'invalid' | 'abstain';
  /** The full signed verdict envelope as submitted by the juror. */
  envelope: SignedRecordEnvelope;
  /** The juror's signing public key (a current VM at vote time). */
  publicKey: string;
  /** `recordId` (content address) of the verdict envelope — provenance ref. */
  recordId: string;
  /** The juror's capped influence weight at vote time. */
  stakeWeight: number;
  createdAt: Date;
}

const ValidationVoteSchema = new Schema<IValidationVote>(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'ValidationRequest', required: true, index: true },
    validatorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    verdict: { type: String, enum: ['valid', 'invalid', 'abstain'], required: true },
    envelope: { type: Schema.Types.Mixed, required: true },
    publicKey: { type: String, required: true },
    recordId: { type: String, required: true },
    stakeWeight: { type: Number, required: true, default: 1 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: true, minimize: false },
);

// One vote per juror per request.
ValidationVoteSchema.index({ requestId: 1, validatorUserId: 1 }, { unique: true });

export const ValidationVote = mongoose.model<IValidationVote>('ValidationVote', ValidationVoteSchema);
export default ValidationVote;
