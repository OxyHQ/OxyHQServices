import mongoose, { Document, Schema } from "mongoose";

export type SecurityEventType = 
  | 'sign_in'
  | 'sign_out'
  | 'email_changed'
  | 'profile_updated'
  | 'device_added'
  | 'device_removed'
  | 'account_recovery'
  | 'security_settings_changed'
  | 'suspicious_activity';

export type SecurityEventSeverity = 'low' | 'medium' | 'high' | 'critical';

// Export event types array as constant (single source of truth)
export const SECURITY_EVENT_TYPES: SecurityEventType[] = [
  'sign_in',
  'sign_out',
  'email_changed',
  'profile_updated',
  'device_added',
  'device_removed',
  'account_recovery',
  'security_settings_changed',
  'suspicious_activity',
];

// Export severity mapping (single source of truth for backend and frontend)
export const SECURITY_EVENT_SEVERITY_MAP: Record<SecurityEventType, SecurityEventSeverity> = {
  'sign_in': 'low',
  'sign_out': 'low',
  'profile_updated': 'low',
  'email_changed': 'medium',
  'device_added': 'medium',
  'device_removed': 'medium',
  'security_settings_changed': 'medium',
  'account_recovery': 'high',
  'suspicious_activity': 'critical',
};

export interface ISecurityActivity extends Document {
  userId: mongoose.Types.ObjectId;
  eventType: SecurityEventType;
  eventDescription: string;
  metadata?: Record<string, any>; // Additional event-specific data
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  timestamp: Date;
  severity: SecurityEventSeverity;
  createdAt: Date;
  updatedAt: Date;
}

const SecurityActivitySchema: Schema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      enum: SECURITY_EVENT_TYPES,
      index: true,
    },
    eventDescription: {
      type: String,
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    deviceId: {
      type: String,
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
      // Index created explicitly below for TTL functionality
    },
    severity: {
      type: String,
      required: true,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'low',
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient queries: userId + timestamp (most common query pattern)
SecurityActivitySchema.index({ userId: 1, timestamp: -1 });
// Index for filtering by event type
SecurityActivitySchema.index({ userId: 1, eventType: 1, timestamp: -1 });
// Index for device-related queries
SecurityActivitySchema.index({ userId: 1, deviceId: 1, timestamp: -1 });

// TTL index: Automatically delete security activity older than 2 years (730 days)
// This prevents unbounded growth while retaining sufficient audit history
// MongoDB TTL cleanup runs every 60 seconds
// Note: This is a separate index from the compound indexes above - MongoDB will use
// the appropriate index based on query patterns. The TTL index is specifically for
// automatic data retention/cleanup, while compound indexes optimize query performance.
SecurityActivitySchema.index({ timestamp: 1 }, { expireAfterSeconds: 730 * 24 * 60 * 60 });

export default mongoose.model<ISecurityActivity>("SecurityActivity", SecurityActivitySchema);

