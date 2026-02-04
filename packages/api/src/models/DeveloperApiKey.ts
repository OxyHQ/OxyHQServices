import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

export interface IRateLimitConfig {
  requestsPerMinute: number | null;
  requestsPerDay: number | null;
  tokensPerMinute: number | null;
  tokensPerDay: number | null;
}

export interface IDeveloperApiKey extends Document {
  userId: string;
  appId: mongoose.Types.ObjectId;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt?: Date;
  lastUsedAt?: Date;
  isActive: boolean;
  rateLimit: IRateLimitConfig;
  createdAt: Date;
  updatedAt: Date;
  validateKey(key: string): boolean;
}

const DeveloperApiKeySchema = new Schema<IDeveloperApiKey>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    appId: {
      type: Schema.Types.ObjectId,
      ref: 'DeveloperApp',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    keyHash: {
      type: String,
      required: true,
      unique: true,
    },
    keyPrefix: {
      type: String,
      required: true,
    },
    scopes: {
      type: [String],
      default: ['chat:completions', 'models:read'],
      enum: [
        'chat:completions',
        'models:read',
        'files:read',
        'files:write',
        'files:delete',
        'user:read',
        'webhooks:receive',
      ],
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    rateLimit: {
      type: {
        requestsPerMinute: { type: Number, default: null },
        requestsPerDay: { type: Number, default: 1000 },
        tokensPerMinute: { type: Number, default: null },
        tokensPerDay: { type: Number, default: null },
      },
      default: {
        requestsPerMinute: null,
        requestsPerDay: 1000,
        tokensPerMinute: null,
        tokensPerDay: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

DeveloperApiKeySchema.index({ userId: 1, isActive: 1 });
DeveloperApiKeySchema.index({ appId: 1, isActive: 1 });

DeveloperApiKeySchema.methods.validateKey = function (key: string): boolean {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return hash === this.keyHash;
};

DeveloperApiKeySchema.statics.generateKey = function (): string {
  const randomBytes = crypto.randomBytes(32);
  const key = randomBytes.toString('base64url');
  return `oxy_dk_${key}`;
};

DeveloperApiKeySchema.statics.hashKey = function (key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
};

const DeveloperApiKey = mongoose.model<IDeveloperApiKey>('DeveloperApiKey', DeveloperApiKeySchema);

export default DeveloperApiKey;
