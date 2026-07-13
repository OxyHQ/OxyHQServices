import mongoose, { Schema, type Document } from 'mongoose';
import { APPLICATION_SCOPES, type ApplicationScope } from '../utils/applicationScopes';

export const APPLICATION_TYPES = [
  'first_party',
  'third_party',
  'internal',
  'system',
] as const;

export type ApplicationType = (typeof APPLICATION_TYPES)[number];

export const APPLICATION_STATUSES = [
  'active',
  'suspended',
  'deleted',
  'pending_review',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface IApplication extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  websiteUrl?: string;
  /** Public URL of the application's privacy policy — rendered as a legal link on the OAuth consent screen. */
  privacyPolicyUrl?: string;
  /** Public URL of the application's terms of service — rendered as a legal link on the OAuth consent screen. */
  termsUrl?: string;
  icon?: string;
  /**
   * Trust/classification of the application. Staff-only — never settable via the
   * Console / member RBAC path. Defaults to `third_party`.
   */
  type: ApplicationType;
  status: ApplicationStatus;
  /** Staff-only — surfaced as an "official" badge. */
  isOfficial: boolean;
  /** Staff-only — gates service-token issuance and internal-only endpoints. */
  isInternal: boolean;
  /** Staff-only — opaque platform capability flags. */
  capabilities: string[];
  /**
   * Per-app allowlist of redirect URIs for the OAuth2 authorization code flow.
   * Matched exactly (scheme + host + port + path) against the `redirect_uri`
   * parameter on `POST /auth/oauth/authorize`. Rejected if not present.
   * Canonical field — Console writes here and OAuth authorize validates here.
   */
  redirectUris: string[];
  scopes: ApplicationScope[];
  webhookUrl?: string;
  webhookSecret?: string;
  devWebhookUrl?: string;
  /**
   * The Account (a User in the account graph) that owns this application. Every
   * application belongs to exactly one owning account; the caller's effective
   * `AccountMember` role over this account (with tree inheritance) grants RBAC
   * access to the application — there is no separate per-app member table.
   */
  ownerAccountId: mongoose.Types.ObjectId;
  /** User who created the application — automatically granted the `owner` member role. */
  createdByUserId: mongoose.Types.ObjectId;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationSchema = new Schema<IApplication>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    websiteUrl: {
      type: String,
      trim: true,
    },
    privacyPolicyUrl: {
      type: String,
      trim: true,
    },
    termsUrl: {
      type: String,
      trim: true,
    },
    icon: {
      type: String,
    },
    type: {
      type: String,
      enum: APPLICATION_TYPES,
      default: 'third_party',
      index: true,
    },
    status: {
      type: String,
      enum: APPLICATION_STATUSES,
      default: 'active',
      index: true,
    },
    isOfficial: {
      type: Boolean,
      default: false,
      index: true,
    },
    isInternal: {
      type: Boolean,
      default: false,
      index: true,
    },
    capabilities: {
      type: [String],
      default: [],
    },
    redirectUris: [
      {
        type: String,
        trim: true,
      },
    ],
    scopes: [
      {
        type: String,
        enum: APPLICATION_SCOPES,
      },
    ],
    webhookUrl: {
      type: String,
      trim: true,
    },
    webhookSecret: {
      type: String,
    },
    devWebhookUrl: {
      type: String,
      trim: true,
    },
    ownerAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    lastUsedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

ApplicationSchema.index({ createdByUserId: 1, status: 1 });
ApplicationSchema.index({ ownerAccountId: 1, status: 1 });
ApplicationSchema.index({ createdAt: -1 });

export const Application = mongoose.model<IApplication>('Application', ApplicationSchema);

export default Application;
