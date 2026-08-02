import mongoose, { type Document, Schema, type Types } from 'mongoose';

/**
 * WebauthnChallenge Model
 *
 * Stores the single-use challenge issued by `generateRegistrationOptions` /
 * `generateAuthenticationOptions` for a WebAuthn ceremony. Mirrors
 * `AuthChallenge`: the `challenge` is unique, a TTL index reaps expired rows,
 * and `used` is flipped atomically the moment the ceremony's verify step burns
 * it (so a challenge can never be replayed).
 *
 * `type` distinguishes the registration ceremony from the authentication one.
 * `userId` is present when the ceremony is bound to a known account
 * (linking a passkey to a signed-in user, or a username-first login); it is
 * absent for prospective signups and usernameless/discoverable logins.
 */
export interface IWebauthnChallenge extends Document {
  challenge: string;
  type: 'registration' | 'authentication';
  userId?: Types.ObjectId;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

const WebauthnChallengeSchema: Schema = new Schema(
  {
    challenge: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      enum: ['registration', 'authentication'],
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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

// TTL index to automatically delete expired challenges.
WebauthnChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WebauthnChallenge = mongoose.model<IWebauthnChallenge>(
  'WebauthnChallenge',
  WebauthnChallengeSchema
);
export default WebauthnChallenge;
