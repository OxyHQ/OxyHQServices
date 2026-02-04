import mongoose, { Schema, Document } from 'mongoose';

export interface IApiKeyUsage extends Document {
  apiKeyId?: mongoose.Types.ObjectId;
  userId: string;
  appId?: mongoose.Types.ObjectId;
  endpoint: string;
  method: string;
  statusCode: number;
  tokensUsed?: number;
  creditsUsed?: number;
  responseTime?: number;
  userAgent?: string;
  ipAddress?: string;
  timestamp: Date;
  authType: 'api_key' | 'session' | 'internal';
  serviceApp?: string;
}

const ApiKeyUsageSchema = new Schema<IApiKeyUsage>(
  {
    apiKeyId: {
      type: Schema.Types.ObjectId,
      ref: 'DeveloperApiKey',
      required: false,
    },
    userId: {
      type: String,
      required: true,
    },
    appId: {
      type: Schema.Types.ObjectId,
      ref: 'DeveloperApp',
      required: false,
    },
    authType: {
      type: String,
      enum: ['api_key', 'session', 'internal'],
      default: 'api_key',
    },
    serviceApp: {
      type: String,
    },
    endpoint: {
      type: String,
      required: true,
    },
    method: {
      type: String,
      required: true,
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
    statusCode: {
      type: Number,
      required: true,
    },
    tokensUsed: {
      type: Number,
      default: 0,
    },
    creditsUsed: {
      type: Number,
      default: 0,
    },
    responseTime: {
      type: Number,
    },
    userAgent: {
      type: String,
    },
    ipAddress: {
      type: String,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

ApiKeyUsageSchema.index({ apiKeyId: 1, timestamp: -1 });
ApiKeyUsageSchema.index({ userId: 1, timestamp: -1 });
ApiKeyUsageSchema.index({ userId: 1, authType: 1, timestamp: -1 });
ApiKeyUsageSchema.index({ appId: 1, timestamp: -1 });

// Auto-delete after 90 days
ApiKeyUsageSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const ApiKeyUsage = mongoose.model<IApiKeyUsage>('ApiKeyUsage', ApiKeyUsageSchema);

export default ApiKeyUsage;
