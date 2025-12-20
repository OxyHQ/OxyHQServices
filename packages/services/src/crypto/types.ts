/**
 * Cryptographic types for identity management
 */

/**
 * Encrypted backup data structure
 * Used for identity backup files and QR code transfers
 */
export interface BackupData {
  /** Base64-encoded encrypted private key */
  encrypted: string;
  /** Hex-encoded salt used for key derivation */
  salt: string;
  /** Hex-encoded initialization vector */
  iv: string;
  /** Public key associated with the encrypted private key */
  publicKey: string;
}

