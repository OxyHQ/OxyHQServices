import mongoose, { Document, Schema } from "mongoose";

/**
 * AuthCode Model
 *
 * Short-lived OAuth2 authorization codes for the authorization-code-with-PKCE
 * flow on `/auth/oauth/authorize` -> `/auth/oauth/token`. The user signs in via
 * the Oxy auth UI, approves the request, and we hand the third-party app a
 * single-use opaque code in the URL. The third-party app's backend then POSTs
 * the code (plus their client secret OR the PKCE `code_verifier`) to
 * `/auth/oauth/token` to receive an access token bound to a new session.
 *
 * Security notes:
 * - `codeHash` is stored, never the raw code (codes are bearer credentials).
 * - `codeChallenge` (PKCE S256) is required when no client secret is provided
 *   at exchange time. Public clients (SPAs, mobile apps) must always use PKCE.
 * - Codes are single-use: `usedAt` is set on first successful exchange and any
 *   subsequent attempt fails. RFC 6749 mandates revoking the issued tokens
 *   when an already-used code is replayed.
 * - 60s TTL — long enough for a network round-trip, short enough to limit the
 *   replay window if a code is leaked via referrer / browser history.
 * - `redirectUri` is bound at issue time and re-checked at exchange time;
 *   mismatch invalidates the code.
 */
export interface IAuthCode extends Document {
  /** SHA-256 hex digest of the raw authorization code. */
  codeHash: string;
  /** ObjectId of the user that approved this grant. */
  userId: mongoose.Types.ObjectId;
  /** Application ObjectId (string) the code was issued for. */
  appId: string;
  /** Exact redirect URI used at issue time — must match exchange request. */
  redirectUri: string;
  /** PKCE code challenge (S256). Optional for confidential clients. */
  codeChallenge?: string;
  /** PKCE code challenge method (only `S256` supported). */
  codeChallengeMethod?: 'S256';
  /** Optional OAuth scope list bound at issue time. */
  scopes: string[];
  /**
   * DeviceSession id from the authorizing bearer — threads cross-app OAuth
   * token exchange onto the same device doc instead of minting an isolated one.
   */
  deviceId?: string;
  /** Set when the code is exchanged. Single-use enforcement. */
  usedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AuthCodeSchema: Schema = new Schema(
  {
    codeHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    appId: {
      type: String,
      required: true,
      index: true,
    },
    redirectUri: {
      type: String,
      required: true,
    },
    codeChallenge: {
      type: String,
      default: null,
    },
    codeChallengeMethod: {
      type: String,
      enum: ['S256'],
      default: null,
    },
    scopes: {
      type: [String],
      default: [],
    },
    deviceId: {
      type: String,
      default: null,
    },
    usedAt: {
      type: Date,
      default: null,
      index: true,
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

// TTL — Mongo automatically prunes after expiry. We add a 5-minute pad so
// that we can still detect replay attempts on recently-expired codes during
// the grace window.
AuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });

export const AuthCode = mongoose.model<IAuthCode>('AuthCode', AuthCodeSchema);
export default AuthCode;
