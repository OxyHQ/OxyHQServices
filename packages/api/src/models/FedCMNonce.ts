import mongoose, { Document, Schema } from "mongoose";

/**
 * FedCMNonce Model
 *
 * Single-use server-issued nonce store for the FedCM SSO handoff.
 *
 * The auth UI calls `POST /fedcm/nonce` to mint a nonce just before invoking
 * the browser's `navigator.credentials.get()` for FedCM. The IdP embeds it in
 * the issued ID token. When the consuming app exchanges the token via
 * `POST /fedcm/exchange`, we burn the nonce server-side. Replays fail because
 * the nonce row was deleted on first use; missing nonce or unknown values
 * are rejected outright.
 *
 * TTL is 5 minutes; long enough to cover slow browser handoffs but short
 * enough to bound the replay window if a token is stolen mid-exchange.
 */
export interface IFedCMNonce extends Document {
  /** SHA-256 hash of the raw nonce — we never persist the raw value. */
  nonceHash: string;
  /** Origin the nonce was minted for; must match the token `aud` at exchange. */
  origin: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
}

const FedCMNonceSchema: Schema = new Schema(
  {
    nonceHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    origin: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// TTL — prune used / expired entries automatically after 10 minutes.
FedCMNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 600 });

export const FedCMNonce = mongoose.model<IFedCMNonce>('FedCMNonce', FedCMNonceSchema);
export default FedCMNonce;
