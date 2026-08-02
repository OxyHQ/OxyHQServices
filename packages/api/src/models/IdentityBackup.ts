import mongoose, { type Document, Schema } from 'mongoose';

/**
 * Encrypted off-device identity backup (b3 Feature 1).
 *
 * Zero-knowledge at rest: the server stores ONLY opaque ciphertext plus
 * `lookupIdHash` = `sha256(lookupId)` — it never sees the recovery phrase, the
 * derived encryption key, the plaintext private key, or the raw `lookupId`
 * (mirrors the `DeviceSession.secretHash` pattern, where the raw secret is never
 * persisted). A DB dump therefore yields un-decryptable ciphertext keyed by an
 * un-invertible hash: the server can neither locate a backup (it lacks the seed
 * to compute a `lookupId`) nor decrypt one (it lacks the seed to compute the
 * backup key).
 *
 * One backup per user (`userId` unique) — a re-upload upserts/replaces. The
 * envelope fields are stored verbatim so the public restore endpoint can return
 * the exact `EncryptedBackupEnvelope` the client uploaded. `createdAt` is the
 * CLIENT's ISO timestamp (not a DB row timestamp), refreshed on each replace, so
 * it reflects when the backup snapshot was created; `updatedAt` tracks the row.
 */
export interface IIdentityBackup extends Document {
  /** The owning account. One backup per user. */
  userId: mongoose.Types.ObjectId;
  /**
   * `sha256(lookupId)` hex. Unique — the public restore endpoint hashes the
   * client-supplied raw `lookupId` and matches on this. The raw `lookupId` is
   * NEVER stored, so possession of the 256-bit locator (which requires the full
   * seed to compute) is the only way to fetch a backup.
   */
  lookupIdHash: string;
  /** Short, non-sensitive public-key prefix so the owner can recognise the identity. */
  publicKeyHint: string;
  /** XChaCha20-Poly1305 ciphertext (with appended Poly1305 tag), hex. */
  ciphertext: string;
  /** The 24-byte AEAD nonce, hex. */
  nonce: string;
  /** The AEAD used to seal the ciphertext (e.g. `xchacha20poly1305`). */
  algorithm: string;
  /** The HKDF `info` label used to derive the encryption key (domain-separation tag). */
  kdfInfo: string;
  /** Envelope/KDF version, so a future scheme migration is distinguishable at rest. */
  version: number;
  /** The client's ISO-8601 backup-creation timestamp (stored verbatim). */
  createdAt: string;
  /** Row bookkeeping — last write time (mongoose-managed). */
  updatedAt: Date;
}

const IdentityBackupSchema = new Schema<IIdentityBackup>(
  {
    // Uniqueness for both is declared once, below, via `schema.index()` (never
    // also field-level `unique`, which would register a duplicate index).
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lookupIdHash: { type: String, required: true },
    publicKeyHint: { type: String, required: true },
    ciphertext: { type: String, required: true },
    nonce: { type: String, required: true },
    algorithm: { type: String, required: true },
    kdfInfo: { type: String, required: true },
    version: { type: Number, required: true },
    // The client's snapshot timestamp, stored verbatim (see interface note).
    createdAt: { type: String, required: true },
  },
  // Only `updatedAt` is mongoose-managed; `createdAt` is the client's value.
  { timestamps: { createdAt: false, updatedAt: true } },
);

// One backup per user; the locator hash is globally unique (used by the public
// restore lookup). Both are declared unique above; the explicit indexes keep the
// intent legible alongside the other identity models.
IdentityBackupSchema.index({ userId: 1 }, { unique: true });
IdentityBackupSchema.index({ lookupIdHash: 1 }, { unique: true });

export default mongoose.model<IIdentityBackup>('IdentityBackup', IdentityBackupSchema);
