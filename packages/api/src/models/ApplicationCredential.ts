import mongoose, { Schema, type Document } from 'mongoose';
import { APPLICATION_SCOPES, type ApplicationScope } from '../utils/applicationScopes';

export const APPLICATION_CREDENTIAL_TYPES = ['public', 'confidential', 'service'] as const;

export type ApplicationCredentialType = (typeof APPLICATION_CREDENTIAL_TYPES)[number];

export const APPLICATION_CREDENTIAL_ENVIRONMENTS = [
  'development',
  'staging',
  'production',
] as const;

export type ApplicationCredentialEnvironment =
  (typeof APPLICATION_CREDENTIAL_ENVIRONMENTS)[number];

export const APPLICATION_CREDENTIAL_STATUSES = ['active', 'deprecated', 'revoked'] as const;

export type ApplicationCredentialStatus = (typeof APPLICATION_CREDENTIAL_STATUSES)[number];

export interface IApplicationCredential extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  applicationId: mongoose.Types.ObjectId;
  name: string;
  /** Public identifier (e.g. `oxy_dk_...`). Doubles as the OAuth `client_id`. */
  publicKey: string;
  /**
   * SHA-256 hash of the raw secret. The plaintext secret is returned to the
   * client ONCE at creation/rotation and is never stored or re-derivable.
   * Absent for `public` credentials that have no secret.
   */
  secretHash?: string;
  type: ApplicationCredentialType;
  environment: ApplicationCredentialEnvironment;
  /**
   * Scopes this credential may request when minting a service token. Constrained
   * to the same enum as application scopes; the service-token mint additionally
   * intersects these with the owning application's granted scopes, so a
   * credential can never exceed its app's authority.
   */
  scopes: ApplicationScope[];
  status: ApplicationCredentialStatus;
  lastUsedAt?: Date;
  expiresAt?: Date;
  /**
   * When this credential was minted by rotating another credential, the `_id`
   * of the previous (now `deprecated`) credential it superseded. Provides an
   * audit trail linking a new secret back to the one it replaced.
   */
  rotatedFromCredentialId?: mongoose.Types.ObjectId;
  createdByUserId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationCredentialSchema = new Schema<IApplicationCredential>(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    publicKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    secretHash: {
      type: String,
    },
    type: {
      type: String,
      enum: APPLICATION_CREDENTIAL_TYPES,
      required: true,
    },
    environment: {
      type: String,
      enum: APPLICATION_CREDENTIAL_ENVIRONMENTS,
      required: true,
    },
    scopes: {
      type: [String],
      enum: APPLICATION_SCOPES,
      default: [],
    },
    status: {
      type: String,
      enum: APPLICATION_CREDENTIAL_STATUSES,
      default: 'active',
      index: true,
    },
    lastUsedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
    },
    rotatedFromCredentialId: {
      type: Schema.Types.ObjectId,
      ref: 'ApplicationCredential',
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

ApplicationCredentialSchema.index({ applicationId: 1, status: 1 });

export const ApplicationCredential = mongoose.model<IApplicationCredential>(
  'ApplicationCredential',
  ApplicationCredentialSchema
);

export default ApplicationCredential;
