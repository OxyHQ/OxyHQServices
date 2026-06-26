import mongoose, { Document, Schema } from 'mongoose';

/**
 * RepoHead (self-sovereign identity layer — F0.2 per-subject hash chain)
 *
 * The O(1) chain-head pointer for a subject's signed-record chain. EXACTLY ONE
 * document per user. It lets the verifier check chain continuity in constant
 * time (`env.prev === head.headRecordId && env.seq === head.seq + 1`) without
 * scanning the append-only {@link ISignedRecord} ledger, and lets a client fetch
 * the current head before signing the next v2 record.
 *
 * The head is advanced transactionally together with the `SignedRecord` insert
 * in `signedRecord.service.ts` (`verifyAndStoreRecord`). The unique `userId`
 * index keeps it a singleton; the unique `{userId, seq}` index on `SignedRecord`
 * is the concurrency backstop that serializes the multi-device write race.
 */
export interface IRepoHead extends Document {
  /** The Oxy account that owns this chain (one head per user). */
  userId: mongoose.Types.ObjectId;
  /** The subject DID the chain is about (`did:web:<domain>:u:<userId>`). */
  subjectDid: string;
  /** The `seq` of the head (latest) record in the chain. */
  seq: number;
  /** The `recordId` (content address) of the head record. */
  headRecordId: string;
  /** Total number of chained records appended so far. */
  recordCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const RepoHeadSchema = new Schema<IRepoHead>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    subjectDid: { type: String, required: true },
    seq: { type: Number, required: true },
    headRecordId: { type: String, required: true },
    recordCount: { type: Number, required: true, default: 0 },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    strict: true,
    minimize: false,
  },
);

export const RepoHead = mongoose.model<IRepoHead>('RepoHead', RepoHeadSchema);
export default RepoHead;
