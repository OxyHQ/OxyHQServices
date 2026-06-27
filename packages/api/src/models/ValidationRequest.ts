import mongoose, { Document, Schema } from 'mongoose';

/**
 * ValidationRequest (civic / Commons — Fase 2 Part B jury)
 *
 * A request for a randomly-selected jury of trusted peers to validate a claim
 * about `subjectUserId`. The jury is chosen by `validator.service.selectValidators`
 * with anti-collusion exclusions; the selection is AUDITABLE — `rngSeed` +
 * `candidateSnapshot` record exactly why these validators were drawn.
 *
 * Lifecycle: `pending` → (`quorum_met`) → `validated` | `rejected`, or `expired`
 * if it never reached quorum before `expiresAt`. On `validated` the subject is
 * awarded `peer_validated` (MEDIUM, 8 pt) referencing the winning verdicts; that
 * award's txn is recorded in `resolvedTxnId` so it can be reversed (and the
 * endorsing jurors slashed) if later found fraudulent.
 */
export interface IValidationRequest extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  /** The user whose claim is being validated. */
  subjectUserId: mongoose.Types.ObjectId;
  /** What is being validated (drives the award + slash). */
  actionType: string;
  /** The opening application (service-token), if any. */
  applicationId?: mongoose.Types.ObjectId;
  /** Idempotency / dedup key for the underlying action. */
  sourceActionId: string;
  /** The claim payload the jurors inspect. */
  payload: Record<string, unknown>;
  /** SHA-256 of the canonical payload — the verdict binds to this. */
  payloadHash: string;
  status: 'pending' | 'quorum_met' | 'validated' | 'rejected' | 'expired';
  /** The selected jury (account ids). */
  selectedValidatorIds: mongoose.Types.ObjectId[];
  /** Votes required to tally. */
  quorum: number;
  /** Votes required on the winning side (supermajority for high-value). */
  threshold: number;
  /** Whether this request requires the supermajority threshold. */
  highValue: boolean;
  /** Hex RNG seed used for the weighted-reservoir selection (audit). */
  rngSeed: string;
  /** Snapshot of the candidate pool {id, weight} at selection time (audit). */
  candidateSnapshot: Array<{ userId: string; weight: number }>;
  expiresAt: Date;
  outcome?: 'validated' | 'rejected';
  /** The `peer_validated` txn created on a `validated` outcome. */
  resolvedTxnId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ValidationRequestSchema = new Schema<IValidationRequest>(
  {
    subjectUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actionType: { type: String, required: true },
    applicationId: { type: Schema.Types.ObjectId, ref: 'Application' },
    sourceActionId: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    payloadHash: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'quorum_met', 'validated', 'rejected', 'expired'],
      default: 'pending',
      index: true,
    },
    selectedValidatorIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    quorum: { type: Number, required: true },
    threshold: { type: Number, required: true },
    highValue: { type: Boolean, default: false },
    rngSeed: { type: String, required: true },
    candidateSnapshot: { type: [{ userId: String, weight: Number, _id: false }], default: [] },
    expiresAt: { type: Date, required: true },
    outcome: { type: String, enum: ['validated', 'rejected'] },
    resolvedTxnId: { type: Schema.Types.ObjectId, ref: 'ReputationTransaction' },
  },
  { timestamps: true, strict: true, minimize: false },
);

// Inbox lookups: a juror's pending requests.
ValidationRequestSchema.index({ selectedValidatorIds: 1, status: 1, expiresAt: 1 });
// Sweep: pending requests past expiry.
ValidationRequestSchema.index({ status: 1, expiresAt: 1 });
// Dedup lookups for the same action (open-request dedup is enforced in the
// service — partialFilterExpression does not portably support `$in`).
ValidationRequestSchema.index({ sourceActionId: 1, status: 1 });

export const ValidationRequest = mongoose.model<IValidationRequest>('ValidationRequest', ValidationRequestSchema);
export default ValidationRequest;
