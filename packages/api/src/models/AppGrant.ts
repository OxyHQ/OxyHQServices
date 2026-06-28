import mongoose, { Document, Schema } from 'mongoose';

/**
 * AppGrant Model
 *
 * Records that a user has consented to a third-party {@link Application} via
 * the OAuth2 authorization-code flow (`POST /auth/oauth/authorize`). A grant is
 * created/refreshed every time the user authorizes the app, so a returning user
 * skips the consent screen as long as the previously-granted scopes still cover
 * what the app requests (the Google/Meta model).
 *
 * Why key by `applicationId` (NOT the OAuth `client_id`):
 * `client_id` == `ApplicationCredential.publicKey`, which ROTATES (credential
 * rotation mints a new publicKey, deprecating the old one). Keying the grant on
 * the stable `Application._id` means a credential rotation never silently drops
 * a user's consent and forces a re-prompt. The authorize flow resolves
 * `client_id → ApplicationCredential → applicationId` before recording the grant.
 *
 * Trust note: TRUSTED applications (first-party / internal / system / official —
 * see `isTrustedApplication`) are auto-approved and skip consent entirely, so
 * the authorize flow does NOT record a grant for them. Only third-party grants
 * land here, which is exactly the revocable set surfaced by the "Connected
 * apps" management UI.
 *
 * Privacy note: a grant records only that the user authorized a registered app
 * for a set of scopes. It contains no token material and no PII.
 */
export interface IAppGrant extends Document {
  /** The user who authorized the application. */
  userId: mongoose.Types.ObjectId;
  /** The Application the user authorized (stable across credential rotation). */
  applicationId: mongoose.Types.ObjectId;
  /** Union of all scopes the user has granted this application. */
  scopes: string[];
  /** When the user first authorized this application. */
  firstGrantedAt: Date;
  /** Most recent authorization for this user+application (refreshed on each authorize). */
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AppGrantSchema = new Schema<IAppGrant>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    scopes: {
      type: [String],
      default: [],
    },
    firstGrantedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    lastUsedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// One grant row per (user, application). The upsert on authorize relies on this
// to union scopes / refresh `lastUsedAt` rather than inserting duplicates.
AppGrantSchema.index({ userId: 1, applicationId: 1 }, { unique: true });

export const AppGrant = mongoose.model<IAppGrant>('AppGrant', AppGrantSchema);
export default AppGrant;
