import mongoose, { Document, Schema } from "mongoose";

/**
 * AuthSession Model
 *
 * Stores temporary authentication sessions for cross-app authentication.
 * When a third-party app wants to authenticate a user, it creates a session
 * and displays a QR code. The user scans this with Oxy Accounts to authorize.
 *
 * Lifecycle:
 *   pending    -> the SDK has created the session and is waiting
 *   authorized -> another authenticated device has approved it via
 *                 POST /auth/session/authorize/:sessionToken (requires bearer auth)
 *   consumed   -> the originating SDK has exchanged the sessionToken for
 *                 the first access token via POST /auth/session/claim
 *                 (single-use, enforced via atomic findOneAndUpdate)
 *   expired    -> TTL elapsed before authorization completed
 *   cancelled  -> user denied the authorization
 *
 * App identity:
 *   `applicationId` is the canonical, required reference to a registered
 *                   `Application` record. Every cross-app auth session is bound
 *                   to a real Application (resolved from a `clientId` or
 *                   `applicationId` at create time) — there is no free-form app
 *                   label. It links the session to authoritative, sanitized app
 *                   metadata (name/icon/badge/scopes) for the consent UI.
 */
export type AuthSessionStatus = 'pending' | 'authorized' | 'consumed' | 'expired' | 'cancelled';

export interface IAuthSession extends Document {
  sessionToken: string;      // Unique token for this auth session (128-bit secret held only by the originating client)
  /**
   * Public single-use approval handle carried in the QR / deep link
   * (`oxycommons://approve?code=<authorizeCode>`). Unlike `sessionToken` it is
   * SAFE to display: the Commons vault approves with it via
   * `POST /auth/session/authorize-signed/:authorizeCode` (key-signed, no
   * bearer), and the originating client still claims the result with the secret
   * `sessionToken` it alone holds. 128-bit hex.
   */
  authorizeCode?: string;
  /** The browser Origin the session was created from, shown in the approval UI. */
  boundOrigin?: string;
  /** Random nonce embedded in the QR payload (audit only; not a binding check). */
  challengeNonce?: string;
  applicationId: mongoose.Types.ObjectId; // Canonical, required reference to a registered Application
  status: AuthSessionStatus;
  authorizedBy?: string;     // Public key of the user who authorized
  authorizedUserId?: mongoose.Types.ObjectId; // MongoDB user ID of the authorizing user
  authorizedSessionId?: string; // The actual session ID after authorization
  consumedAt?: Date;         // Timestamp when the sessionToken was exchanged for a token
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
    // Public approval handle. Sparse-unique (older rows predate it and have
    // none) — never `default: null`, or sparse uniqueness would collide.
    authorizeCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    boundOrigin: {
      type: String,
      default: null,
    },
    challengeNonce: {
      type: String,
      default: null,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'authorized', 'consumed', 'expired', 'cancelled'],
      default: 'pending',
    },
    authorizedBy: {
      type: String, // Public key
      default: null,
    },
    authorizedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    authorizedSessionId: {
      type: String,
      default: null,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
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

