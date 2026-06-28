import mongoose, { Document, Schema } from 'mongoose';

/**
 * NodeIngestWitness (self-sovereign identity layer — F5b node→Oxy ingest)
 *
 * An append-only, Oxy-COUNTER-SIGNED witness over each signed record Oxy ingests
 * from a user's personal data node. When the background ingest worker mirrors a
 * record (content address `recordId`) from a node into Oxy's `SignedRecord`
 * store, it ALSO produces a small `ES256K-DER-SHA256` signature over
 * `canonicalize({ recordId, userId, ingestedAt })` using the Oxy custodial key
 * (`OXY_PRIVATE_KEY`, the verification method of `OXY_DID`).
 *
 * ## Why a counter-sign
 *
 * The node holds the user's own signing key. If that key were ever stolen, an
 * attacker could re-sign a DIFFERENT history and present it as authentic. This
 * witness binds the FIRST recordId Oxy ever saw at a given content address to a
 * timestamp under Oxy's independent key — an immutable, third-party attestation
 * of "Oxy observed this exact record at this time". A later silent rewrite can
 * no longer claim the old content never existed: the witness proves it did.
 *
 * One witness per `recordId` (unique) — witnessing is idempotent, so a record
 * re-pulled on a later sweep is never double-witnessed. The store is never
 * mutated or deleted.
 */
export interface INodeIngestWitness extends Document {
  /** The Oxy account whose chain the witnessed record belongs to. */
  userId: mongoose.Types.ObjectId;
  /** The content address (sha256 of the canonical signing input) Oxy witnessed. */
  recordId: string;
  /** DER-encoded secp256k1 signature by the Oxy custodial key over the witness input. */
  witnessSignature: string;
  /** When Oxy first ingested + witnessed this recordId (ms epoch). */
  ingestedAt: number;
  createdAt: Date;
}

const NodeIngestWitnessSchema = new Schema<INodeIngestWitness>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recordId: { type: String, required: true, unique: true },
    witnessSignature: { type: String, required: true },
    ingestedAt: { type: Number, required: true },
  },
  {
    // Append-only: stamp createdAt, never updatedAt.
    timestamps: { createdAt: true, updatedAt: false },
    strict: true,
    minimize: false,
  },
);

// Per-user audit reads (newest first).
NodeIngestWitnessSchema.index({ userId: 1, createdAt: -1 });

export const NodeIngestWitness = mongoose.model<INodeIngestWitness>(
  'NodeIngestWitness',
  NodeIngestWitnessSchema,
);
export default NodeIngestWitness;
