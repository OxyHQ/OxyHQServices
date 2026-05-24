/**
 * IndexedDB-backed storage for the Inbox encryption key pair.
 *
 * Why IndexedDB and not localStorage?
 * - IndexedDB supports structured cloning of `CryptoKey` objects, including
 *   non-extractable ones. This means the private key can live entirely inside
 *   the browser's crypto subsystem and never appear as plaintext to JS.
 * - localStorage only stores strings, which would force us to export the key
 *   as PKCS8 base64 — exactly what XSS attackers want.
 *
 * The public key is also stored as a `CryptoKey` (for encrypting outgoing
 * drafts to ourselves) plus its SPKI base64 form (for sharing with senders).
 *
 * Native (iOS / Android) is a no-op — IndexedDB only exists on web. Mobile
 * clients fall back to server-mediated decryption or a separate native
 * keystore implementation (out of scope here).
 */

import { Platform } from 'react-native';

const DB_NAME = 'oxy_inbox_keys';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const PRIVATE_KEY_ID = 'private';
const PUBLIC_KEY_ID = 'public';
const PUBLIC_KEY_SPKI_ID = 'publicSpki';

function isWeb(): boolean {
  return Platform.OS === 'web' && typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isWeb()) {
      reject(new Error('IndexedDB is not available on this platform'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('Failed to open key store'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onblocked = () => reject(new Error('Key store upgrade blocked by another tab'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const req = op(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Key store request failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Key store transaction aborted'));
    });
  } finally {
    db.close();
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Persist a generated key pair to IndexedDB. The `CryptoKey` objects themselves
 * are stored (structured-cloneable); their plaintext form never touches disk
 * because they're non-extractable.
 */
export async function storeKeyPair(
  publicKey: CryptoKey,
  privateKey: CryptoKey,
  publicKeySpki: string,
): Promise<void> {
  if (!isWeb()) return;
  await withStore('readwrite', (s) => s.put(privateKey, PRIVATE_KEY_ID));
  await withStore('readwrite', (s) => s.put(publicKey, PUBLIC_KEY_ID));
  await withStore('readwrite', (s) => s.put(publicKeySpki, PUBLIC_KEY_SPKI_ID));
}

/**
 * Retrieve the user's private decryption key, or `null` if none is stored.
 */
export async function getStoredPrivateKey(): Promise<CryptoKey | null> {
  if (!isWeb()) return null;
  try {
    const result = await withStore<unknown>('readonly', (s) => s.get(PRIVATE_KEY_ID));
    return result instanceof CryptoKey ? result : null;
  } catch {
    return null;
  }
}

/**
 * Retrieve the user's public key (for encrypting outgoing drafts to self).
 */
export async function getStoredPublicKey(): Promise<CryptoKey | null> {
  if (!isWeb()) return null;
  try {
    const result = await withStore<unknown>('readonly', (s) => s.get(PUBLIC_KEY_ID));
    return result instanceof CryptoKey ? result : null;
  } catch {
    return null;
  }
}

/**
 * Retrieve the SPKI base64 form of the public key, suitable for upload to
 * the user's profile / sharing with senders.
 */
export async function getStoredPublicKeySpki(): Promise<string | null> {
  if (!isWeb()) return null;
  try {
    const result = await withStore<unknown>('readonly', (s) => s.get(PUBLIC_KEY_SPKI_ID));
    return typeof result === 'string' ? result : null;
  } catch {
    return null;
  }
}

/**
 * Cheap check for "is the user already provisioned with a key pair?"
 */
export async function hasStoredKeys(): Promise<boolean> {
  return (await getStoredPrivateKey()) !== null;
}

/**
 * Wipe all stored keys (used for key revocation / sign-out).
 */
export async function clearStoredKeys(): Promise<void> {
  if (!isWeb()) return;
  try {
    await withStore('readwrite', (s) => s.delete(PRIVATE_KEY_ID));
    await withStore('readwrite', (s) => s.delete(PUBLIC_KEY_ID));
    await withStore('readwrite', (s) => s.delete(PUBLIC_KEY_SPKI_ID));
  } catch {
    // Wiping is best-effort; failures here just mean stale entries remain.
  }
}

