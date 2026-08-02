import mongoose, { type Document, Schema } from 'mongoose';
import type { PersonhoodBreakdown } from '../db/schema/personhoodStatuses';

/**
 * PersonhoodStatus (civic / Commons — Fase 3)
 *
 * Cached, recomputable snapshot of a user's proof-of-personhood — the analogue
 * of `ReputationBalance` for the web-of-trust. Exactly one document per user,
 * always re-derivable from the user's active `PersonhoodVouch`es, real-life
 * attestations, biometric signal, and sybil heuristics via
 * `personhood.service.recomputePersonhood` (which feeds the pure
 * `personhoodDerive.personhoodScore`). `isRealPerson` is mirrored onto
 * `User.verified` so the existing reputation `deriveTrustTier` promotes the
 * account to the `verified` tier.
 */

/**
 * The signal sub-scores behind the personhood score (audit / UI breakdown).
 *
 * Owned by `db/schema/personhoodStatuses.ts`, beside the `breakdown_*` columns
 * that store it. Re-imported here so this legacy model still describes the same
 * shape without being the source of it.
 */
export type { PersonhoodBreakdown };

export interface IPersonhoodStatus extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  /** Personhood score in [0,1]. */
  score: number;
  /** `score >= θ` — the headline "is a real person" verdict. */
  isRealPerson: boolean;
  /** Count of active vouches in the web-of-trust for this user. */
  vouchCount: number;
  /** Count of real-life counterparty attestations for this user. */
  realLifeCount: number;
  /** Whether an on-device biometric gate is bound to this account. */
  biometricBound: boolean;
  /** The [0,1] sybil penalty applied at the last recompute. */
  sybilPenalty: number;
  breakdown: PersonhoodBreakdown;
  updatedAt: Date;
  createdAt: Date;
}

const BreakdownSchema = new Schema<PersonhoodBreakdown>(
  {
    vouchSignal: { type: Number, default: 0 },
    realLifeSignal: { type: Number, default: 0 },
    biometricSignal: { type: Number, default: 0 },
    evidence: { type: Number, default: 0 },
    sybilPenalty: { type: Number, default: 0 },
    seed: { type: Boolean, default: false },
  },
  { _id: false },
);

const PersonhoodStatusSchema = new Schema<IPersonhoodStatus>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    score: { type: Number, default: 0, index: true },
    isRealPerson: { type: Boolean, default: false, index: true },
    vouchCount: { type: Number, default: 0 },
    realLifeCount: { type: Number, default: 0 },
    biometricBound: { type: Boolean, default: false },
    sybilPenalty: { type: Number, default: 0 },
    breakdown: { type: BreakdownSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const PersonhoodStatus = mongoose.model<IPersonhoodStatus>('PersonhoodStatus', PersonhoodStatusSchema);
export default PersonhoodStatus;
