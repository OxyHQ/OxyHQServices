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
      enum: [
        'sign_in',
        'sign_out',
        'email_changed',
        'profile_updated',
        'device_added',
        'device_removed',
        'account_recovery',
        'security_settings_changed',
        'suspicious_activity',
      ],
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
      index: true,
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

export default mongoose.model<ISecurityActivity>("SecurityActivity", SecurityActivitySchema);

