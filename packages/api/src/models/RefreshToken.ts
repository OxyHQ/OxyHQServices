import mongoose, { Document, Schema } from "mongoose";

/**
 * RefreshToken Model
 *
 * Backs the device-first persisted-refresh lane (see
 * `services/refreshToken.service.ts`). When a user signs in (password, public
 * key, or a device exchange) the server mints an opaque refresh token, stores
 * ONLY its SHA-256 hash here, and hands the raw token to the client, which
 * persists it itself (web localStorage / native SecureStore) — this is a
 * body-based rotation, not a cookie. The client rotates it via
 * `POST /auth/refresh-token` (`deviceAuth.ts`), which consumes the presented
 * token and mints a fresh access token + the next token in the family.
 *
 * Security model:
 * - Rotation: every successful rotation consumes the presented token (sets
 *   `usedAt`) and issues a brand-new token in the SAME `family` with a fresh
 *   sliding expiry. A refresh token is therefore strictly single-use.
 * - Reuse-detection = theft signal: a refresh token that is presented AFTER it
 *   has already been consumed (`usedAt` set) can only mean the token leaked and
 *   both the legitimate client and an attacker now hold copies. We treat this as
 *   token theft and revoke the ENTIRE family (`revokedAt` on every row) plus
 *   deactivate the underlying session, forcing a fresh interactive sign-in. This
 *   is the OWASP-recommended refresh-token-rotation defense.
 * - Hash-only storage: the raw token is a bearer credential, so we persist only
 *   its SHA-256 hash (`tokenHash`, unique). Leakage of this collection cannot be
 *   replayed at `/auth/refresh-token` because the attacker never sees a raw token.
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
