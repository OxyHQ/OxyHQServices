/**
 * Key Manager - ECDSA secp256k1 Key Generation and Storage
 *
 * Handles secure generation, storage, and retrieval of cryptographic keys.
 * Private keys are stored securely using expo-secure-store and never leave the device.
 */

import { ec as EC } from 'elliptic';
import type { ECKeyPair } from 'elliptic';
import type { SecureStoreOptions } from 'expo-secure-store';
import { isWeb, isIOS, isAndroid, isReactNative, isNodeJS } from '../utils/platform';
import { loadExpoCrypto, loadNodeCrypto, loadSecureStore } from '../utils/platformCrypto';
import { logger } from '../utils/loggerUtils';
import { isDev } from '../shared/utils/debugUtils';

/**
 * Extended SecureStoreOptions that explicitly includes `keychainAccessGroup`.
 *
 * The shipped `expo-secure-store` types in this repo (see
 * `src/types/expo-secure-store.d.ts`) already declare `keychainAccessGroup`,
 * but we redeclare it here as an `interface extends ...` so the field stays
 * type-safe even when the upstream package types drift. Older versions of
 * `@types/expo-secure-store` omitted this field, which is why the code base
 * used to fall back to `as any` — that escape hatch is now removed.
 */
interface OxySecureStoreOptions extends SecureStoreOptions {
  /**
   * iOS Keychain access group. Required for sharing identity material across
   * apps in the Oxy ecosystem via Keychain Sharing entitlements. The
   * underlying `expo-secure-store` runtime supports this option.
   */
  keychainAccessGroup?: string;
}

/**
 * Thrown when an identity-mutating operation (createIdentity / importKeyPair)
 * is invoked while a valid identity already exists on the device.
 *
 * The local private key IS the user's identity — overwriting it without
 * explicit consent permanently loses access to their account (unless
 * they previously saved their recovery phrase). This error forces callers
 * to make an explicit, audited decision instead of silently clobbering.
 */
export class IdentityAlreadyExistsError extends Error {
  override readonly name = 'IdentityAlreadyExistsError';
  readonly existingPublicKey: string;
  constructor(existingPublicKey: string) {
    super(
      'An identity already exists on this device. Refusing to overwrite without explicit consent. ' +
        'If you really want to replace it, ensure the user has saved their recovery phrase, then call ' +
        'the operation with { overwrite: true }.'
    );
    this.existingPublicKey = existingPublicKey;
  }
}

/**
 * Thrown when a freshly written identity cannot be read back, parsed, or
 * round-tripped through sign/verify. Indicates a storage failure or
 * corruption that would otherwise silently leave the user with an
 * unusable account.
 */
