import mongoose, { type Document, Schema } from 'mongoose';
import type { VerifiedDomainMethod } from './User';

/**
 * DomainVerification (self-sovereign identity layer — B7)
 *
 * A PENDING custom-domain ownership challenge. Mirrors `AuthChallenge`: a short
 * single-purpose token with a TTL index that auto-expires the row. Once the user
 * proves ownership (DNS-TXT or `/.well-known/oxy-domain`) the proven domain is
 * pushed onto `User.verifiedDomains` and this pending row is deleted, so the
 * collection only ever holds in-flight challenges.
 *
 * One pending challenge per `(userId, domain)` — re-requesting regenerates the
 * token via upsert.
 */
export interface IDomainVerification extends Document {
  userId: mongoose.Types.ObjectId;
  domain: string;
  token: string;
  /** The method that ultimately satisfied the challenge (set at verify time). */
  method?: VerifiedDomainMethod;
  status: 'pending';
  expiresAt: Date;
  createdAt: Date;
}

const DomainVerificationSchema = new Schema<IDomainVerification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    domain: { type: String, required: true, lowercase: true, trim: true },
    token: { type: String, required: true },
    method: { type: String, enum: ['dns-txt', 'well-known'] },
    status: { type: String, enum: ['pending'], default: 'pending' },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    strict: true,
  },
);

// One in-flight challenge per (user, domain).
DomainVerificationSchema.index({ userId: 1, domain: 1 }, { unique: true });
// TTL index — auto-delete expired challenges (mirrors AuthChallenge).
DomainVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DomainVerification = mongoose.model<IDomainVerification>(
  'DomainVerification',
  DomainVerificationSchema,
);
export default DomainVerification;
