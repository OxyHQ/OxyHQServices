import mongoose, { Schema, Document } from 'mongoose';

export interface IDeveloperApp extends Document {
  _id: string;
  name: string;
  description?: string;
  developerUserId: string;
  apiKey: string;
  apiSecret: string;
  webhookUrl: string;
  webhookSecret?: string;
  devWebhookUrl?: string;
  status: 'active' | 'suspended' | 'deleted';
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
}

const DeveloperAppSchema = new Schema<IDeveloperApp>({
  name: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 100
  },
  description: { 
    type: String,
    trim: true,
    maxlength: 500
  },
  developerUserId: { 
    type: String, 
    required: true, 
    index: true 
  },
  apiKey: { 
    type: String, 
    required: true,
    unique: true,
    index: true
  },
  apiSecret: { 
    type: String, 
    required: true
  },
  webhookUrl: {
    type: String,
    required: true,
    trim: true
  },
  webhookSecret: {
    type: String
  },
  devWebhookUrl: {
    type: String,
    trim: true
  },
  status: { 
    type: String, 
    enum: ['active', 'suspended', 'deleted'], 
    default: 'active',
    index: true 
  },
  scopes: [{
    type: String,
    enum: ['files:read', 'files:write', 'files:delete', 'user:read', 'webhooks:receive']
  }],
  lastUsedAt: { type: Date }
}, {
  timestamps: true
});

// Indexes for efficient queries
DeveloperAppSchema.index({ developerUserId: 1, status: 1 });
DeveloperAppSchema.index({ apiKey: 1, status: 1 });
DeveloperAppSchema.index({ createdAt: -1 });

export const DeveloperApp = mongoose.model<IDeveloperApp>('DeveloperApp', DeveloperAppSchema);
