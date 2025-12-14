import mongoose, { Document, Schema } from "mongoose";

/**
 * AuthChallenge Model
 * 
 * Stores temporary authentication challenges for the challenge-response
 * authentication flow. Challenges expire after 5 minutes.
 */
export interface IAuthChallenge extends Document {
  publicKey: string;
  challenge: string;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

const AuthChallengeSchema: Schema = new Schema(
  {
    publicKey: {
      type: String,
      required: true,
      index: true,
    },
    challenge: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
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


