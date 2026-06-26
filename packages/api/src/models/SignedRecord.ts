import mongoose, { Document, Schema } from 'mongoose';
import type { SignedRecordEnvelope, SignedRecordType } from '@oxyhq/contracts';

/**
 * SignedRecord (self-sovereign identity layer — B5; F0.2 per-subject hash chain)
 *
 * Append-only ledger of cryptographically-signed records a user publishes about
 * their own identity/profile/civic facts (AtProto-flavoured signed records).
 * Each row stores the FULL signed envelope verbatim plus denormalised fields for
 * indexing. Rows are never mutated or deleted — a newer record simply supersedes
 * an older one (enforced by the monotonic `issuedAt` check in
 * `signedRecord.service.ts`).
 *
 * `verified` is `true` only when the envelope passed full verification at write
 * time (signature valid, `publicKey` is a current verification method of the
 * subject, fresh + monotonic `issuedAt`, and — for v2 — chain continuity).
 *
 * ## v2 hash chain (F0.2)
 *
 * v2 envelopes carry a per-subject hash chain ("personal blockchain" of a single
 * signer, no consensus/mining): `seq` (strictly-increasing per subject), `prev`
 * (the `recordId` of the previous record, `null` at genesis), and an AtProto-style
 * record key — `collection` + `rkey` on the wire — for materialization + LWW.
 * `recordId` is the SHA-256 of the canonical signing input (`@oxyhq/core`'s
 * `computeRecordId`) — the content address that the NEXT record's `prev`
 * references.
 *
 * The wire/envelope field is named `collection`, but the DENORMALIZED column on
 * this model is `nsid` (the AtProto term, "namespaced id") — `collection` is a
 * reserved Mongoose `Document` member, so denormalizing it under a distinct name
 * keeps the document type clean. The signed envelope (stored verbatim in
 * `envelope`) is untouched.
 *
 * v1 rows (every `identity`/`profile` record already in production) carry NONE of
 * the chain fields. They stay valid because `seq`/`prev`/`recordId`/`nsid`/`rkey`
 * are optional and the chain indexes are PARTIAL (they only cover rows where the
 * field exists), so a unique `recordId`/`{userId,seq}` index never collides over
 * the absent v1 fields.
 */
export interface ISignedRecord extends Document {
  /** The subject DID the record is about (`did:web:<domain>:u:<userId>`). */
  subjectDid: string;
  /** The Oxy account that owns the subject DID. */
  userId: mongoose.Types.ObjectId;
  type: SignedRecordType;
  /** The complete signed envelope as published by the client. */
  envelope: SignedRecordEnvelope;
  /** The secp256k1 public key that signed the envelope (a current VM at write time). */
  publicKey: string;
  verified: boolean;
  /** v2 only: strictly-increasing sequence number for this subject's chain. */
  seq?: number;
  /** v2 only: `recordId` of the previous record in the chain, `null` at genesis. */
  prev?: string | null;
  /** v2 only: content address (sha256 of the canonical signing input). UNIQUE. */
  recordId?: string;
  /**
   * v2 only: AtProto-style collection namespace / NSID (e.g. `app.oxy.identity`).
   * Denormalized from the envelope's `collection` field (renamed here to avoid
   * the reserved Mongoose `Document.collection` member).
   */
  nsid?: string;
  /** v2 only: AtProto-style record key within the collection (e.g. `self`). */
  rkey?: string;
  createdAt: Date;
}

const SignedRecordSchema = new Schema<ISignedRecord>(
  {
    subjectDid: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'identity',
        'profile',
        'reputation_attestation',
        'real_life_attestation',
        'validation_verdict',
        'personhood_vouch',
        'credential',
        'node',
      ],
      required: true,
    },
    // The envelope is contract-validated before it ever reaches the model, so
    // it is stored verbatim as a Mixed subdocument.
    envelope: { type: Schema.Types.Mixed, required: true },
    publicKey: { type: String, required: true },
    verified: { type: Boolean, default: false },
    // v2 hash-chain fields (absent on v1 rows). `nsid` is the denormalized
    // envelope `collection` (renamed to avoid the reserved Mongoose member).
    seq: { type: Number },
    prev: { type: String, default: undefined },
    recordId: { type: String },
    nsid: { type: String },
    rkey: { type: String },
  },
  {
    // Append-only: stamp createdAt, never updatedAt.
    timestamps: { createdAt: true, updatedAt: false },
    strict: true,
    minimize: false,
  },
);

// Latest-record-per-(user, type) lookups (v1 + v2).
SignedRecordSchema.index({ userId: 1, type: 1, createdAt: -1 });

// v2 chain: globally-unique content address. Partial so the absent v1 `recordId`
// never collides (Mongo treats a missing field as null, which would otherwise
// dupe across every v1 row).
SignedRecordSchema.index(
  { recordId: 1 },
  { unique: true, partialFilterExpression: { recordId: { $type: 'string' } } },
);

// v2 chain: one record per (user, seq) — the concurrency backstop for the
// multi-device race (the loser of two concurrent writes at the same seq gets a
// duplicate-key error and re-reads the head). Partial so v1 rows (no `seq`) are
// excluded. Also serves ordered `getLogSince` pagination.
SignedRecordSchema.index(
  { userId: 1, seq: 1 },
  { unique: true, partialFilterExpression: { seq: { $type: 'number' } } },
);

// v2 materialization: latest verified record for an AtProto-style (nsid, rkey)
// key. Partial so v1 rows are excluded from this index.
SignedRecordSchema.index(
  { userId: 1, nsid: 1, rkey: 1, createdAt: -1 },
  { partialFilterExpression: { nsid: { $type: 'string' } } },
);

export const SignedRecord = mongoose.model<ISignedRecord>('SignedRecord', SignedRecordSchema);
export default SignedRecord;
