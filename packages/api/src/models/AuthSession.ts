import mongoose, { Document, Schema } from "mongoose";

/**
 * AuthSession Model
 * 
 * Stores temporary authentication sessions for cross-app authentication.
 * When a third-party app wants to authenticate a user, it creates a session
 * and displays a QR code. The user scans this with Oxy Accounts to authorize.
 */
export interface IAuthSession extends Document {
  sessionToken: string;      // Unique token for this auth session
  appId: string;             // Identifier for the requesting app
  status: 'pending' | 'authorized' | 'expired' | 'cancelled';
  authorizedBy?: string;     // Public key of the user who authorized
  authorizedSessionId?: string; // The actual session ID after authorization
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AuthSessionSchema: Schema = new Schema(
  {
    sessionToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    appId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'authorized', 'expired', 'cancelled'],
      default: 'pending',
    },
    authorizedBy: {
      type: String, // Public key
      default: null,
    },
    authorizedSessionId: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index to automatically delete expired sessions after 1 hour
AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

// Compound index for efficient lookups
AuthSessionSchema.index({ sessionToken: 1, status: 1 });

export const AuthSession = mongoose.model<IAuthSession>("AuthSession", AuthSessionSchema);
export default AuthSession;


