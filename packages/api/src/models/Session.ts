import mongoose, { Document, Schema } from "mongoose";

export interface ISession extends Document {
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
  isActive: boolean;
  expiresAt: Date; // When this session expires
  lastRefresh: Date; // Last time tokens were refreshed
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema: Schema = new Schema(
  {
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

// Indexes for efficient queries
SessionSchema.index({ userId: 1, deviceId: 1 }); // Sessions by user and device
SessionSchema.index({ deviceId: 1 }); // All sessions on a device
SessionSchema.index({ accessToken: 1 }, { unique: true }); // Token-based lookups (unique)
SessionSchema.index({ refreshToken: 1 }, { unique: true }); // Refresh token lookups (unique)
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-cleanup expired sessions
SessionSchema.index({ userId: 1, isActive: 1, expiresAt: 1 }); // Active sessions by user

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