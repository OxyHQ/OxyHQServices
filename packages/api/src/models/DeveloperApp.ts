import mongoose, { Schema, Document } from 'mongoose';

export interface IDeveloperApp extends Omit<Document, '_id'> {
  _id: string;
  name: string;
  description?: string;
  developerUserId: string;
  apiKey: string;
  apiSecret: string;
  webhookUrl?: string;
  webhookSecret?: string;
  devWebhookUrl?: string;
  websiteUrl?: string;
  redirectUrls: string[];
  icon?: string;
  status: 'active' | 'suspended' | 'deleted';
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
  isInternal: boolean;
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
    trim: true
  },
  webhookSecret: {
    type: String
  },
  devWebhookUrl: {
    type: String,
    trim: true
  },
  websiteUrl: {
    type: String,
    trim: true
  },
  redirectUrls: [{
    type: String,
    trim: true
  }],
  icon: {
    type: String
  },
  status: { 
    type: String, 
    enum: ['active', 'suspended', 'deleted'], 
    default: 'active',
    index: true 
  },
  scopes: [{
    type: String,
    enum: ['files:read', 'files:write', 'files:delete', 'user:read', 'webhooks:receive', 'chat:completions', 'models:read']
  }],
  lastUsedAt: { type: Date },
  isInternal: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
DeveloperAppSchema.index({ developerUserId: 1, status: 1 });
DeveloperAppSchema.index({ apiKey: 1, status: 1 });
DeveloperAppSchema.index({ createdAt: -1 });

export const DeveloperApp = mongoose.model<IDeveloperApp>('DeveloperApp', DeveloperAppSchema);
