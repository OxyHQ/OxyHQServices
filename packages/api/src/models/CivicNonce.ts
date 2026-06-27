import mongoose, { Document, Schema } from 'mongoose';

/**
 * CivicNonce (civic / Commons — Fase 2)
 *
 * Single-use nonce store for civic flows that need replay protection — first
 * the real-life counterparty attestation (`oxydni://attest?…&nonce=…&exp=…`).
 *
 * The nonce is generated client-side (embedded in the QR the subject shows) and
 * recorded here on FIRST use (the counterparty's `POST /civic/attestations`).
 * The unique `nonceHash` index makes the first submission win and every replay
 * fail with a duplicate-key error — so a counterparty cannot submit the same
 * signed attestation twice, and a stolen envelope cannot be re-played. We store
 * only the SHA-256 of the raw nonce, never the raw value.
 *
 * TTL prunes consumed/expired rows automatically. `purpose` namespaces the nonce
 * (the same raw value used for two different flows never collides because the
 * hash is salted by purpose at the call site).
 */
export interface ICivicNonce extends Document {
  /** SHA-256 hash of the raw nonce (salted by purpose at the call site). */
  nonceHash: string;
  /** The civic flow this nonce belongs to (e.g. `real_life_attestation`). */
  purpose: string;
  /** The subject the nonce was issued about (the user being attested). */
  subjectUserId?: mongoose.Types.ObjectId;
  expiresAt: Date;
  createdAt: Date;
}

const CivicNonceSchema = new Schema<ICivicNonce>(
  {
    nonceHash: { type: String, required: true, unique: true, index: true },
    purpose: { type: String, required: true },
    subjectUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// TTL — prune consumed / expired entries automatically a short while after they
// expire (keeps the single-use window enforced without unbounded growth).
CivicNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 600 });

export const CivicNonce = mongoose.model<ICivicNonce>('CivicNonce', CivicNonceSchema);
export default CivicNonce;
