import mongoose, { Document, Schema } from 'mongoose';

/**
 * ValidatorAffinity (civic / Commons — Fase 2 Part B collusion throttle)
 *
 * Tracks how often a PAIR of validators has served on the same jury and voted
 * the same way ("co-vote"). A high co-vote count is a collusion-cluster signal,
 * so `selectValidators` skips a candidate that already has high affinity with an
 * already-selected juror — breaking up rings that try to validate each other.
 *
 * The pair is stored canonically (`validatorA` is the lexicographically smaller
 * id) so each unordered pair has exactly one row.
 */
export interface IValidatorAffinity extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  validatorA: mongoose.Types.ObjectId;
  validatorB: mongoose.Types.ObjectId;
  coVoteCount: number;
  lastCoVoteAt: Date;
}

const ValidatorAffinitySchema = new Schema<IValidatorAffinity>(
  {
    validatorA: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    validatorB: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    coVoteCount: { type: Number, required: true, default: 0 },
    lastCoVoteAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false, strict: true },
);

ValidatorAffinitySchema.index({ validatorA: 1, validatorB: 1 }, { unique: true });

export const ValidatorAffinity = mongoose.model<IValidatorAffinity>('ValidatorAffinity', ValidatorAffinitySchema);
export default ValidatorAffinity;
