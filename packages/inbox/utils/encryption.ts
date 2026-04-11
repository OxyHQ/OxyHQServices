/**
 * Encryption utilities for Oxy Inbox.
 *
 * Uses Web Crypto API (RSA-OAEP, 2048-bit) for basic encrypted messaging
 * between Oxy users. No external dependencies.
 *
 * Key storage:
 * - Public key: stored on user profile via API (available to senders)
 * - Private key: stored in localStorage (browser-side only, never sent to server)
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

const AES_ALGORITHM = 'AES-GCM';
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12; // bytes

const PRIVATE_KEY_STORAGE = 'inbox_encryption_private_key';
const PUBLIC_KEY_STORAGE = 'inbox_encryption_public_key';

// ─── Type Helpers ───────────────────────────────────────────────────

export interface EncryptionKeyPair {
  publicKey: string; // base64-encoded SPKI
  privateKey: string; // base64-encoded PKCS8
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
 * Returns base64-encoded public (SPKI) and private (PKCS8) keys.
 */
export async function generateEncryptionKeyPair(): Promise<EncryptionKeyPair> {
  if (!isEncryptionSupported()) {
    throw new Error('Web Crypto API is not available');
  }

  const keyPair = await crypto.subtle.generateKey(RSA_ALGORITHM, true, [
    'encrypt',
    'decrypt',
  ]);

  const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  return {
    publicKey: arrayBufferToBase64(publicKeyBuffer),
    privateKey: arrayBufferToBase64(privateKeyBuffer),
  };
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

async function importPublicKey(base64: string): Promise<CryptoKey> {
  const keyBuffer = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    'spki',
    keyBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
}

async function importPrivateKey(base64: string): Promise<CryptoKey> {
  const keyBuffer = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
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
 * @param recipientPublicKey - Base64-encoded SPKI public key
 * @returns JSON-stringified EncryptedPayload
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: string,
): Promise<string> {
  if (!isEncryptionSupported()) {
    throw new Error('Web Crypto API is not available');
  }

  // 1. Generate random AES key
  const aesKey = await crypto.subtle.generateKey(
    { name: AES_ALGORITHM, length: AES_KEY_LENGTH },
    true,
    ['encrypt'],
  );

  // 2. Encrypt message with AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv },
    aesKey,
    encoded,
  );

  // 3. Export AES key and encrypt with RSA
  const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);
  const rsaPublicKey = await importPublicKey(recipientPublicKey);
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    rsaPublicKey,
    rawAesKey,
  );

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
 * @param privateKeyBase64 - Base64-encoded PKCS8 private key
 * @returns Decrypted plaintext
 */
export async function decryptMessage(
  encryptedBody: string,
  privateKeyBase64: string,
): Promise<string> {
  if (!isEncryptionSupported()) {
    throw new Error('Web Crypto API is not available');
  }

  const payload: EncryptedPayload = JSON.parse(encryptedBody);

  // 1. Decrypt the AES key with RSA
  const rsaPrivateKey = await importPrivateKey(privateKeyBase64);
  const rawAesKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    rsaPrivateKey,
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

  return new TextDecoder().decode(decrypted);
}

// ─── Local Key Storage ──────────────────────────────────────────────

/**
 * Store the encryption key pair locally.
 * Private key goes to localStorage; public key also stored for quick access.
 */
export function storeKeyPair(keyPair: EncryptionKeyPair): void {
  if (Platform.OS !== 'web') return;
  try {
    localStorage.setItem(PRIVATE_KEY_STORAGE, keyPair.privateKey);
    localStorage.setItem(PUBLIC_KEY_STORAGE, keyPair.publicKey);
  } catch {
    throw new Error('Failed to store encryption keys');
  }
}

/**
 * Get the stored private key (for decryption).
 */
export function getStoredPrivateKey(): string | null {
  if (Platform.OS !== 'web') return null;
  try {
    return localStorage.getItem(PRIVATE_KEY_STORAGE);
  } catch {
    return null;
  }
}

/**
 * Get the stored public key.
 */
export function getStoredPublicKey(): string | null {
  if (Platform.OS !== 'web') return null;
  try {
    return localStorage.getItem(PUBLIC_KEY_STORAGE);
  } catch {
    return null;
  }
}

/**
 * Check if the user has a local encryption key pair.
 */
export function hasLocalKeyPair(): boolean {
  return getStoredPrivateKey() !== null && getStoredPublicKey() !== null;
}

/**
 * Clear stored encryption keys (key revocation).
 */
export function clearStoredKeys(): void {
  if (Platform.OS !== 'web') return;
  try {
    localStorage.removeItem(PRIVATE_KEY_STORAGE);
    localStorage.removeItem(PUBLIC_KEY_STORAGE);
  } catch {
    // noop
  }
}
