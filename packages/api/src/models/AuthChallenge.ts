import mongoose, { type Document, Schema } from "mongoose";

/**
 * AuthChallenge Model
 * 
 * Stores temporary authentication challenges for the challenge-response
 * authentication flow. Challenges expire after 5 minutes.
 */
export interface IAuthChallenge extends Document {
  publicKey: string;
  challenge: string;
  /**
   * What the challenge may be spent on. Additive (default `'signin'`) so
   * existing signin flows are unaffected. Purpose-scoped consumers (e.g. key
   * rotation, which requires `'rotate_key'`) filter on this so a challenge
   * minted for one flow can never be redeemed by another.
   */
  purpose: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

const AuthChallengeSchema: Schema = new Schema(
  {
    publicKey: {
      type: String,
      required: true,
    },
    challenge: {
      type: String,
      required: true,
      unique: true,
    },
    purpose: {
      type: String,
      default: 'signin',
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    used: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index to automatically delete expired challenges
AuthChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for lookups
AuthChallengeSchema.index({ publicKey: 1, challenge: 1 });

export const AuthChallenge = mongoose.model<IAuthChallenge>("AuthChallenge", AuthChallengeSchema);
export default AuthChallenge;


