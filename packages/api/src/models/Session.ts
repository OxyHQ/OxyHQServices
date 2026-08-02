import mongoose, { type Document, Schema } from "mongoose";

export interface ISession extends Document {
  sessionId: string; // UUID used in JWT tokens
  userId: mongoose.Types.ObjectId;
  deviceId: string; // Unique device identifier - can be shared across users
  deviceInfo: {
    deviceName?: string; // User-friendly device name
    deviceType: string; // mobile, desktop, tablet, etc.
    platform: string; // ios, android, web, etc.
    browser?: string;
    os?: string;
    lastActive: Date;
    ipAddress?: string;
    userAgent?: string;
    location?: string; // General location for security purposes
    fingerprint?: string; // Device fingerprint for identification
  };
  accessToken: string; // Current access token for this session
  refreshToken: string; // Refresh token for this session
  previousRefreshToken?: string; // Previous refresh token kept for grace period after rotation
  tokenRotatedAt?: Date; // When the refresh token was last rotated
  /**
   * The OPERATOR — the human user who minted this session by switching INTO a
   * managed/org account (`userId` = the managed account). Absent for ordinary
   * first-party sessions. While set, this session's validity is bound to the
   * operator's `account:act_as` membership over `userId`: revoking that
   * membership kills the session (re-checked on validate + refresh). Recorded
   * for audit/accountability — actions on a managed account are attributable to
   * the operator who performed them.
   */
  operatedByUserId?: mongoose.Types.ObjectId;
  /**
   * OAuth `client_id`s (ApplicationCredential `publicKey`s) that have been
   * issued tokens for THIS session through `POST /auth/oauth/token`.
   *
   * RFC 6749 §6 requires the token endpoint to "ensure that the refresh token
   * was issued to the authenticated client" before honouring a
   * `grant_type=refresh_token`. An Oxy session is not owned by a single client
   * (the same user+device session is reused across authorization-code
   * exchanges), so the binding is a SET that only ever grows: a client may
   * refresh a session it was itself issued a token for, and never one it was
   * not. Sessions minted by password login / device flow carry an empty set and
   * therefore cannot be refreshed through the OAuth token endpoint at all —
   * their refresh tokens were not issued by it.
   */
  oauthClientIds?: string[];
  isActive: boolean;
  expiresAt: Date; // When this session expires
  lastRefresh: Date; // Last time tokens were refreshed
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema: Schema = new Schema(
  {
    sessionId: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deviceId: {
      type: String,
      required: true,
    },
    deviceInfo: {
      deviceName: String,
      deviceType: { type: String, required: true },
      platform: { type: String, required: true },
      browser: String,
      os: String,
      lastActive: { type: Date, default: Date.now },
      ipAddress: String,
      userAgent: String,
      location: String,
      fingerprint: String, // Device fingerprint for identification
    },
    accessToken: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    previousRefreshToken: {
      type: String,
      default: null,
    },
    tokenRotatedAt: {
      type: Date,
      default: null,
    },
    operatedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    oauthClientIds: {
      type: [String],
      default: undefined, // absent (not `[]`) on sessions no OAuth client minted
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    lastRefresh: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries - optimized for performance
SessionSchema.index({ sessionId: 1 }, { unique: true }); // Primary lookup by sessionId (most common query)
SessionSchema.index({ sessionId: 1, isActive: 1, expiresAt: 1 }); // Optimized for validation and batch queries
SessionSchema.index({ userId: 1, deviceId: 1 }); // Sessions by user and device
SessionSchema.index({ userId: 1, isActive: 1, expiresAt: 1 }); // Active sessions by user
SessionSchema.index({ deviceId: 1, isActive: 1, expiresAt: 1 }); // Optimized compound index for device sessions query
SessionSchema.index({ accessToken: 1 }, { unique: true, sparse: true }); // Token-based lookups (sparse for performance)
SessionSchema.index({ refreshToken: 1 }, { unique: true, sparse: true }); // Refresh token lookups (sparse for performance)
SessionSchema.index({ previousRefreshToken: 1, tokenRotatedAt: 1 }, { sparse: true }); // Grace period lookups for concurrent tab refreshes
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-cleanup expired sessions
SessionSchema.index({ 'deviceInfo.fingerprint': 1, isActive: 1, expiresAt: 1 }); // Optimized for findExistingDeviceId queries

// Update lastActive timestamp on session access
SessionSchema.methods.updateLastActive = async function() {
  this.deviceInfo.lastActive = new Date();
  await this.save();
};

// Check if session is valid (active and not expired)
SessionSchema.methods.isValid = function() {
  return this.isActive && this.expiresAt > new Date();
};

// Deactivate session
SessionSchema.methods.deactivate = async function() {
  this.isActive = false;
  await this.save();
};

export default mongoose.model<ISession>("Session", SessionSchema); 