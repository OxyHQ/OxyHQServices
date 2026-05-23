/**
 * Key Manager - ECDSA secp256k1 Key Generation and Storage
 *
 * Handles secure generation, storage, and retrieval of cryptographic keys.
 * Private keys are stored securely using expo-secure-store and never leave the device.
 */

import { ec as EC } from 'elliptic';
import type { ECKeyPair } from 'elliptic';
import { isWeb, isIOS, isAndroid, isReactNative, isNodeJS } from '../utils/platform';
import { logger } from '../utils/loggerUtils';
import { isDev } from '../shared/utils/debugUtils';

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

// Lazy imports for React Native specific modules
let SecureStore: typeof import('expo-secure-store') | null = null;
let ExpoCrypto: typeof import('expo-crypto') | null = null;

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
 * This allows the module to work in both Node.js and React Native environments
 */
async function initSecureStore(): Promise<typeof import('expo-secure-store')> {
  if (!SecureStore) {
    try {
      // Variable indirection prevents bundlers (Vite, webpack) from statically resolving this
      const moduleName = 'expo-secure-store';
      SecureStore = await import(/* @vite-ignore */ moduleName);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load expo-secure-store: ${errorMessage}. Make sure expo-secure-store is installed and properly configured.`);
    }
  }
  if (!SecureStore) {
    throw new Error('expo-secure-store module is not available');
  }
  return SecureStore;
}

/**
 * Check if we're on web platform
 * Identity storage is only available on native platforms (iOS/Android)
 */
function isWebPlatform(): boolean {
  return isWeb();
}

async function initExpoCrypto(): Promise<typeof import('expo-crypto')> {
  if (!ExpoCrypto) {
    // Variable indirection prevents bundlers (Vite, webpack) from statically resolving this
    const moduleName = 'expo-crypto';
    ExpoCrypto = await import(/* @vite-ignore */ moduleName);
  }
  return ExpoCrypto!;
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
  
  // In Node.js, use Node's crypto module
  // Variable indirection prevents bundlers (Vite, webpack) from statically resolving this
  try {
    const cryptoModuleName = 'crypto';
    const nodeCrypto = await import(/* @vite-ignore */ cryptoModuleName);
    return new Uint8Array(nodeCrypto.randomBytes(length));
  } catch (error) {
    // Fallback to expo-crypto if Node crypto fails
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
    const keyPair = ec.keyFromPrivate(privateKeyHex);

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
        await store.setItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, privateKey, {
          keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          keychainAccessGroup: IOS_KEYCHAIN_GROUP, // This enables sharing across apps
        } as any); // Type assertion: keychainAccessGroup may not be in older @types but is supported

        await store.setItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, publicKey, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
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
        publicKey = await store.getItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
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
        privateKey = await store.getItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
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
    const keyPair = ec.keyFromPrivate(privateKey);
    const publicKey = keyPair.getPublic('hex');

    if (isIOS()) {
      await store.setItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, privateKey, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        keychainAccessGroup: IOS_KEYCHAIN_GROUP,
      } as any);

      await store.setItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, publicKey, {
        keychainAccessGroup: IOS_KEYCHAIN_GROUP,
      } as any);
    } else if (isAndroid()) {
      await store.setItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, privateKey, {
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
        await store.setItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, sessionId, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);

        await store.setItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, accessToken, {
          keychainAccessible: store.WHEN_UNLOCKED,
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
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
        sessionId = await store.getItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);

        accessToken = await store.getItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
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
        await store.deleteItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
        await store.deleteItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
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
   * Write order is critical:
   *   1. Backup (BACKUP_PRIVATE_KEY + BACKUP_PUBLIC_KEY + BACKUP_TIMESTAMP)
   *   2. Primary public key
   *   3. Primary private key (last so a partial write leaves us in a known
   *      "no identity yet" state — easier to retry than a half-written one)
   *   4. Read back + sign/verify to confirm the storage round-trip works
   *
   * If any step throws, the caller sees the error AND any partial state is
   * cleaned up so the device is left either fully consistent or fully empty.
   * It never leaves an unusable half-identity that would fool `hasIdentity()`.
   *
   * @internal
   */
  private static async _persistIdentityAtomic(
    privateKey: string,
    publicKey: string,
  ): Promise<void> {
    const store = await initSecureStore();

    // Step 1: Backup BEFORE touching primary storage so we always have a
    // recoverable copy even if the device crashes mid-write.
    try {
      await store.setItemAsync(STORAGE_KEYS.BACKUP_PRIVATE_KEY, privateKey, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await store.setItemAsync(STORAGE_KEYS.BACKUP_PUBLIC_KEY, publicKey);
      await store.setItemAsync(STORAGE_KEYS.BACKUP_TIMESTAMP, Date.now().toString());
    } catch (error) {
      logger.error('Failed to write identity backup before primary', error, { component: 'KeyManager' });
      throw new IdentityPersistError('Failed to write identity backup', error);
    }

    // Step 2 + 3: Write primary keys. Public first so that if private write
    // fails we are still missing the most critical bit.
    try {
      await store.setItemAsync(STORAGE_KEYS.PUBLIC_KEY, publicKey);
      await store.setItemAsync(STORAGE_KEYS.PRIVATE_KEY, privateKey, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch (error) {
      logger.error('Failed to write primary identity to secure store', error, { component: 'KeyManager' });
      // Roll back the public-key half-write so hasIdentity() doesn't lie later.
      try { await store.deleteItemAsync(STORAGE_KEYS.PUBLIC_KEY); } catch { /* best effort */ }
      try { await store.deleteItemAsync(STORAGE_KEYS.PRIVATE_KEY); } catch { /* best effort */ }
      throw new IdentityPersistError('Failed to write identity to secure store', error);
    }

    // Step 4: Verify round-trip. If the store silently drops our writes
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
      throw new IdentityPersistError('Failed to verify identity after write', error);
    }

    if (readBackPrivate !== privateKey || readBackPublic !== publicKey) {
      logger.error('Identity round-trip mismatch after write', undefined, { component: 'KeyManager' });
      throw new IdentityPersistError('Identity write was not persisted correctly (round-trip mismatch).');
    }

    // Final sanity: derive public from the stored private and confirm the
    // pair signs/verifies cleanly. Catches a (theoretical) elliptic library
    // corruption immediately rather than the next time the user tries to
    // sign in.
    try {
      const keyPair = ec.keyFromPrivate(readBackPrivate);
      const derived = keyPair.getPublic('hex');
      if (derived !== readBackPublic) {
        throw new IdentityPersistError('Stored public key does not match derived public key.');
      }
      // Sign/verify roundtrip using a known test vector
      const probeHash = '0'.repeat(64);
      const signature = keyPair.sign(probeHash);
      if (!keyPair.verify(probeHash, signature)) {
        throw new IdentityPersistError('Sign/verify roundtrip failed for newly stored identity.');
      }
    } catch (error) {
      if (error instanceof IdentityPersistError) throw error;
      logger.error('Identity sign/verify probe failed', error, { component: 'KeyManager' });
      throw new IdentityPersistError('Stored identity failed crypto self-test', error);
    }

    // Update cache only after we are certain the identity is durable.
    KeyManager.cachedPublicKey = publicKey;
    KeyManager.cachedHasIdentity = true;
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

    const keyPair = ec.keyFromPrivate(privateKey);
    const publicKey = keyPair.getPublic('hex');

    // Refuse silent overwrite — see createIdentity() for rationale.
    if (!options?.overwrite) {
      const existing = await KeyManager.getPublicKey();
      if (existing && existing !== publicKey) {
        throw new IdentityAlreadyExistsError(existing);
      }
      // If existing === publicKey, the device already has this exact identity;
      // re-persisting is a no-op but harmless. Fall through to ensure backup
      // is up to date.
    }

    await KeyManager._persistIdentityAtomic(privateKey, publicKey);
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

    try {
      const store = await initSecureStore();
      const [privateKey, publicKey] = await Promise.all([
        store.getItemAsync(STORAGE_KEYS.PRIVATE_KEY),
        store.getItemAsync(STORAGE_KEYS.PUBLIC_KEY),
      ]);

      // Require BOTH bytes-present AND parseable AND matching. Any weaker
      // check would let a half-written identity (private without public)
      // pretend to be a real one, which then fails opaquely later in the
      // sign-in flow when SignatureService.sign() can't find the keypair.
      let hasIdentity = false;
      if (privateKey && publicKey) {
        if (KeyManager.isValidPrivateKey(privateKey) && KeyManager.isValidPublicKey(publicKey)) {
          try {
            // Pad the private key to canonical 64-hex-char form before
            // deriving (elliptic strips leading zeros on storage).
            const paddedPrivate = privateKey.padStart(64, '0');
            const derived = ec.keyFromPrivate(paddedPrivate).getPublic('hex');
            hasIdentity = derived === publicKey;
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

      // Cache result. We intentionally cache false when partial state is
      // detected so the next call doesn't re-read the same bytes — callers
      // should run integrity-recovery (restore from backup) explicitly.
      KeyManager.cachedHasIdentity = hasIdentity;
      if (hasIdentity) {
        KeyManager.cachedPublicKey = publicKey;
      }
      return hasIdentity;
    } catch (error) {
      // If we can't check, assume no identity (safer default)
      // Cache false to avoid repeated failed attempts
      KeyManager.cachedHasIdentity = false;
      logger.error('Failed to check identity', error, { component: 'KeyManager' });
      return false;
    }
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

      // Verify public key derives from private key
      const derivedPublicKey = KeyManager.derivePublicKey(privateKey);
      if (derivedPublicKey !== publicKey) {
        return false; // Keys don't match
      }

      // Full sign/verify probe — proves the keypair is functional, not just
      // bytewise parseable. A previous version of this method would return
      // true even when the underlying elliptic curve state was wedged.
      const keyPair = ec.keyFromPrivate(privateKey);
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
   * Restore identity from backup if primary storage is corrupted.
   *
   * SAFETY: this method will NEVER overwrite a verifying primary identity.
   * If the primary passes a sign/verify probe, the backup is left untouched
   * and `false` is returned — this protects against a transient
   * `verifyIdentityIntegrity()` blip clobbering valid keys with stale
   * backup keys (e.g., from a previous account before an import).
   *
   * Additionally, if the backup public key does NOT match the (still-
   * present-but-failing) primary public key, we refuse to overwrite — the
   * backup may belong to a different identity entirely.
   */
  static async restoreIdentityFromBackup(): Promise<boolean> {
    if (isWebPlatform()) {
      return false; // Identity storage is only available on native platforms
    }
    try {
      const store = await initSecureStore();

      // First: if the primary still works, do nothing. Returning true here
      // would be misleading; returning false (no restore needed) is the
      // honest answer.
      const primaryOk = await KeyManager.verifyIdentityIntegrity();
      if (primaryOk) {
        return false;
      }

      // Check if backup exists
      const backupPrivateKey = await store.getItemAsync(STORAGE_KEYS.BACKUP_PRIVATE_KEY);
      const backupPublicKey = await store.getItemAsync(STORAGE_KEYS.BACKUP_PUBLIC_KEY);

      if (!backupPrivateKey || !backupPublicKey) {
        return false; // No backup available
      }

      // Verify backup integrity
      if (!KeyManager.isValidPrivateKey(backupPrivateKey) || !KeyManager.isValidPublicKey(backupPublicKey)) {
        logger.warn('Backup identity is malformed; refusing to restore', { component: 'KeyManager' });
        return false;
      }

      // Verify backup keys derive consistently
      const derivedPublicKey = KeyManager.derivePublicKey(backupPrivateKey);
      if (derivedPublicKey !== backupPublicKey) {
        logger.warn('Backup public key does not match derived; refusing to restore', { component: 'KeyManager' });
        return false;
      }

      // CRITICAL: if there is still a (broken) primary public key present
      // that does NOT match the backup, the backup may be from a completely
      // different identity. Better to surface a corrupted state than
      // silently switch the user to a different account.
      const currentPrimaryPublic = await store.getItemAsync(STORAGE_KEYS.PUBLIC_KEY).catch(() => null);
      if (currentPrimaryPublic && currentPrimaryPublic !== backupPublicKey) {
        logger.error(
          'Primary identity is corrupted AND does not match the backup. Refusing to restore to avoid switching accounts.',
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
    return ec.keyFromPrivate(privateKey);
  }

  /**
   * Derive public key from a private key (without storing)
   */
  static derivePublicKey(privateKey: string): string {
    const keyPair = ec.keyFromPrivate(privateKey);
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
    const padded = privateKey.padStart(64, '0');
    try {
      const keyPair = ec.keyFromPrivate(padded);
      // Verify it can derive a public key
      const pub = keyPair.getPublic('hex');
      if (!pub || pub.length === 0) {
        return false;
      }
      // Additional sanity: private key must be > 0 and < curve order n.
      // elliptic doesn't enforce this on keyFromPrivate, so we do it here.
      const priv = keyPair.getPrivate();
      if (priv.isZero() || priv.cmp(ec.curve.n) >= 0) {
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


