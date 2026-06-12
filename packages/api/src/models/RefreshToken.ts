import mongoose, { Document, Schema } from "mongoose";

/**
 * RefreshToken Model
 *
 * Backs the first-party httpOnly refresh-token cookie that enables secure
 * cold-boot session persistence. When a user signs in (password, FedCM, or
 * public-key flow) the server mints an opaque refresh token, stores ONLY its
 * SHA-256 hash here, and drops the raw token into an httpOnly + Secure cookie
 * scoped to `/auth` (so it reaches `/auth/session`, `/auth/refresh`, and
 * `/auth/logout`). On a cold boot the browser replays the cookie to
 * `POST /auth/refresh`, which rotates the token and mints a fresh access token
 * — no bearer credential ever lives in JS-readable storage.
 *
 * Security model:
 * - Rotation: every successful `/auth/refresh` consumes the presented token
 *   (sets `usedAt`) and issues a brand-new token in the SAME `family` with a
 *   fresh sliding expiry. A refresh token is therefore strictly single-use.
 * - Reuse-detection = theft signal: a refresh token that is presented AFTER it
 *   has already been consumed (`usedAt` set) can only mean the token leaked and
 *   both the legitimate client and an attacker now hold copies. We treat this as
 *   token theft and revoke the ENTIRE family (`revokedAt` on every row) plus
 *   deactivate the underlying session, forcing a fresh interactive sign-in. This
 *   is the OWASP-recommended refresh-token-rotation defense.
 * - Hash-only storage: the raw token is a bearer credential, so we persist only
 *   its SHA-256 hash (`tokenHash`, unique). Leakage of this collection cannot be
 *   replayed against `/auth/refresh` because the attacker never sees a raw token.
 * - Sliding expiry: each rotation extends `expiresAt` by the 30-day TTL, so an
 *   actively-used session stays signed in indefinitely while an abandoned one
 *   lapses after 30 days of inactivity.
 *
 * The `family` ties together every token descended from a single sign-in so
 * that a theft anywhere in the rotation chain nukes the whole lineage.
 */
export interface IRefreshToken extends Document {
  /** SHA-256 hex digest of the raw refresh token (never the raw value). */
  tokenHash: string;
  /** The UUID of the Session this refresh token can mint access tokens for. */
  sessionId: string;
  /** ObjectId of the owning user. */
  userId: mongoose.Types.ObjectId;
  /** Rotation family id — shared by every token descended from one sign-in. */
  family: string;
  /** Set when the token is rotated/consumed. Single-use enforcement. */
  usedAt?: Date;
  /** Set when the whole family is revoked (reuse-detection or logout). */
  revokedAt?: Date;
  /** Sliding 30-day expiry, extended on each rotation. */
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RefreshTokenSchema: Schema = new Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    family: {
      type: String,
      required: true,
      index: true,
    },
    usedAt: {
      type: Date,
      default: null,
      index: true,
    },
    revokedAt: {
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

// TTL — Mongo automatically prunes after expiry. We add a 5-minute pad (mirroring
// AuthCode) so that a reuse attempt on a just-expired token is still detectable
// during the grace window before the row is swept.
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });

export const RefreshToken = mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema);
export default RefreshToken;