export class IdentityPersistError extends Error {
  override readonly name = 'IdentityPersistError';
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

const ec = new EC('secp256k1');

const STORAGE_KEYS = {
  PRIVATE_KEY: 'oxy_identity_private_key',
  PUBLIC_KEY: 'oxy_identity_public_key',
  BACKUP_PRIVATE_KEY: 'oxy_identity_backup_private_key',
  BACKUP_PUBLIC_KEY: 'oxy_identity_backup_public_key',
  BACKUP_TIMESTAMP: 'oxy_identity_backup_timestamp',
  // Shared keys accessible across all Oxy apps (iOS Keychain Group / Android Account Manager)
  SHARED_PRIVATE_KEY: 'oxy_shared_identity_private_key',
  SHARED_PUBLIC_KEY: 'oxy_shared_identity_public_key',
  SHARED_SESSION_TOKEN: 'oxy_shared_session_token',
  SHARED_SESSION_ID: 'oxy_shared_session_id',
} as const;

/**
 * iOS Keychain Access Group for sharing identities across Oxy apps
 * All Oxy apps must have this access group enabled in their entitlements
 * Format: [Team ID].com.oxy.shared or group.com.oxy.shared
 */
const IOS_KEYCHAIN_GROUP = 'group.com.oxy.shared';

/**
 * Android Account Manager type for shared authentication
 * Used with sharedUserId to share sessions across apps
 */
const ANDROID_ACCOUNT_TYPE = 'com.oxy.account';

/**
 * Initialize React Native specific modules
 *
 * Delegates to `platformCrypto`, which is a per-platform module
 * (`platformCrypto.ts` vs `platformCrypto.react-native.ts`) selected by the
 * consumer's bundler. On RN it returns a statically-imported handle to
 * `expo-secure-store`; off RN it throws (and is never called because every
 * caller is gated by `isWebPlatform()` / native-only paths).
 */
async function initSecureStore(): Promise<typeof import('expo-secure-store')> {
  try {
    return await loadSecureStore();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load expo-secure-store: ${errorMessage}. ` +
        'Make sure expo-secure-store is installed and properly configured.',
    );
  }
}

/**
 * Check if we're on web platform
 * Identity storage is only available on native platforms (iOS/Android)
 */
function isWebPlatform(): boolean {
  return isWeb();
}

async function initExpoCrypto(): Promise<typeof import('expo-crypto')> {
  // Same per-platform delegation as initSecureStore — see comment there.
  return loadExpoCrypto();
}

/**
 * Convert Uint8Array to hexadecimal string
 * Works in both Node.js and React Native
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate cryptographically secure random bytes
 */
async function getSecureRandomBytes(length: number): Promise<Uint8Array> {
  // In React Native, always use expo-crypto
  if (isReactNative() || !isNodeJS()) {
    const Crypto = await initExpoCrypto();
    return Crypto.getRandomBytes(length);
  }
  
  // In Node.js, use Node's crypto module.
  //
  // `loadNodeCrypto` is per-platform: the default variant performs
  // `await import('crypto')`, the RN variant throws (and we'd never reach
  // here on RN because the early-return above caught it).
  try {
    const nodeCrypto = await loadNodeCrypto();
    return new Uint8Array(nodeCrypto.randomBytes(length));
  } catch (error) {
    // Fallback to expo-crypto if Node crypto fails (defensive — should not
    // happen on real Node, but the platform-detection edge cases are
    // surprisingly varied).
    const Crypto = await initExpoCrypto();
    return Crypto.getRandomBytes(length);
  }
}

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export class KeyManager {
  // In-memory cache for identity state (invalidated on identity changes)
  private static cachedPublicKey: string | null = null;
  private static cachedHasIdentity: boolean | null = null;
  private static cachedSharedPublicKey: string | null = null;
  private static cachedHasSharedIdentity: boolean | null = null;

  /**
   * Invalidate cached identity state
   * Called internally when identity is created/deleted/imported
   */
  private static invalidateCache(): void {
    KeyManager.cachedPublicKey = null;
    KeyManager.cachedHasIdentity = null;
  }

  /**
   * Invalidate cached shared identity state
   * Called internally when shared identity is created/deleted/imported
   */
  private static invalidateSharedCache(): void {
    KeyManager.cachedSharedPublicKey = null;
    KeyManager.cachedHasSharedIdentity = null;
  }

  /**
   * Lowercase and pad to canonical 64-hex-char form.
   *
   * Tolerates the 1-in-256 leading-zero-strip that elliptic's
   * `getPrivate('hex')` produces, and the externally-imported uppercase-hex
   * legacy keys. EVERY `ec.keyFromPrivate(...)` call site in this file must
   * canonicalize first so that derivation is stable regardless of storage
   * representation.
   *
   * Private (used only inside KeyManager) — public consumers should not need
   * to think about hex representation.
   */
  private static canonicalPrivateKey(key: string): string {
    return key.toLowerCase().padStart(64, '0');
  }

  /**
   * Generate a new ECDSA secp256k1 key pair
   * Returns the keys in hexadecimal format
   */
  static generateKeyPairSync(): KeyPair {
    const keyPair = ec.genKeyPair();
    // Pad to canonical 64 hex chars. `elliptic`'s `getPrivate('hex')` strips
    // leading zero bytes which would otherwise corrupt strict-length checks
    // and signature derivation on the read path.
    return {
      privateKey: keyPair.getPrivate('hex').padStart(64, '0'),
      publicKey: keyPair.getPublic('hex'),
    };
  }

  /**
   * Generate a new key pair using secure random bytes
   */
  static async generateKeyPair(): Promise<KeyPair> {
    const randomBytes = await getSecureRandomBytes(32);
    const privateKeyHex = uint8ArrayToHex(randomBytes);
    const keyPair = ec.keyFromPrivate(KeyManager.canonicalPrivateKey(privateKeyHex));

    return {
      privateKey: keyPair.getPrivate('hex').padStart(64, '0'),
      publicKey: keyPair.getPublic('hex'),
    };
  }

  // ==================== SHARED IDENTITY METHODS ====================
  // These methods enable cross-app session sharing (like Google)
  // iOS: Uses Keychain Access Groups
  // Android: Uses Account Manager with shared user ID
  // =================================================================

  /**
   * Create a shared identity accessible across all Oxy apps
   *
   * iOS: Stores in shared keychain group (requires entitlement configuration)
   * Android: Stores in Account Manager (requires sharedUserId in manifest)
   *
   * This enables true cross-app SSO - when user signs in to one Oxy app,
   * they're automatically signed in to all other Oxy apps.
   *
   * @returns Public key of the shared identity
   * @throws Error if not on native platform or if sharing is not configured
   */
  static async createSharedIdentity(): Promise<string> {
    if (isWebPlatform()) {
      throw new Error('Shared identity is only available on native platforms (iOS/Android).');
    }

    const store = await initSecureStore();
    const { privateKey, publicKey } = await KeyManager.generateKeyPair();

    if (isIOS()) {
      // iOS: Store in shared keychain group
      // Note: keychainAccessGroup requires Keychain Sharing capability in Xcode
      try {
        const privateOpts: OxySecureStoreOptions = {
          keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          keychainAccessGroup: IOS_KEYCHAIN_GROUP, // Enables sharing across apps
        };
        await store.setItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, privateKey, privateOpts);

        const publicOpts: OxySecureStoreOptions = {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        };
        await store.setItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, publicKey, publicOpts);
      } catch (error) {
        throw new Error(
          `Failed to create shared identity on iOS. Ensure your app has the Keychain Sharing capability enabled with access group "${IOS_KEYCHAIN_GROUP}". Error: ${error}`
        );
      }
    } else if (isAndroid()) {
      // Android: Store in secure store (accessible via sharedUserId)
      // Note: All Oxy apps must have the same sharedUserId in AndroidManifest.xml
      await store.setItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, privateKey, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });

      await store.setItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, publicKey);
    }

    // Update cache
    KeyManager.cachedSharedPublicKey = publicKey;
    KeyManager.cachedHasSharedIdentity = true;

    if (isDev()) {
      logger.debug('Shared identity created successfully', { component: 'KeyManager' });
    }

    return publicKey;
  }

  /**
   * Get the shared public key (accessible across all Oxy apps)
   *
   * @returns Shared public key or null if no shared identity exists
   */
  static async getSharedPublicKey(): Promise<string | null> {
    if (isWebPlatform()) {
      return null;
    }

    // Return cached value if available
    if (KeyManager.cachedSharedPublicKey !== null) {
      return KeyManager.cachedSharedPublicKey;
    }

    try {
      const store = await initSecureStore();
      let publicKey: string | null = null;

      if (isIOS()) {
        const opts: OxySecureStoreOptions = { keychainAccessGroup: IOS_KEYCHAIN_GROUP };
        publicKey = await store.getItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, opts);
      } else if (isAndroid()) {
        publicKey = await store.getItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY);
      }

      // Cache result
      KeyManager.cachedSharedPublicKey = publicKey;

      return publicKey;
    } catch (error) {
      if (isDev()) {
        logger.warn('Failed to get shared public key', { component: 'KeyManager' }, error);
      }
      KeyManager.cachedSharedPublicKey = null;
      return null;
    }
  }

  /**
   * Get the shared private key (for signing operations)
   *
   * WARNING: Only use this for signing operations within the app.
   * The private key should NEVER be transmitted or exposed.
   *
   * @returns Shared private key or null if no shared identity exists
   */
  static async getSharedPrivateKey(): Promise<string | null> {
    if (isWebPlatform()) {
      return null;
    }

    try {
      const store = await initSecureStore();
      let privateKey: string | null = null;

      if (isIOS()) {
        const opts: OxySecureStoreOptions = { keychainAccessGroup: IOS_KEYCHAIN_GROUP };
        privateKey = await store.getItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, opts);
      } else if (isAndroid()) {
        privateKey = await store.getItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY);
      }

      return privateKey;
    } catch (error) {
      if (isDev()) {
        logger.warn('Failed to get shared private key', { component: 'KeyManager' }, error);
      }
      return null;
    }
  }

  /**
   * Check if a shared identity exists (accessible across all Oxy apps)
   *
   * @returns True if shared identity exists, false otherwise
   */
  static async hasSharedIdentity(): Promise<boolean> {
    if (isWebPlatform()) {
      return false;
    }

    // Return cached value if available
    if (KeyManager.cachedHasSharedIdentity !== null) {
      return KeyManager.cachedHasSharedIdentity;
    }

    try {
      const privateKey = await KeyManager.getSharedPrivateKey();
      const hasShared = privateKey !== null;

      // Cache result
      KeyManager.cachedHasSharedIdentity = hasShared;

      return hasShared;
    } catch (error) {
      if (isDev()) {
        logger.warn('Failed to check shared identity', { component: 'KeyManager' }, error);
      }
      KeyManager.cachedHasSharedIdentity = false;
      return false;
    }
  }

  /**
   * Import an existing key pair as shared identity
   *
   * This is used when:
   * 1. User signs in to a new Oxy app for the first time
   * 2. User has existing identity on another Oxy app
   * 3. We want to sync the identity across apps
   *
   * @param privateKey - Private key in hex format
   * @returns Public key
   */
  static async importSharedIdentity(privateKey: string): Promise<string> {
    if (isWebPlatform()) {
      throw new Error('Shared identity import is only available on native platforms.');
    }

    const store = await initSecureStore();
    // Canonicalize incoming key BEFORE storage so the stored value is always
    // in canonical 64-hex-char lowercase form going forward. Without this,
    // legacy short keys would derive a different public key on the read path.
    const canonicalPrivate = KeyManager.canonicalPrivateKey(privateKey);
    const keyPair = ec.keyFromPrivate(canonicalPrivate);
    const publicKey = keyPair.getPublic('hex');

    if (isIOS()) {
      const privateOpts: OxySecureStoreOptions = {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        keychainAccessGroup: IOS_KEYCHAIN_GROUP,
      };
      await store.setItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, canonicalPrivate, privateOpts);

      const publicOpts: OxySecureStoreOptions = {
        keychainAccessGroup: IOS_KEYCHAIN_GROUP,
      };
      await store.setItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, publicKey, publicOpts);
    } else if (isAndroid()) {
      await store.setItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, canonicalPrivate, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });

      await store.setItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, publicKey);
    }

    // Update cache
    KeyManager.cachedSharedPublicKey = publicKey;
    KeyManager.cachedHasSharedIdentity = true;

    if (isDev()) {
      logger.debug('Shared identity imported successfully', { component: 'KeyManager' });
    }

    return publicKey;
  }

  /**
   * Store session information in shared storage
   *
   * This allows all Oxy apps to access the same session without
   * re-authenticating. When user signs in to one app, all apps
   * get the session automatically.
   *
   * @param sessionId - Session ID from authentication
   * @param accessToken - Access token for API calls
   */
  static async storeSharedSession(sessionId: string, accessToken: string): Promise<void> {
    if (isWebPlatform()) {
      return; // Not supported on web
    }

    try {
      const store = await initSecureStore();

      if (isIOS()) {
        const sessionIdOpts: OxySecureStoreOptions = {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        };
        await store.setItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, sessionId, sessionIdOpts);

        const tokenOpts: OxySecureStoreOptions = {
          keychainAccessible: store.WHEN_UNLOCKED,
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        };
        await store.setItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, accessToken, tokenOpts);
      } else if (isAndroid()) {
        await store.setItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, sessionId);
        await store.setItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, accessToken);
      }

      if (isDev()) {
        logger.debug('Shared session stored successfully', { component: 'KeyManager' });
      }
    } catch (error) {
      if (isDev()) {
        logger.error('Failed to store shared session', error, { component: 'KeyManager' });
      }
      throw error;
    }
  }

  /**
   * Get shared session information
   *
   * This allows any Oxy app to check if user is already signed in
   * via another Oxy app. Enables instant cross-app SSO.
   *
   * @returns Session data or null if no shared session exists
   */
  static async getSharedSession(): Promise<{ sessionId: string; accessToken: string } | null> {
    if (isWebPlatform()) {
      return null;
    }

    try {
      const store = await initSecureStore();
      let sessionId: string | null = null;
      let accessToken: string | null = null;

      if (isIOS()) {
        const opts: OxySecureStoreOptions = { keychainAccessGroup: IOS_KEYCHAIN_GROUP };
        sessionId = await store.getItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, opts);
        accessToken = await store.getItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, opts);
      } else if (isAndroid()) {
        sessionId = await store.getItemAsync(STORAGE_KEYS.SHARED_SESSION_ID);
        accessToken = await store.getItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN);
      }

      if (!sessionId || !accessToken) {
        return null;
      }

      return { sessionId, accessToken };
    } catch (error) {
      if (isDev()) {
        logger.warn('Failed to get shared session', { component: 'KeyManager' }, error);
      }
      return null;
    }
  }

  /**
   * Clear shared session (on logout)
   *
   * This signs out the user from ALL Oxy apps simultaneously.
   * Call this when user explicitly logs out.
   */
  static async clearSharedSession(): Promise<void> {
    if (isWebPlatform()) {
      return;
    }

    try {
      const store = await initSecureStore();

      if (isIOS()) {
        const opts: OxySecureStoreOptions = { keychainAccessGroup: IOS_KEYCHAIN_GROUP };
        await store.deleteItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, opts);
        await store.deleteItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, opts);
      } else if (isAndroid()) {
        await store.deleteItemAsync(STORAGE_KEYS.SHARED_SESSION_ID);
        await store.deleteItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN);
      }

      if (isDev()) {
        logger.debug('Shared session cleared successfully', { component: 'KeyManager' });
      }
    } catch (error) {
      if (isDev()) {
        logger.error('Failed to clear shared session', error, { component: 'KeyManager' });
      }
    }
  }

  /**
   * Migrate local identity to shared identity
   *
   * Call this when upgrading existing apps to use shared identities.
   * Copies the device-specific identity to shared storage so it can
   * be accessed by other Oxy apps.
   *
   * @returns True if migration was successful, false if no local identity exists
   */
  static async migrateToSharedIdentity(): Promise<boolean> {
    if (isWebPlatform()) {
      return false;
    }

    try {
      // Check if we already have a shared identity
      const hasShared = await KeyManager.hasSharedIdentity();
      if (hasShared) {
        if (isDev()) {
          logger.debug('Shared identity already exists, skipping migration', { component: 'KeyManager' });
        }
        return true;
      }

      // Get local identity
      const privateKey = await KeyManager.getPrivateKey();
      if (!privateKey) {
        if (isDev()) {
          logger.debug('No local identity to migrate', { component: 'KeyManager' });
        }
        return false;
      }

      // Import to shared storage
      await KeyManager.importSharedIdentity(privateKey);

      if (isDev()) {
        logger.debug('Successfully migrated local identity to shared identity', { component: 'KeyManager' });
      }

      return true;
    } catch (error) {
      if (isDev()) {
        logger.error('Failed to migrate to shared identity', error, { component: 'KeyManager' });
      }
      return false;
    }
  }

  // ==================== END SHARED IDENTITY METHODS ====================

  /**
   * Atomically persist a key pair to secure storage with verification + backup.
   *
   * INVARIANT (the reason this method exists): at no instant during the write
   * may the device be left holding ZERO recoverable copies of a healthy
   * identity. This matters most on the OVERWRITE / account-switch path: if we
   * are replacing identity A with B and the write fails halfway, we MUST end
   * up back on A — never on a half-written B, and never on nothing.
   *
   * Algorithm (recoverability-preserving):
   *   0. Snapshot the existing primary (privA, pubA) so we can roll back to
   *      EXACTLY what was there.
   *   1. Write the new primary: public first, then private.
   *   2. Read back + sign/verify the new primary.
   *   3. ONLY after the new primary is proven durable, refresh the backup to
   *      the new key. The backup is NEVER touched before this point, so any
   *      prior identity's backup remains intact and `restoreIdentityFromBackup`
   *      can always recover it.
   *   4. On ANY failure in steps 1–2, restore the snapshotted primary verbatim
   *      (or delete it if there was none), then surface the error.
   *
   * Earlier versions wrote the *incoming* key to the backup FIRST, which
   * destroyed the previous identity's backup, and rolled back by blindly
   * deleting the primary — so a failed overwrite silently switched the user
   * to (or lost them into) the half-written new identity. That is fixed here.
   *
   * @internal
   */
  private static async _persistIdentityAtomic(
    privateKey: string,
    publicKey: string,
  ): Promise<void> {
    const store = await initSecureStore();

    // Canonicalize BEFORE persistence so the stored value is always in
    // canonical 64-hex-char lowercase form going forward. This is the single
    // place all primary writes flow through, so once a value lands here all
    // subsequent reads see a stable representation.
    const canonicalPrivate = KeyManager.canonicalPrivateKey(privateKey);
    const canonicalPublic = publicKey.toLowerCase();

    // Step 0: Snapshot the existing primary so a failed write can be rolled
    // back to EXACTLY the prior state. If the read itself fails we treat the
    // prior primary as unknown and refuse to proceed — overwriting blind
    // would risk clobbering an identity we just couldn't see (e.g. a
    // transient keychain lock).
    let priorPrivate: string | null;
    let priorPublic: string | null;
    try {
      priorPrivate = await store.getItemAsync(STORAGE_KEYS.PRIVATE_KEY);
      priorPublic = await store.getItemAsync(STORAGE_KEYS.PUBLIC_KEY);
    } catch (error) {
      logger.error('Failed to read existing primary before persist', error, { component: 'KeyManager' });
      throw new IdentityPersistError(
        'Could not read existing identity before writing a new one; refusing to overwrite blind.',
        error,
      );
    }

    // If we are replacing a DIFFERENT, currently-healthy identity, make sure
    // it is recoverable from the backup slot BEFORE we overwrite the primary.
    // We only do this when the existing backup does not already hold that
    // identity — otherwise we would needlessly churn the keychain. This keeps
    // the "always at least one recoverable copy" invariant intact across the
    // window where the primary briefly holds the new key but the new backup
    // has not been written yet.
    const priorIsHealthyDifferent =
      !!priorPrivate &&
      !!priorPublic &&
      priorPublic.toLowerCase() !== canonicalPublic &&
      KeyManager.isValidPrivateKey(priorPrivate) &&
      KeyManager.isValidPublicKey(priorPublic) &&
      KeyManager.derivePublicKey(priorPrivate).toLowerCase() === priorPublic.toLowerCase();

    if (priorIsHealthyDifferent && priorPrivate && priorPublic) {
      let existingBackupPublic: string | null = null;
      try {
        existingBackupPublic = await store.getItemAsync(STORAGE_KEYS.BACKUP_PUBLIC_KEY);
      } catch {
        existingBackupPublic = null;
      }
      if (existingBackupPublic?.toLowerCase() !== priorPublic.toLowerCase()) {
        try {
          await store.setItemAsync(STORAGE_KEYS.BACKUP_PRIVATE_KEY, KeyManager.canonicalPrivateKey(priorPrivate), {
            keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
          await store.setItemAsync(STORAGE_KEYS.BACKUP_PUBLIC_KEY, priorPublic.toLowerCase());
          await store.setItemAsync(STORAGE_KEYS.BACKUP_TIMESTAMP, Date.now().toString());
        } catch (error) {
          logger.error('Failed to back up existing identity before overwrite', error, { component: 'KeyManager' });
          throw new IdentityPersistError('Failed to back up existing identity before overwrite', error);
        }
      }
    }

    // Step 1: Write the new primary. Public first so that if the private write
    // fails we are missing the most critical bit. The backup is intentionally
    // NOT touched here — it still holds the previous good identity until the
    // new primary is proven durable.
    try {
      await store.setItemAsync(STORAGE_KEYS.PUBLIC_KEY, canonicalPublic);
      await store.setItemAsync(STORAGE_KEYS.PRIVATE_KEY, canonicalPrivate, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch (error) {
      logger.error('Failed to write primary identity to secure store', error, { component: 'KeyManager' });
      await KeyManager._rollbackPrimary(store, priorPrivate, priorPublic);
      throw new IdentityPersistError('Failed to write identity to secure store', error);
    }

    // Step 2: Verify round-trip. If the store silently drops our writes
    // (e.g., a misconfigured keychain access group), we MUST surface it
    // before declaring success — otherwise the caller will think the
    // identity was saved and discard the in-memory copy.
    let readBackPrivate: string | null;
    let readBackPublic: string | null;
    try {
      readBackPrivate = await store.getItemAsync(STORAGE_KEYS.PRIVATE_KEY);
      readBackPublic = await store.getItemAsync(STORAGE_KEYS.PUBLIC_KEY);
    } catch (error) {
      logger.error('Failed to read identity back after write', error, { component: 'KeyManager' });
      await KeyManager._rollbackPrimary(store, priorPrivate, priorPublic);
      throw new IdentityPersistError('Failed to verify identity after write', error);
    }

    // Hex comparisons are case-insensitive — normalize on both sides so a
    // store that uppercases on round-trip (some keychain backends) doesn't
    // trigger a spurious mismatch.
    if (
      readBackPrivate?.toLowerCase() !== canonicalPrivate ||
      readBackPublic?.toLowerCase() !== canonicalPublic
    ) {
      logger.error('Identity round-trip mismatch after write', undefined, { component: 'KeyManager' });
      await KeyManager._rollbackPrimary(store, priorPrivate, priorPublic);
      throw new IdentityPersistError('Identity write was not persisted correctly (round-trip mismatch).');
    }

    // Final sanity: derive public from the stored private and confirm the
    // pair signs/verifies cleanly. Catches a (theoretical) elliptic library
    // corruption immediately rather than the next time the user tries to
    // sign in.
    try {
      const keyPair = ec.keyFromPrivate(KeyManager.canonicalPrivateKey(readBackPrivate));
      const derived = keyPair.getPublic('hex');
      if (derived.toLowerCase() !== readBackPublic.toLowerCase()) {
        throw new IdentityPersistError('Stored public key does not match derived public key.');
      }
      // Sign/verify roundtrip using a known test vector
      const probeHash = '0'.repeat(64);
      const signature = keyPair.sign(probeHash);
      if (!keyPair.verify(probeHash, signature)) {
        throw new IdentityPersistError('Sign/verify roundtrip failed for newly stored identity.');
      }
    } catch (error) {
      await KeyManager._rollbackPrimary(store, priorPrivate, priorPublic);
      if (error instanceof IdentityPersistError) throw error;
      logger.error('Identity sign/verify probe failed', error, { component: 'KeyManager' });
      throw new IdentityPersistError('Stored identity failed crypto self-test', error);
    }

    // Step 3: The new primary is durable and functional. NOW it is safe to
    // refresh the backup to the new key. If this final backup write fails the
    // user still has a fully working primary, and the backup still holds the
    // PREVIOUS good identity — so we log and continue rather than failing the
    // whole operation (failing here would be strictly worse: a working
    // primary would be reported as an error to the caller).
    try {
      await store.setItemAsync(STORAGE_KEYS.BACKUP_PRIVATE_KEY, canonicalPrivate, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await store.setItemAsync(STORAGE_KEYS.BACKUP_PUBLIC_KEY, canonicalPublic);
      await store.setItemAsync(STORAGE_KEYS.BACKUP_TIMESTAMP, Date.now().toString());
    } catch (error) {
      logger.warn(
        'Primary identity persisted successfully but refreshing the backup failed; primary is usable, backup may be stale',
        { component: 'KeyManager' },
        error,
      );
    }

    // Update cache only after we are certain the identity is durable.
    KeyManager.cachedPublicKey = canonicalPublic;
    KeyManager.cachedHasIdentity = true;
  }

  /**
   * Restore the primary slot to a previously-snapshotted (privA, pubA) pair,
   * or delete it entirely if there was no prior identity. Best-effort: every
   * step is wrapped so a rollback failure never masks the original error the
   * caller is about to throw. Invalidates the in-memory cache so the next read
   * reflects whatever actually landed on disk.
   *
   * @internal
   */
  private static async _rollbackPrimary(
    store: Awaited<ReturnType<typeof initSecureStore>>,
    priorPrivate: string | null,
    priorPublic: string | null,
  ): Promise<void> {
    try {
      if (priorPrivate && priorPublic) {
        // Restore exactly what was there before the failed write.
        await store.setItemAsync(STORAGE_KEYS.PUBLIC_KEY, priorPublic, {});
        await store.setItemAsync(STORAGE_KEYS.PRIVATE_KEY, priorPrivate, {
          keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      } else {
        // There was no prior identity — leave the device empty rather than
        // half-written so hasIdentity() does not lie.
        try { await store.deleteItemAsync(STORAGE_KEYS.PUBLIC_KEY); } catch { /* best effort */ }
        try { await store.deleteItemAsync(STORAGE_KEYS.PRIVATE_KEY); } catch { /* best effort */ }
      }
    } catch (rollbackError) {
      logger.error('Failed to roll back primary identity after a failed write', rollbackError, { component: 'KeyManager' });
    } finally {
      // Whatever happened, the cached verdict is no longer trustworthy.
      KeyManager.invalidateCache();
    }
  }

  /**
   * Generate and securely store a new key pair on the device.
   *
   * Refuses to overwrite an existing identity unless `options.overwrite === true`.
   * Returns the public key. The private key never leaves secure storage.
   *
   * @throws IdentityAlreadyExistsError if an identity already exists and overwrite is not set
   * @throws IdentityPersistError if the key cannot be durably written
   */
  static async createIdentity(options?: { overwrite?: boolean }): Promise<string> {
    if (isWebPlatform()) {
      throw new Error('Identity creation is only available on native platforms (iOS/Android). Please use the native app to create your identity.');
    }

    // CRITICAL SAFEGUARD: never silently overwrite an existing identity.
    // The local key IS the account — clobbering it without consent is
    // catastrophic. Callers must opt in explicitly when they have already
    // confirmed (via UI) that the user has saved their recovery phrase.
    if (!options?.overwrite) {
      const existing = await KeyManager.getPublicKey();
      if (existing) {
        throw new IdentityAlreadyExistsError(existing);
      }
    }

    const { privateKey, publicKey } = await KeyManager.generateKeyPair();
    await KeyManager._persistIdentityAtomic(privateKey, publicKey);
    return publicKey;
  }

  /**
   * Import an existing key pair (e.g., from recovery phrase).
   *
   * Refuses to overwrite an existing identity unless `options.overwrite === true`.
   *
   * @throws IdentityAlreadyExistsError if an identity already exists and overwrite is not set
   * @throws IdentityPersistError if the key cannot be durably written
   */
  static async importKeyPair(
    privateKey: string,
    options?: { overwrite?: boolean },
  ): Promise<string> {
    if (isWebPlatform()) {
      throw new Error('Identity import is only available on native platforms (iOS/Android). Please use the native app to import your identity.');
    }

    if (!KeyManager.isValidPrivateKey(privateKey)) {
      throw new Error('Invalid private key supplied to importKeyPair.');
    }

    // Canonicalize the incoming private key so the stored value (and the
    // derived public key) are always in canonical form. Without this, an
    // externally-imported short or uppercase key would derive one public
    // key here and a different one when later read back unpadded.
    const canonicalPrivate = KeyManager.canonicalPrivateKey(privateKey);
    const keyPair = ec.keyFromPrivate(canonicalPrivate);
    const publicKey = keyPair.getPublic('hex');

    // Refuse silent overwrite — see createIdentity() for rationale.
    if (!options?.overwrite) {
      const existing = await KeyManager.getPublicKey();
      if (existing && existing.toLowerCase() !== publicKey.toLowerCase()) {
        throw new IdentityAlreadyExistsError(existing);
      }
      // If existing === publicKey, the device already has this exact identity;
      // re-persisting is a no-op but harmless. Fall through to ensure backup
      // is up to date.
    }

    await KeyManager._persistIdentityAtomic(canonicalPrivate, publicKey);
    return publicKey;
  }

  /**
   * Get the stored private key
   * WARNING: Only use this for signing operations within the app
   */
  static async getPrivateKey(): Promise<string | null> {
    if (isWebPlatform()) {
      return null; // Identity storage is only available on native platforms
    }
    try {
      const store = await initSecureStore();
      return await store.getItemAsync(STORAGE_KEYS.PRIVATE_KEY);
    } catch (error) {
      // If secure store is not available, return null (no identity)
      // This allows the app to continue functioning even if secure store fails to load
      if (isDev()) {
        logger.warn('Failed to access secure store', { component: 'KeyManager' }, error);
      }
      return null;
    }
  }

  /**
   * Get the stored public key (cached for performance)
   */
  static async getPublicKey(): Promise<string | null> {
    if (isWebPlatform()) {
      return null; // Identity storage is only available on native platforms
    }
    if (KeyManager.cachedPublicKey !== null) {
      return KeyManager.cachedPublicKey;
    }

    try {
      const store = await initSecureStore();
      const publicKey = await store.getItemAsync(STORAGE_KEYS.PUBLIC_KEY);
      
      // Cache result (null is a valid cache value meaning no identity)
      KeyManager.cachedPublicKey = publicKey;
      
      return publicKey;
    } catch (error) {
      // If secure store is not available, return null (no identity)
      // Cache null to avoid repeated failed attempts
      KeyManager.cachedPublicKey = null;
      if (isDev()) {
        logger.warn('Failed to access secure store', { component: 'KeyManager' }, error);
      }
      return null;
    }
  }

  /**
   * Check if a complete, parseable identity exists on this device.
   *
   * Returns `true` only when BOTH the private and public keys are present,
   * both are well-formed, AND the public key derives from the private key.
   * A partially-written or corrupted identity returns `false` so that
   * downstream code can resume the create / restore flow correctly.
   *
   * Note: this does NOT perform the full sign/verify roundtrip — call
   * `verifyIdentityIntegrity()` for that.
   */
  static async hasIdentity(): Promise<boolean> {
    if (isWebPlatform()) {
      return false; // Identity storage is only available on native platforms
    }
    if (KeyManager.cachedHasIdentity !== null) {
      return KeyManager.cachedHasIdentity;
    }

    let privateKey: string | null;
    let publicKey: string | null;
    try {
      const store = await initSecureStore();
      [privateKey, publicKey] = await Promise.all([
        store.getItemAsync(STORAGE_KEYS.PRIVATE_KEY),
        store.getItemAsync(STORAGE_KEYS.PUBLIC_KEY),
      ]);
    } catch (error) {
      // Storage threw — could be a transient keychain lock (e.g., background
      // fetch before the device is unlocked). Do NOT cache `false`: if we
      // did, the next call would skip storage entirely and return false even
      // after the device is unlocked. Just return false and let the next
      // call retry from storage.
      logger.error('Failed to read identity from secure storage', error, { component: 'KeyManager' });
      return false;
    }

    // Storage succeeded. Now classify the result. From here onward, any
    // outcome is stable and safe to cache (the bytes won't change between
    // calls).
    let hasIdentity = false;
    if (privateKey && publicKey) {
      // Require BOTH bytes-present AND parseable AND matching. Any weaker
      // check would let a half-written identity (private without public)
      // pretend to be a real one, which then fails opaquely later in the
      // sign-in flow when SignatureService.sign() can't find the keypair.
      if (KeyManager.isValidPrivateKey(privateKey) && KeyManager.isValidPublicKey(publicKey)) {
        try {
          const derived = ec
            .keyFromPrivate(KeyManager.canonicalPrivateKey(privateKey))
            .getPublic('hex');
          // Hex equality is case-insensitive; normalize on both sides to
          // tolerate legacy uppercase-stored public keys.
          hasIdentity = derived.toLowerCase() === publicKey.toLowerCase();
          if (!hasIdentity) {
            logger.warn(
              'KeyManager.hasIdentity: stored public key does not match derived public key',
              { component: 'KeyManager' },
            );
          }
        } catch (error) {
          logger.warn(
            'KeyManager.hasIdentity: failed to derive public key from stored private key',
            { component: 'KeyManager' },
            error,
          );
        }
      } else {
        logger.warn(
          'KeyManager.hasIdentity: stored key material is malformed',
          { component: 'KeyManager' },
        );
      }
    }

    // Cache result. Storage succeeded, so this verdict is stable:
    //   - true  → identity exists and round-trips cleanly
    //   - false → storage is empty / partial / malformed (a stable result;
    //             callers should run integrity-recovery / restore from
    //             backup explicitly)
    KeyManager.cachedHasIdentity = hasIdentity;
    if (hasIdentity && publicKey) {
      KeyManager.cachedPublicKey = publicKey;
    }
    // Diagnostic breadcrumb (dev only). Logs lengths + validity flags so we
    // can tell from `adb logcat` exactly WHY hasIdentity returned what it
    // did. Never log the key material itself.
    if (isDev()) {
      logger.debug(
        'KeyManager.hasIdentity result',
        { component: 'KeyManager' },
        {
          privateLen: privateKey?.length ?? 0,
          publicLen: publicKey?.length ?? 0,
          privateValid: privateKey ? KeyManager.isValidPrivateKey(privateKey) : null,
          publicValid: publicKey ? KeyManager.isValidPublicKey(publicKey) : null,
          derived: hasIdentity,
        },
      );
    }
    return hasIdentity;
  }

  /**
   * Delete the stored identity (both keys)
   * Use with EXTREME caution - this is irreversible without a recovery phrase
   * This should ONLY be called when explicitly requested by the user
   * @param skipBackup - If true, skip backup before deletion (default: false)
   * @param force - If true, skip confirmation checks (default: false)
   * @param userConfirmed - If true, user has explicitly confirmed deletion (default: false)
   */
  static async deleteIdentity(
    skipBackup: boolean = false, 
    force: boolean = false,
    userConfirmed: boolean = false
  ): Promise<void> {
    if (isWebPlatform()) {
      return; // Identity storage is only available on native platforms, nothing to delete
    }
    // CRITICAL SAFEGUARD: Require explicit user confirmation unless force is true
    if (!force && !userConfirmed) {
      throw new Error('Identity deletion requires explicit user confirmation. This is a safety measure to prevent accidental data loss.');
    }

    if (!force) {
      const hasIdentity = await KeyManager.hasIdentity();
      if (!hasIdentity) {
        return; // Nothing to delete
      }
    }

    const store = await initSecureStore();
    
    // ALWAYS create backup before deletion unless explicitly skipped
    if (!skipBackup) {
      try {
        const backupSuccess = await KeyManager.backupIdentity();
        if (!backupSuccess && isDev()) {
          logger.warn('Failed to backup identity before deletion - proceeding anyway', { component: 'KeyManager' });
        }
      } catch (backupError) {
        if (isDev()) {
          logger.warn('Failed to backup identity before deletion', { component: 'KeyManager' }, backupError);
        }
      }
    }

    await store.deleteItemAsync(STORAGE_KEYS.PRIVATE_KEY);
    await store.deleteItemAsync(STORAGE_KEYS.PUBLIC_KEY);
    
    // Invalidate cache
    KeyManager.invalidateCache();
    
    // Also clear backup if force deletion
    if (force) {
      try {
        await store.deleteItemAsync(STORAGE_KEYS.BACKUP_PRIVATE_KEY);
        await store.deleteItemAsync(STORAGE_KEYS.BACKUP_PUBLIC_KEY);
        await store.deleteItemAsync(STORAGE_KEYS.BACKUP_TIMESTAMP);
      } catch (error) {
        // Ignore backup deletion errors
      }
    }
  }

  /**
   * Backup identity to SecureStore (separate backup storage)
   * This provides a recovery mechanism if primary storage fails
   */
  static async backupIdentity(): Promise<boolean> {
    if (isWebPlatform()) {
      return false; // Identity storage is only available on native platforms
    }
    try {
      const store = await initSecureStore();
      const privateKey = await KeyManager.getPrivateKey();
      const publicKey = await KeyManager.getPublicKey();

      if (!privateKey || !publicKey) {
        return false; // Nothing to backup
      }

      // Store backup in SecureStore (still secure, but separate from primary storage)
      await store.setItemAsync(STORAGE_KEYS.BACKUP_PRIVATE_KEY, privateKey, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await store.setItemAsync(STORAGE_KEYS.BACKUP_PUBLIC_KEY, publicKey);
      await store.setItemAsync(STORAGE_KEYS.BACKUP_TIMESTAMP, Date.now().toString());

      return true;
    } catch (error) {
      if (isDev()) {
        logger.error('Failed to backup identity', error, { component: 'KeyManager' });
      }
      return false;
    }
  }

  /**
   * Verify identity integrity — checks keys are valid, accessible, derive
   * consistently, AND can sign + verify a probe message.
   *
   * Returns true only when the full sign/verify roundtrip succeeds. Use
   * this on app start to detect silent corruption before the user finds
   * out by failing to sign in.
   */
  static async verifyIdentityIntegrity(): Promise<boolean> {
    if (isWebPlatform()) {
      return false; // Identity storage is only available on native platforms
    }
    try {
      const privateKey = await KeyManager.getPrivateKey();
      const publicKey = await KeyManager.getPublicKey();

      if (!privateKey || !publicKey) {
        return false;
      }

      // Validate formats
      if (!KeyManager.isValidPrivateKey(privateKey)) {
        return false;
      }
      if (!KeyManager.isValidPublicKey(publicKey)) {
        return false;
      }

      // Verify public key derives from private key (case-insensitive
      // because hex is case-insensitive — legacy uppercase stored values
      // must still validate).
      const derivedPublicKey = KeyManager.derivePublicKey(privateKey);
      if (derivedPublicKey.toLowerCase() !== publicKey.toLowerCase()) {
        return false; // Keys don't match
      }

      // Full sign/verify probe — proves the keypair is functional, not just
      // bytewise parseable. A previous version of this method would return
      // true even when the underlying elliptic curve state was wedged.
      const keyPair = ec.keyFromPrivate(KeyManager.canonicalPrivateKey(privateKey));
      const probeHash = '0'.repeat(64);
      const signature = keyPair.sign(probeHash);
      if (!keyPair.verify(probeHash, signature)) {
        logger.error('Identity sign/verify probe failed during integrity check', undefined, { component: 'KeyManager' });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Identity integrity check failed', error, { component: 'KeyManager' });
      return false;
    }
  }

  /**
   * Restore identity from backup if primary storage is genuinely missing or
   * corrupt.
   *
   * SAFETY (three independent guards against silently switching accounts):
   *   1. If the primary passes a full sign/verify probe, do nothing.
   *   2. If the primary keys CANNOT BE READ (storage threw — e.g. a transient
   *      keychain lock during a background launch), do nothing. We must NOT
   *      treat "couldn't read" as "corrupted" and restore a possibly-stale
   *      backup over an identity that is actually fine but momentarily
   *      inaccessible.
   *   3. If a primary private/public key IS present but does not match the
   *      backup, the backup may belong to a different identity — refuse, so we
   *      never silently switch the user to another account.
   *
   * Only when the primary is provably absent (read succeeded, returned
   * null/empty) or provably corrupt (read succeeded, bytes malformed AND no
   * conflicting key material is present) do we rebuild it from the backup.
   */
  static async restoreIdentityFromBackup(): Promise<boolean> {
    if (isWebPlatform()) {
      return false; // Identity storage is only available on native platforms
    }
    try {
      const store = await initSecureStore();

      // Read the primary DIRECTLY (not via the error-swallowing getters) so
      // we can distinguish a transient read failure from a genuinely absent
      // key. A thrown read here means the keychain is locked/unavailable —
      // bail out and let a later call retry rather than risk restoring over a
      // healthy-but-locked identity.
      let primaryPrivate: string | null;
      let primaryPublic: string | null;
      try {
        primaryPrivate = await store.getItemAsync(STORAGE_KEYS.PRIVATE_KEY);
        primaryPublic = await store.getItemAsync(STORAGE_KEYS.PUBLIC_KEY);
      } catch (error) {
        logger.warn(
          'restoreIdentityFromBackup: could not read primary (transient?). Refusing to restore.',
          { component: 'KeyManager' },
          error,
        );
        return false;
      }

      // If the primary reads back as a complete, self-consistent identity, it
      // is healthy — nothing to restore. (Guard 1.)
      if (primaryPrivate && primaryPublic) {
        if (
          KeyManager.isValidPrivateKey(primaryPrivate) &&
          KeyManager.isValidPublicKey(primaryPublic) &&
          KeyManager.derivePublicKey(primaryPrivate).toLowerCase() === primaryPublic.toLowerCase()
        ) {
          return false;
        }
      }

      // Load + validate the backup.
      const backupPrivateKey = await store.getItemAsync(STORAGE_KEYS.BACKUP_PRIVATE_KEY);
      const backupPublicKey = await store.getItemAsync(STORAGE_KEYS.BACKUP_PUBLIC_KEY);

      if (!backupPrivateKey || !backupPublicKey) {
        return false; // No backup available
      }

      if (!KeyManager.isValidPrivateKey(backupPrivateKey) || !KeyManager.isValidPublicKey(backupPublicKey)) {
        logger.warn('Backup identity is malformed; refusing to restore', { component: 'KeyManager' });
        return false;
      }

      // Verify backup keys derive consistently. Hex is case-insensitive so
      // normalize both sides — a legacy uppercase-stored backup must still
      // be considered valid.
      const derivedPublicKey = KeyManager.derivePublicKey(backupPrivateKey);
      if (derivedPublicKey.toLowerCase() !== backupPublicKey.toLowerCase()) {
        logger.warn('Backup public key does not match derived; refusing to restore', { component: 'KeyManager' });
        return false;
      }

      // Guard 3: if ANY primary key material is still present and identifies a
      // DIFFERENT identity than the backup, refuse — the backup may be from a
      // completely different account and restoring it would silently switch
      // the user. We check the private key too (not just the public): a
      // present private key that derives to a non-backup public means a real,
      // different identity is sitting in the primary slot.
      if (
        primaryPublic &&
        primaryPublic.toLowerCase() !== backupPublicKey.toLowerCase()
      ) {
        logger.error(
          'Primary public key is present, corrupt-or-mismatched, AND differs from the backup. Refusing to restore to avoid switching accounts.',
          undefined,
          { component: 'KeyManager' },
        );
        return false;
      }
      if (
        primaryPrivate &&
        KeyManager.isValidPrivateKey(primaryPrivate) &&
        KeyManager.derivePublicKey(primaryPrivate).toLowerCase() !== backupPublicKey.toLowerCase()
      ) {
        logger.error(
          'Primary private key identifies a DIFFERENT identity than the backup. Refusing to restore to avoid switching accounts.',
          undefined,
          { component: 'KeyManager' },
        );
        return false;
      }

      // Safe to restore: rebuild the primary using the same atomic write
      // path createIdentity uses, including verification.
      try {
        await KeyManager._persistIdentityAtomic(backupPrivateKey, backupPublicKey);
      } catch (error) {
        logger.error('Failed to persist identity restored from backup', error, { component: 'KeyManager' });
        return false;
      }

      await store.setItemAsync(STORAGE_KEYS.BACKUP_TIMESTAMP, Date.now().toString());
      return true;
    } catch (error) {
      logger.error('Failed to restore identity from backup', error, { component: 'KeyManager' });
      return false;
    }
  }

  /**
   * Get the elliptic curve key object from the stored private key
   * Used internally for signing operations
   */
  static async getKeyPairObject(): Promise<ECKeyPair | null> {
    if (isWebPlatform()) {
      return null; // Identity storage is only available on native platforms
    }
    const privateKey = await KeyManager.getPrivateKey();
    if (!privateKey) return null;
    return ec.keyFromPrivate(KeyManager.canonicalPrivateKey(privateKey));
  }

  /**
   * Derive public key from a private key (without storing)
   */
  static derivePublicKey(privateKey: string): string {
    const keyPair = ec.keyFromPrivate(KeyManager.canonicalPrivateKey(privateKey));
    return keyPair.getPublic('hex');
  }

  /**
   * Validate that a string is a valid public key
   *
   * Returns false on parse errors (invalid input is the expected fail mode here).
   * Errors are logged at debug level so they're available when troubleshooting
   * but don't pollute production logs.
   */
  static isValidPublicKey(publicKey: string): boolean {
    if (typeof publicKey !== 'string' || publicKey.length === 0) {
      return false;
    }
    // secp256k1 public keys are either uncompressed (130 hex chars, starts with 04)
    // or compressed (66 hex chars, starts with 02 or 03). Anything else is
    // clearly bogus; reject up front so we never silently widen the trust
    // boundary by accepting whatever BN(...) parses out of junk input.
    if (!/^[0-9a-fA-F]+$/.test(publicKey)) {
      return false;
    }
    if (publicKey.length !== 130 && publicKey.length !== 66) {
      return false;
    }
    try {
      ec.keyFromPublic(publicKey, 'hex');
      return true;
    } catch (error) {
      if (isDev()) {
        logger.debug('[oxy.crypto] isValidPublicKey rejected input', { component: 'KeyManager' }, error);
      }
      return false;
    }
  }

  /**
   * Validate that a string is a valid private key.
   *
   * secp256k1 private keys are 256-bit, so 64 hex chars. We require strict
   * hex-only input because `elliptic`'s underlying `BN(input, 16)` happily
   * accepts non-hex characters (treating them as zero), which would let
   * "not-hex" pass through as a valid (but compromised, near-zero) key.
   */
  static isValidPrivateKey(privateKey: string): boolean {
    if (typeof privateKey !== 'string' || privateKey.length === 0) {
      return false;
    }
    if (!/^[0-9a-fA-F]+$/.test(privateKey)) {
      return false;
    }
    // secp256k1 private keys are 32 bytes (64 hex chars). `elliptic`'s
    // `getPrivate('hex')` strips leading zero bytes, so a valid key whose
    // leading byte is 0 ends up as 62 hex chars in storage. Accept any
    // length from 1..64 here — we re-pad before deriving below — and
    // reject longer than 64.
    if (privateKey.length > 64) {
      return false;
    }
    const padded = privateKey.padStart(64, '0').toLowerCase();
    // After padding, require minimum entropy: reject obvious low-scalar
    // keys. A scalar that fits in 8 hex chars (~32 bits of entropy) is a
    // degenerate / accidental key, not a real one. The existing isZero()
    // check below covers literal 0; this also rejects trivially small
    // scalars like '1', '2', etc. that would otherwise pad to a valid but
    // weak key whose public point is trivially derivable.
    if (/^0{56}/.test(padded)) {
      return false;
    }
    try {
      const keyPair = ec.keyFromPrivate(padded);
      const priv = keyPair.getPrivate();
      // Private key must be > 0 and < curve order n. elliptic doesn't
      // enforce this on keyFromPrivate, so we do it here.
      if (priv.isZero() || priv.cmp(ec.curve.n) >= 0) {
        return false;
      }
      // Verify it can derive a public key
      const pub = keyPair.getPublic('hex');
      if (!pub || pub.length === 0) {
        return false;
      }
      return true;
    } catch (error) {
      if (isDev()) {
        logger.debug('[oxy.crypto] isValidPrivateKey rejected input', { component: 'KeyManager' }, error);
      }
      return false;
    }
  }

  /**
   * Get a shortened version of the public key for display
   * Format: first 8 chars...last 8 chars
   */
  static shortenPublicKey(publicKey: string): string {
    if (publicKey.length <= 20) return publicKey;
    return `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`;
  }
}

export default KeyManager;


