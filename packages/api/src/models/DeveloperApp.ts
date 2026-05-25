import mongoose, { Schema, Document } from 'mongoose';

/**
 * Allowed OAuth scopes for DeveloperApp.
 * - `federation:write` permits internal services to call the user resolution
 *   endpoint (`PUT /users/resolve`) for federation/agent/automation flows.
 *   Must be explicitly granted in the DB by an administrator.
 */
export const DEVELOPER_APP_SCOPES = [
  'files:read',
  'files:write',
  'files:delete',
  'user:read',
  'webhooks:receive',
  'chat:completions',
  'models:read',
  'federation:write',
] as const;

export type DeveloperAppScope = typeof DEVELOPER_APP_SCOPES[number];

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
  /**
   * Per-app allowlist of redirect URIs for the OAuth2 authorization code flow.
   * Matched exactly (scheme + host + port + path) against the `redirect_uri`
   * parameter on `POST /auth/oauth/authorize`. Rejected if not present.
   */
  redirectUris: string[];
  icon?: string;
  status: 'active' | 'suspended' | 'deleted';
  scopes: DeveloperAppScope[];
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
  redirectUris: [{
    type: String,
    trim: true,
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
    enum: DEVELOPER_APP_SCOPES,
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
