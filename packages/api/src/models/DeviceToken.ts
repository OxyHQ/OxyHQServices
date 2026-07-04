import mongoose, { Document, Schema } from 'mongoose';

/**
 * DeviceToken Model
 *
 * Backs the opaque **device token** — the add-only attribution credential that
 * lets a first-party sign-in performed over a cookieless cross-site fetch (e.g.
 * an in-app modal on `mention.earth` hitting `api.oxy.so`) land in the SAME
 * browser/device `DeviceSession` the user already has. It is NOT a session
 * credential: it never reads session state and never flips the device's active
 * account — it only ATTRIBUTES a freshly-credentialed new session to a device
 * set (see `deviceSession.service.addAccount({ activate: 'if-empty' })`).
 *
 * Security model (mirrors `RefreshToken`):
 * - Hash-only storage: the raw token is a bearer-equivalent, so we persist only
 *   its SHA-256 hash (`tokenHash`, unique). A dump of this collection cannot be
 *   replayed because the attacker never sees a raw token.
 * - Bound to `(deviceId, origin, channel)`: `channel: 'web'` binds the token to
 *   an exact https `origin` (the resolver requires `req.headers.origin ===
 *   origin`); `channel: 'native'` requires the Origin header to be ABSENT.
 * - One live token per `(deviceId, origin)`: issuing a new token revokes the
 *   previous one for the same pair, so a rotated-away token cannot be reused.
 * - Sliding 400-day expiry (`expiresAt`), bumped on use (`lastUsedAt`), so an
 *   actively-used device keeps its attribution while an abandoned one lapses.
 *
 * The raw token is never logged.
 */
export type DeviceTokenChannel = 'web' | 'native';

export interface IDeviceToken extends Document {
  /** SHA-256 hex digest of the raw device token (never the raw value). */
  tokenHash: string;
  /** The central deviceId this token attributes new sessions to. */
  deviceId: string;
  /** Transport channel — `web` (origin-bound) or `native` (no Origin header). */
  channel: DeviceTokenChannel;
  /** For `web`: the exact https origin. For `native`: the literal `'native'`. */
  origin: string;
  /** Set when the token is revoked (rotation or explicit device revoke). */
  revokedAt?: Date | null;
  /** Sliding 400-day expiry, bumped on each successful resolve. */
  expiresAt: Date;
  /** Last time the token successfully resolved (attribution use). */
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceTokenSchema: Schema = new Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ['web', 'native'],
      required: true,
    },
    origin: {
      type: String,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// TTL — Mongo prunes after expiry. A 5-minute pad (mirroring RefreshToken /
// AuthCode) keeps a just-expired token detectable during the grace window.
DeviceTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });

// One live token per (deviceId, origin) is a service-layer invariant (issue
// revokes the previous), not a DB unique — a revoked row lingers until the TTL
// sweep, so a unique index would reject the replacement.
DeviceTokenSchema.index({ deviceId: 1, origin: 1 });

export const DeviceToken = mongoose.model<IDeviceToken>('DeviceToken', DeviceTokenSchema);
export default DeviceToken;
