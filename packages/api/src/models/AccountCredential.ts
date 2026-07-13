import mongoose, { Schema, type Document } from 'mongoose';
import { APPLICATION_SCOPES, type ApplicationScope } from '../utils/applicationScopes';

/**
 * Credential type for an account-owned service credential. A `bot`-kind account
 * is a programmatic principal that authenticates AS ITSELF via a service token
 * minted from one of these credentials — so the only valid type is `service`
 * (distinct from an Application's `public`/`confidential` OAuth clients).
 */
export const ACCOUNT_CREDENTIAL_TYPES = ['service'] as const;

export type AccountCredentialType = (typeof ACCOUNT_CREDENTIAL_TYPES)[number];

export const ACCOUNT_CREDENTIAL_ENVIRONMENTS = [
  'development',
  'staging',
  'production',
] as const;

export type AccountCredentialEnvironment =
  (typeof ACCOUNT_CREDENTIAL_ENVIRONMENTS)[number];

export const ACCOUNT_CREDENTIAL_STATUSES = ['active', 'deprecated', 'revoked'] as const;

export type AccountCredentialStatus = (typeof ACCOUNT_CREDENTIAL_STATUSES)[number];

/**
 * Service credential owned by an account (a User `_id`, typically `kind:'bot'`).
 * Mirrors {@link IApplicationCredential} but is keyed by `accountId` and is
 * always `type:'service'`. Shares the same 7-day rotation-grace semantics via
 * `utils/credentialUsability.ts`.
 */
export interface IAccountCredential extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  name: string;
  /** Public identifier (e.g. `oxy_dk_...`). Doubles as the OAuth `client_id`. */
  publicKey: string;
  /**
   * SHA-256 hash of the raw secret. The plaintext secret is returned to the
   * client ONCE at creation/rotation and is never stored or re-derivable.
   */
  secretHash?: string;
  type: AccountCredentialType;
  environment: AccountCredentialEnvironment;
  /**
   * Scopes this credential may request when minting a service token. Constrained
   * to the same enum as application scopes.
   */
  scopes: ApplicationScope[];
  status: AccountCredentialStatus;
  lastUsedAt?: Date;
  expiresAt?: Date;
  /**
   * When this credential was minted by rotating another credential, the `_id` of
   * the previous (now `deprecated`) credential it superseded.
   */
  rotatedFromCredentialId?: mongoose.Types.ObjectId;
  createdByUserId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AccountCredentialSchema = new Schema<IAccountCredential>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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
      enum: ACCOUNT_CREDENTIAL_TYPES,
      required: true,
      default: 'service',
    },
    environment: {
      type: String,
      enum: ACCOUNT_CREDENTIAL_ENVIRONMENTS,
      required: true,
    },
    scopes: {
      type: [String],
      enum: APPLICATION_SCOPES,
      default: [],
    },
    status: {
      type: String,
      enum: ACCOUNT_CREDENTIAL_STATUSES,
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
      ref: 'AccountCredential',
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

AccountCredentialSchema.index({ accountId: 1, status: 1 });

export const AccountCredential = mongoose.model<IAccountCredential>(
  'AccountCredential',
  AccountCredentialSchema
);

export default AccountCredential;
