import mongoose, { type Document, Schema, type Types } from 'mongoose';

/**
 * WebauthnCredential Model
 *
 * One registered WebAuthn/passkey credential for a user. A user may have many.
 * The `credentialID` is the browser-supplied base64url credential id — it is a
 * PUBLIC handle (returned to any RP the authenticator talks to), not a secret,
 * so it is looked up with plain equality and carries a UNIQUE index.
 *
 * `credentialPublicKey` is the COSE-encoded public key bytes returned by
 * `verifyRegistrationResponse` — stored as a Buffer and fed back to
 * `verifyAuthenticationResponse` on each login. `counter` is the authenticator's
 * signature counter, persisted on every successful assertion for replay
 * detection (platform authenticators keep it at 0 and never increment — that is
 * NOT a regression, see the login/verify route).
 *
 * `userVerified` records the ASSURANCE LEVEL of the most recent ceremony: `true`
 * when the authenticator performed real user verification (PIN/biometric),
 * `false` for a possession-only assertion (a U2F/CTAP1 security key with no PIN,
 * accepted under the owner's possession-credential policy). It is stamped at
 * enrollment and refreshed on every successful login, so a future step-up can
 * gate sensitive actions on UV-backed credentials without re-running a ceremony.
 */
export interface IWebauthnCredential extends Document {
  userId: Types.ObjectId;
  credentialID: string;
  credentialPublicKey: Buffer;
  counter: number;
  transports?: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  userVerified: boolean;
  name: string;
  createdAt: Date;
  lastUsedAt?: Date;
}

const WebauthnCredentialSchema: Schema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    credentialID: {
      type: String,
      required: true,
      unique: true,
    },
    credentialPublicKey: {
      type: Buffer,
      required: true,
    },
    counter: {
      type: Number,
      required: true,
      default: 0,
    },
    transports: {
      type: [String],
      default: undefined,
    },
    deviceType: {
      type: String,
      enum: ['singleDevice', 'multiDevice'],
      required: true,
    },
    backedUp: {
      type: Boolean,
      required: true,
      default: false,
    },
    userVerified: {
      type: Boolean,
      required: true,
      default: false,
    },
    name: {
      type: String,
      required: true,
    },
    lastUsedAt: {
      type: Date,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const WebauthnCredential = mongoose.model<IWebauthnCredential>(
  'WebauthnCredential',
  WebauthnCredentialSchema
);
export default WebauthnCredential;
