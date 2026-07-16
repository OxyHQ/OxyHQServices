import mongoose, { type Document, Schema } from "mongoose";

/**
 * DevicePairingSession Model (b3 Feature 2 — device-to-device identity transfer)
 *
 * Backs the short-lived, unauthenticated relay that clones an identity from an
 * existing device to a fresh one. It is E2E-encrypted: the server stores only
 * the two ephemeral secp256k1 public keys plus an opaque AEAD ciphertext/nonce
 * and NEVER holds a key that can decrypt the transferred private key. A DB dump
 * or on-path attacker sees only ciphertext.
 *
 * Lifecycle:
 *   pending  -> new device created the pairing and is waiting (holds the
 *               matching ephemeral private key in memory only)
 *   approved -> old device sealed `{ privateKey, publicKey }` under the shared
 *               transfer key and posted the ciphertext (atomic pending->approved)
 *   denied   -> old device explicitly cancelled the transfer
 *   expired  -> the 3-minute TTL elapsed before approval (also set lazily on read)
 *
 * Security invariants:
 *   - Ephemeral keys are SINGLE-USE and never persisted beyond this row's TTL.
 *   - The pending->approved transition is ATOMIC (findOneAndUpdate on
 *     status:'pending') so a concurrent approve cannot double-complete.
 *   - No IP / device fingerprint is persisted (privacy invariant).
 */
export type DevicePairingStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface IDevicePairingSession extends Document {
  /** 128-bit single-use handle carried in the QR (also the HKDF salt). */
  pairingId: string;
  /** The new device's ephemeral secp256k1 public key (hex). */
  newDeviceEphemeralPublicKey: string;
  /** Optional human-readable label for the new device. */
  newDeviceLabel?: string | null;
  /** The old device's ephemeral secp256k1 public key (hex) — set on approve. */
  oldDeviceEphemeralPublicKey?: string | null;
  /** AEAD ciphertext of `{ privateKey, publicKey }` (hex) — set on approve. */
  ciphertext?: string | null;
  /** AEAD nonce (hex, 24 bytes) — set on approve. */
  nonce?: string | null;
  status: DevicePairingStatus;
  /** MongoDB id of the bearer-authenticated user who approved the transfer. */
  approvedByUserId?: mongoose.Types.ObjectId | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DevicePairingSessionSchema: Schema = new Schema(
  {
    pairingId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    newDeviceEphemeralPublicKey: {
      type: String,
      required: true,
    },
    newDeviceLabel: {
      type: String,
      default: null,
    },
    oldDeviceEphemeralPublicKey: {
      type: String,
      default: null,
    },
    ciphertext: {
      type: String,
      default: null,
    },
    nonce: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'expired'],
      default: 'pending',
      index: true,
    },
    approvedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index — remove the row at `expiresAt` (Mongo's TTL monitor lags up to 60s,
// which is fine; reads mark status:'expired' lazily before the sweep). The row
// is single-use and ephemeral, so there is no reason to retain it past expiry.
DevicePairingSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DevicePairingSession = mongoose.model<IDevicePairingSession>(
  "DevicePairingSession",
  DevicePairingSessionSchema
);
export default DevicePairingSession;
