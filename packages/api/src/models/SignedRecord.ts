import mongoose, { Document, Schema } from 'mongoose';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';

/**
 * SignedRecord (self-sovereign identity layer — B5)
 *
 * Append-only ledger of cryptographically-signed records a user publishes about
 * their own identity/profile (AtProto-flavoured signed records). Each row stores
 * the FULL signed envelope verbatim plus denormalised fields for indexing. Rows
 * are never mutated or deleted — a newer record simply supersedes an older one
 * (enforced by the monotonic `issuedAt` check in `signedRecord.service.ts`).
 *
 * `verified` is `true` only when the envelope passed full verification at write
 * time (signature valid, `publicKey` is a current verification method of the
 * subject, fresh + monotonic `issuedAt`).
 */
export interface ISignedRecord extends Document {
  /** The subject DID the record is about (`did:web:<domain>:u:<userId>`). */
  subjectDid: string;
  /** The Oxy account that owns the subject DID. */
  userId: mongoose.Types.ObjectId;
  type: 'identity' | 'profile';
  /** The complete signed envelope as published by the client. */
  envelope: SignedRecordEnvelope;
  /** The secp256k1 public key that signed the envelope (a current VM at write time). */
  publicKey: string;
  verified: boolean;
  createdAt: Date;
}

const SignedRecordSchema = new Schema<ISignedRecord>(
  {
    subjectDid: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['identity', 'profile'], required: true },
    // The envelope is contract-validated before it ever reaches the model, so
    // it is stored verbatim as a Mixed subdocument.
    envelope: { type: Schema.Types.Mixed, required: true },
    publicKey: { type: String, required: true },
    verified: { type: Boolean, default: false },
  },
  {
    // Append-only: stamp createdAt, never updatedAt.
    timestamps: { createdAt: true, updatedAt: false },
    strict: true,
    minimize: false,
  },
);

// Latest-record-per-(user, type) lookups.
SignedRecordSchema.index({ userId: 1, type: 1, createdAt: -1 });

export const SignedRecord = mongoose.model<ISignedRecord>('SignedRecord', SignedRecordSchema);
export default SignedRecord;
