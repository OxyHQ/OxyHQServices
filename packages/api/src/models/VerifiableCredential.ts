import mongoose, { Document, Schema } from 'mongoose';
import type { CredentialStatus } from '@oxyhq/contracts';

/**
 * VerifiableCredential (civic / Commons — Fase 4)
 *
 * A holder-collectible index over a verifiable credential (VC): an issuer (an
 * employer / course / app that holds a DID) has cryptographically attested a
 * claim ABOUT a holder. The CANONICAL, cryptographic proof is the underlying
 * signed `credential` record on the {@link SignedRecord} ledger — this document
 * is the queryable projection of it (so a holder can list their credentials and
 * anyone can verify one by `recordId`). `recordId` points 1:1 at that signed
 * record; `claims`/`types` are denormalized for display, but verification ALWAYS
 * recomputes the canonical signing input from the stored envelope (the signed
 * source of truth) — never from this projection.
 *
 * Two issuance modes populate this model (both verify against the ISSUER DID's
 * current verification method offline):
 *  - user-issued: `issuerUserId` is the issuing account; `issuerDid` is that
 *    user's DID; the signed envelope is self-issued on the issuer's hash chain.
 *  - app/org-issued (internal seam): `issuerUserId` is absent; `issuerDid` is
 *    `OXY_DID` (the Oxy custodial key signs on behalf of an Application DID); the
 *    signed envelope lives on the holder's chain (mirrors `reputation_attestation`).
 *
 * Rows are mutated only to flip `status` (active → revoked/expired) — the signed
 * record itself is append-only and never altered.
 */
export interface IVerifiableCredential extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  /** The account that holds the credential (resolved from the holder DID). */
  holderUserId: mongoose.Types.ObjectId;
  /** The holder's DID — the W3C `credentialSubject.id` the claim is about. */
  holderDid: string;
  /** The issuing account, for user-issued credentials (absent for org-issued). */
  issuerUserId?: mongoose.Types.ObjectId;
  /** The issuer's DID — whose CURRENT verification method must verify the proof. */
  issuerDid: string;
  /** VC type tags, e.g. `['VerifiableCredential', 'EmploymentCredential']`. */
  types: string[];
  /** The arbitrary, issuer-asserted claim set about the holder. */
  claims: Record<string, unknown>;
  /** The `recordId` of the signed `credential` record (the cryptographic proof). */
  recordId: string;
  status: CredentialStatus;
  /** When the issuer signed the credential (epoch ms, from the envelope). */
  issuedAt: Date;
  /** Optional expiry (epoch ms, part of the signed bytes). */
  expiresAt?: Date;
  /** When the issuer revoked the credential, if revoked. */
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const VerifiableCredentialSchema = new Schema<IVerifiableCredential>(
  {
    holderUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    holderDid: { type: String, required: true },
    issuerUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    issuerDid: { type: String, required: true, index: true },
    types: { type: [String], required: true },
    // Arbitrary issuer-asserted claims — stored verbatim as a Mixed subdocument
    // (the signed envelope on the SignedRecord ledger is the authoritative copy).
    claims: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    recordId: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['active', 'revoked', 'expired'],
      default: 'active',
      required: true,
    },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true, minimize: false },
);

// A holder's credentials, filterable by status (the Commons "my credentials" view).
VerifiableCredentialSchema.index({ holderUserId: 1, status: 1 });

export const VerifiableCredential = mongoose.model<IVerifiableCredential>(
  'VerifiableCredential',
  VerifiableCredentialSchema,
);
export default VerifiableCredential;
