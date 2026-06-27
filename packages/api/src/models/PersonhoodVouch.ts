import mongoose, { Document, Schema } from 'mongoose';

/**
 * PersonhoodVouch (civic / Commons — Fase 3 proof-of-personhood web-of-trust)
 *
 * One staked, SIGNED vouch in the web-of-trust: `voucherUserId` has put their own
 * standing on the line to assert that `subjectUserId` is a real, unique human.
 * The vouch is backed by a self-issued `personhood_vouch` signed record (whose
 * `recordId` is stored here) and a `stakeAmount` of skin-in-the-game: if the
 * subject is later proven fake (a failed random audit, or a reversed personhood
 * award), every ACTIVE voucher is SLASHED (`vouch_slashed`, -20) and their vouch
 * flips to `slashed` (see `slash.service` / `personhood.service`).
 *
 * Exactly one ACTIVE vouch per (voucher, subject) pair — the unique compound
 * index is the dedup backstop. The `{subjectUserId, status}` index drives the
 * recompute aggregation (the subject's active vouchers).
 */
export type PersonhoodVouchStatus = 'active' | 'slashed' | 'withdrawn';

export interface IPersonhoodVouch extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  /** The account making (and staking on) the vouch. */
  voucherUserId: mongoose.Types.ObjectId;
  /** The account being vouched for as a real person. */
  subjectUserId: mongoose.Types.ObjectId;
  /** Reputation points the voucher staked — the amount lost on a slash. */
  stakeAmount: number;
  /** The `recordId` of the voucher's signed `personhood_vouch` envelope. */
  recordId: string;
  status: PersonhoodVouchStatus;
  createdAt: Date;
  updatedAt: Date;
}

const PersonhoodVouchSchema = new Schema<IPersonhoodVouch>(
  {
    voucherUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subjectUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    stakeAmount: { type: Number, required: true, min: 0 },
    recordId: { type: String, required: true },
    status: {
      type: String,
      enum: ['active', 'slashed', 'withdrawn'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true, strict: true },
);

// One ACTIVE vouch per (voucher, subject) pair — the dedup backstop. Partial on
// `status: 'active'` so a withdrawn/slashed vouch leaves history yet the pair can
// be vouched for again later.
PersonhoodVouchSchema.index(
  { voucherUserId: 1, subjectUserId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
// Recompute aggregation: the subject's active vouchers.
PersonhoodVouchSchema.index({ subjectUserId: 1, status: 1 });

export const PersonhoodVouch = mongoose.model<IPersonhoodVouch>('PersonhoodVouch', PersonhoodVouchSchema);
export default PersonhoodVouch;
