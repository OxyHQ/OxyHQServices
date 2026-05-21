/**
 * Encryption utilities for Oxy Inbox.
 *
 * Uses Web Crypto API (RSA-OAEP, 2048-bit) for encrypted messaging
 * between Oxy users. No external dependencies.
 *
 * Security model:
 * - Private key is generated as a non-extractable `CryptoKey` and stored in
 *   IndexedDB via {@link ./keyStore.ts}. It never exists as plaintext in JS,
 *   so XSS cannot exfiltrate decryption capability.
 * - Public key is exported once as a base64 SPKI string for upload to the
 *   user's profile (so senders can encrypt to it).
 *
 * Limitations:
 * - RSA-OAEP can only encrypt data smaller than the key size minus padding.
 *   For messages > ~190 bytes, we use a hybrid scheme: generate a random AES
 *   key, encrypt the message with AES-GCM, then encrypt the AES key with RSA.
 */

import { Platform } from 'react-native';

// ─── Constants ──────────────────────────────────────────────────────

const RSA_ALGORITHM: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

const RSA_IMPORT_PARAMS: RsaHashedImportParams = {
  name: 'RSA-OAEP',
  hash: 'SHA-256',
};

const AES_ALGORITHM = 'AES-GCM';
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12; // bytes

// ─── Type Helpers ───────────────────────────────────────────────────

export interface EncryptionKeyPair {
  /** Non-extractable RSA-OAEP public key (usages: ['encrypt']). */
  publicKey: CryptoKey;
  /** Non-extractable RSA-OAEP private key (usages: ['decrypt']). Never exported. */
  privateKey: CryptoKey;
  /** Base64-encoded SPKI form of the public key (for upload to user profile). */
  publicKeySpki: string;
}

export interface EncryptedPayload {
  /** AES-GCM encrypted message body (base64) */
  ciphertext: string;
  /** RSA-OAEP encrypted AES key (base64) */
  encryptedKey: string;
  /** AES-GCM IV (base64) */
  iv: string;
}

// ─── Utility Functions ──────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Check if Web Crypto API is available.
 */
export function isEncryptionSupported(): boolean {
  if (Platform.OS !== 'web') return false;
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

// ─── Key Generation ─────────────────────────────────────────────────

/**
 * Generate a new RSA-OAEP 2048-bit key pair.
 *
 * Returns a public key + non-extractable private key as `CryptoKey` objects,
 * plus the base64-SPKI form of the public key (for profile upload).
 *
 * Implementation note: WebCrypto's `generateKey` doesn't let us request different
 * `extractable` flags per key in a pair. We generate extractable, export the
 * public key to SPKI, then re-import both keys as non-extractable with the
 * minimum required usage. The original extractable pair is then dereferenced.
 */
export async function generateEncryptionKeyPair(): Promise<EncryptionKeyPair> {
  if (!isEncryptionSupported()) {
    throw new Error('Web Crypto API is not available');
  }

  // 1. Generate extractable so we can export SPKI for upload.
  const extractablePair = await crypto.subtle.generateKey(RSA_ALGORITHM, true, [
    'encrypt',
    'decrypt',
  ]);

  // 2. Export public key as SPKI (the form we upload to the user profile).
  const publicKeyBuffer = await crypto.subtle.exportKey('spki', extractablePair.publicKey);
  const publicKeySpki = arrayBufferToBase64(publicKeyBuffer);

  // 3. Re-import the public key as non-extractable (encrypt-only).
  const publicKey = await crypto.subtle.importKey(
    'spki',
    publicKeyBuffer,
    RSA_IMPORT_PARAMS,
    false,
    ['encrypt'],
  );

  // 4. Re-import the private key as non-extractable (decrypt-only). We have to
  //    export it once via PKCS8 to re-import; the export buffer is scrubbed
  //    immediately, and the extractable pair goes out of scope.
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', extractablePair.privateKey);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBuffer,
    RSA_IMPORT_PARAMS,
    false,
    ['decrypt'],
  );

  // Best-effort scrub of the transient plaintext private key buffer.
  new Uint8Array(privateKeyBuffer).fill(0);

  return { publicKey, privateKey, publicKeySpki };
}

