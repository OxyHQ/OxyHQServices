import mongoose, { Document, Schema } from 'mongoose';

/**
 * FedCMGrant Model
 *
 * Records that a user has authorized a specific relying-party (RP) origin via
 * FedCM. A grant is created/refreshed every time the API mints an Oxy session
 * for a user through `POST /fedcm/exchange` (i.e. the user actively completed
 * a FedCM sign-in for that origin).
 *
 * Why this exists — `approved_clients`:
 * The FedCM accounts endpoint (`auth.oxy.so/fedcm/accounts`) returns an
 * optional `approved_clients` array per the spec. When the requesting RP's
 * `client_id` is present in it, Chrome treats the account as a *returning*
 * account for that RP: it skips the disclosure/consent UI and allows
 * `mediation: 'silent'` to resolve without any user interaction. Without it,
 * every app is treated as a first-time RP, so cross-app silent SSO never
 * resolves (the chooser/disclosure is required on every visit).
 *
 * The Oxy FedCM `client_id` IS the RP origin (the client passes
 * `window.location.origin` as `clientId`, and the IdP signs it as the token
 * `aud`). So a grant stores the RP origin, and the accounts endpoint maps the
 * user's grants straight into `approved_clients`.
 *
 * Privacy note: a grant only records that the user themselves authorized a
 * public app origin (the same origins already published by
 * `GET /fedcm/clients/approved`). It contains no token material and no PII.
 */
export interface IFedCMGrant extends Document {
  /** The user who authorized the RP. */
  userId: mongoose.Types.ObjectId;
  /** Normalised RP origin the user authorized (== FedCM client_id == token aud). */
  clientOrigin: string;
  /** When the user first authorized this RP. */
  firstGrantedAt: Date;
  /** Most recent FedCM exchange for this user+origin (refreshed on each exchange). */
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FedCMGrantSchema = new Schema<IFedCMGrant>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clientOrigin: {
      type: String,
      required: true,
      trim: true,
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

// One grant row per (user, origin). The upsert on exchange relies on this to
// refresh `lastUsedAt` rather than inserting duplicates.
FedCMGrantSchema.index({ userId: 1, clientOrigin: 1 }, { unique: true });

export const FedCMGrant = mongoose.model<IFedCMGrant>('FedCMGrant', FedCMGrantSchema);
export default FedCMGrant;