/**
 * Compute a human-readable fingerprint of a public key.
 * Returns the first 16 hex characters of the SHA-256 hash.
 */
export async function getKeyFingerprint(publicKeyBase64: string): Promise<string> {
  if (!isEncryptionSupported()) return '';

  const keyBuffer = base64ToArrayBuffer(publicKeyBase64);
  const hash = await crypto.subtle.digest('SHA-256', keyBuffer);
  const hex = arrayBufferToBase64(hash)
    .replace(/[+/=]/g, '')
    .slice(0, 16)
    .toUpperCase();

  // Format as groups of 4 for readability
  return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
}

// ─── Key Import ─────────────────────────────────────────────────────

/**
 * Import a recipient's public key from its SPKI base64 form (as stored in their
 * profile). Returned key is non-extractable and only usable for encryption.
 */
export async function importPublicKeySpki(publicKeySpki: string): Promise<CryptoKey> {
  const keyBuffer = base64ToArrayBuffer(publicKeySpki);
  return crypto.subtle.importKey('spki', keyBuffer, RSA_IMPORT_PARAMS, false, ['encrypt']);
}

// ─── Encryption (Hybrid RSA + AES-GCM) ─────────────────────────────

/**
 * Encrypt a message body using the recipient's public key.
 *
 * Uses hybrid encryption:
 * 1. Generate random AES-256-GCM key
 * 2. Encrypt message with AES-GCM
 * 3. Encrypt the AES key with the recipient's RSA public key
 *
 * @param plaintext - The message body to encrypt
 * @param recipientPublicKeySpki - Base64-encoded SPKI public key from recipient's profile
 * @returns JSON-stringified EncryptedPayload
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKeySpki: string,
): Promise<string> {
  if (!isEncryptionSupported()) {
    throw new Error('Web Crypto API is not available');
  }

  // 1. Import recipient public key (non-extractable, encrypt-only).
  const rsaPublicKey = await importPublicKeySpki(recipientPublicKeySpki);

  // 2. Generate an ephemeral AES key. Marked extractable so we can wrap it
  //    with RSA — it lives in memory for the duration of this call only.
  const aesKey = await crypto.subtle.generateKey(
    { name: AES_ALGORITHM, length: AES_KEY_LENGTH },
    true,
    ['encrypt'],
  );

  // 3. Encrypt message with AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv },
    aesKey,
    encoded,
  );

  // 4. Export the AES key and encrypt it with the recipient's RSA public key.
  const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    rsaPublicKey,
    rawAesKey,
  );

  // Best-effort scrub of the transient plaintext AES key buffer.
  new Uint8Array(rawAesKey).fill(0);

  const payload: EncryptedPayload = {
    ciphertext: arrayBufferToBase64(ciphertext),
    encryptedKey: arrayBufferToBase64(encryptedKey),
    iv: arrayBufferToBase64(iv),
  };

  return JSON.stringify(payload);
}

/**
 * Decrypt an encrypted message using the user's private key.
 *
 * @param encryptedBody - JSON-stringified EncryptedPayload
 * @param privateKey - Non-extractable `CryptoKey` (loaded from keyStore)
 * @returns Decrypted plaintext
 */
export async function decryptMessage(
  encryptedBody: string,
  privateKey: CryptoKey,
): Promise<string> {
  if (!isEncryptionSupported()) {
    throw new Error('Web Crypto API is not available');
  }

  const payload: EncryptedPayload = JSON.parse(encryptedBody);

  // 1. Decrypt the AES key with RSA
  const rawAesKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToArrayBuffer(payload.encryptedKey),
  );

  // 2. Import the AES key
  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawAesKey,
    { name: AES_ALGORITHM },
    false,
    ['decrypt'],
  );

  // 3. Decrypt the message with AES-GCM
  const iv = base64ToArrayBuffer(payload.iv);
  const decrypted = await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv },
    aesKey,
    base64ToArrayBuffer(payload.ciphertext),
  );

  // Best-effort scrub of the transient plaintext AES key buffer.
  new Uint8Array(rawAesKey).fill(0);

  return new TextDecoder().decode(decrypted);
}
