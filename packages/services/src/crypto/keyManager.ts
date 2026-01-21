/**
 * Key Manager - ECDSA secp256k1 Key Generation and Storage
 * 
 * Handles secure generation, storage, and retrieval of cryptographic keys.
 * Private keys are stored securely using expo-secure-store and never leave the device.
 */

import { ec as EC } from 'elliptic';
import type { ECKeyPair } from 'elliptic';
import { Platform } from 'react-native';

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
      SecureStore = await import('expo-secure-store');
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
 * Check if we're in a React Native environment
 */
function isReactNative(): boolean {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
}

/**
 * Check if we're in a Node.js environment
 */
function isNodeJS(): boolean {
  return typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
}

/**
 * Check if we're on web platform
 * Identity storage is only available on native platforms (iOS/Android)
 */
function isWebPlatform(): boolean {
  try {
    return Platform.OS === 'web';
  } catch {
    // Fallback if Platform is not available
    return typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.product !== 'ReactNative';
  }
}

async function initExpoCrypto(): Promise<typeof import('expo-crypto')> {
  if (!ExpoCrypto) {
    ExpoCrypto = await import('expo-crypto');
  }
  return ExpoCrypto;
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
  // Use Function constructor to prevent Metro bundler from statically analyzing this require
  // This ensures the require is only evaluated in Node.js runtime, not during Metro bundling
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const getCrypto = new Function('return require("crypto")');
    const crypto = getCrypto();
    return new Uint8Array(crypto.randomBytes(length));
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
    return {
      privateKey: keyPair.getPrivate('hex'),
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
      privateKey: keyPair.getPrivate('hex'),
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

    if (Platform.OS === 'ios') {
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
    } else if (Platform.OS === 'android') {
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

    if (__DEV__) {
      console.log('[KeyManager] Shared identity created successfully');
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

      if (Platform.OS === 'ios') {
        publicKey = await store.getItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
      } else if (Platform.OS === 'android') {
        publicKey = await store.getItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY);
      }

      // Cache result
      KeyManager.cachedSharedPublicKey = publicKey;

      return publicKey;
    } catch (error) {
      if (__DEV__) {
        console.warn('[KeyManager] Failed to get shared public key:', error);
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

      if (Platform.OS === 'ios') {
        privateKey = await store.getItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
      } else if (Platform.OS === 'android') {
        privateKey = await store.getItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY);
      }

      return privateKey;
    } catch (error) {
      if (__DEV__) {
        console.warn('[KeyManager] Failed to get shared private key:', error);
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
      if (__DEV__) {
        console.warn('[KeyManager] Failed to check shared identity:', error);
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

    if (Platform.OS === 'ios') {
      await store.setItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, privateKey, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        keychainAccessGroup: IOS_KEYCHAIN_GROUP,
      } as any);

      await store.setItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, publicKey, {
        keychainAccessGroup: IOS_KEYCHAIN_GROUP,
      } as any);
    } else if (Platform.OS === 'android') {
      await store.setItemAsync(STORAGE_KEYS.SHARED_PRIVATE_KEY, privateKey, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });

      await store.setItemAsync(STORAGE_KEYS.SHARED_PUBLIC_KEY, publicKey);
    }

    // Update cache
    KeyManager.cachedSharedPublicKey = publicKey;
    KeyManager.cachedHasSharedIdentity = true;

    if (__DEV__) {
      console.log('[KeyManager] Shared identity imported successfully');
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

      if (Platform.OS === 'ios') {
        await store.setItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, sessionId, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);

        await store.setItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, accessToken, {
          keychainAccessible: store.WHEN_UNLOCKED,
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
      } else if (Platform.OS === 'android') {
        await store.setItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, sessionId);
        await store.setItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, accessToken);
      }

      if (__DEV__) {
        console.log('[KeyManager] Shared session stored successfully');
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[KeyManager] Failed to store shared session:', error);
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

      if (Platform.OS === 'ios') {
        sessionId = await store.getItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);

        accessToken = await store.getItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
      } else if (Platform.OS === 'android') {
        sessionId = await store.getItemAsync(STORAGE_KEYS.SHARED_SESSION_ID);
        accessToken = await store.getItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN);
      }

      if (!sessionId || !accessToken) {
        return null;
      }

      return { sessionId, accessToken };
    } catch (error) {
      if (__DEV__) {
        console.warn('[KeyManager] Failed to get shared session:', error);
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

      if (Platform.OS === 'ios') {
        await store.deleteItemAsync(STORAGE_KEYS.SHARED_SESSION_ID, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
        await store.deleteItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN, {
          keychainAccessGroup: IOS_KEYCHAIN_GROUP,
        } as any);
      } else if (Platform.OS === 'android') {
        await store.deleteItemAsync(STORAGE_KEYS.SHARED_SESSION_ID);
        await store.deleteItemAsync(STORAGE_KEYS.SHARED_SESSION_TOKEN);
      }

      if (__DEV__) {
        console.log('[KeyManager] Shared session cleared successfully');
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[KeyManager] Failed to clear shared session:', error);
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
        if (__DEV__) {
          console.log('[KeyManager] Shared identity already exists, skipping migration');
        }
        return true;
      }

      // Get local identity
      const privateKey = await KeyManager.getPrivateKey();
      if (!privateKey) {
        if (__DEV__) {
          console.log('[KeyManager] No local identity to migrate');
        }
        return false;
      }

      // Import to shared storage
      await KeyManager.importSharedIdentity(privateKey);

      if (__DEV__) {
        console.log('[KeyManager] Successfully migrated local identity to shared identity');
      }

      return true;
    } catch (error) {
      if (__DEV__) {
        console.error('[KeyManager] Failed to migrate to shared identity:', error);
      }
      return false;
    }
  }

  // ==================== END SHARED IDENTITY METHODS ====================

  /**
   * Generate and securely store a new key pair on the device
   * Returns only the public key (private key is stored securely)
   */
  static async createIdentity(): Promise<string> {
    if (isWebPlatform()) {
      throw new Error('Identity creation is only available on native platforms (iOS/Android). Please use the native app to create your identity.');
    }
    const store = await initSecureStore();
    const { privateKey, publicKey } = await KeyManager.generateKeyPair();

    await store.setItemAsync(STORAGE_KEYS.PRIVATE_KEY, privateKey, {
      keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });

    await store.setItemAsync(STORAGE_KEYS.PUBLIC_KEY, publicKey);

    // Update cache
    KeyManager.cachedPublicKey = publicKey;
    KeyManager.cachedHasIdentity = true;

    return publicKey;
  }

  /**
   * Import an existing key pair (e.g., from recovery phrase)
   */
  static async importKeyPair(privateKey: string): Promise<string> {
    if (isWebPlatform()) {
      throw new Error('Identity import is only available on native platforms (iOS/Android). Please use the native app to import your identity.');
    }
    const store = await initSecureStore();
    
    const keyPair = ec.keyFromPrivate(privateKey);
    const publicKey = keyPair.getPublic('hex');

    await store.setItemAsync(STORAGE_KEYS.PRIVATE_KEY, privateKey, {
      keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await store.setItemAsync(STORAGE_KEYS.PUBLIC_KEY, publicKey);

    // Update cache
    KeyManager.cachedPublicKey = publicKey;
    KeyManager.cachedHasIdentity = true;

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
      if (__DEV__) {
        console.warn('[KeyManager] Failed to access secure store:', error);
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
      if (__DEV__) {
        console.warn('[KeyManager] Failed to access secure store:', error);
      }
      return null;
    }
  }

  /**
   * Check if an identity (key pair) exists on this device (cached for performance)
   */
  static async hasIdentity(): Promise<boolean> {
    if (isWebPlatform()) {
      return false; // Identity storage is only available on native platforms
    }
    if (KeyManager.cachedHasIdentity !== null) {
      return KeyManager.cachedHasIdentity;
    }

    try {
      const privateKey = await KeyManager.getPrivateKey();
      const hasIdentity = privateKey !== null;
      
      // Cache result
      KeyManager.cachedHasIdentity = hasIdentity;
      
      return hasIdentity;
    } catch (error) {
      // If we can't check, assume no identity (safer default)
      // Cache false to avoid repeated failed attempts
      KeyManager.cachedHasIdentity = false;
      if (__DEV__) {
        console.warn('[KeyManager] Failed to check identity:', error);
      }
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
        if (!backupSuccess && typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[KeyManager] Failed to backup identity before deletion - proceeding anyway');
        }
      } catch (backupError) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[KeyManager] Failed to backup identity before deletion:', backupError);
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
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[KeyManager] Failed to backup identity:', error);
      }
      return false;
    }
  }

  /**
   * Verify identity integrity - checks if keys are valid and accessible
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

      // Validate private key format
      if (!KeyManager.isValidPrivateKey(privateKey)) {
        return false;
      }

      // Validate public key format
      if (!KeyManager.isValidPublicKey(publicKey)) {
        return false;
      }

      // Verify public key can be derived from private key
      const derivedPublicKey = KeyManager.derivePublicKey(privateKey);
      if (derivedPublicKey !== publicKey) {
        return false; // Keys don't match
      }

      // Verify we can create a key pair object (tests elliptic curve operations)
      const keyPair = await KeyManager.getKeyPairObject();
      if (!keyPair) {
        return false;
      }

      return true;
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[KeyManager] Identity integrity check failed:', error);
      }
      return false;
    }
  }

  /**
   * Restore identity from backup if primary storage is corrupted
   */
  static async restoreIdentityFromBackup(): Promise<boolean> {
    if (isWebPlatform()) {
      return false; // Identity storage is only available on native platforms
    }
    try {
      const store = await initSecureStore();
      
      // Check if backup exists
      const backupPrivateKey = await store.getItemAsync(STORAGE_KEYS.BACKUP_PRIVATE_KEY);
      const backupPublicKey = await store.getItemAsync(STORAGE_KEYS.BACKUP_PUBLIC_KEY);

      if (!backupPrivateKey || !backupPublicKey) {
        return false; // No backup available
      }

      // Verify backup integrity
      if (!KeyManager.isValidPrivateKey(backupPrivateKey)) {
        return false;
      }

      if (!KeyManager.isValidPublicKey(backupPublicKey)) {
        return false;
      }

      // Verify keys match
      const derivedPublicKey = KeyManager.derivePublicKey(backupPrivateKey);
      if (derivedPublicKey !== backupPublicKey) {
        return false; // Backup keys don't match
      }

      await store.setItemAsync(STORAGE_KEYS.PRIVATE_KEY, backupPrivateKey, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await store.setItemAsync(STORAGE_KEYS.PUBLIC_KEY, backupPublicKey);

      const restored = await KeyManager.verifyIdentityIntegrity();
      if (restored) {
        // Update cache
        KeyManager.cachedPublicKey = backupPublicKey;
        KeyManager.cachedHasIdentity = true;

        await store.setItemAsync(STORAGE_KEYS.BACKUP_TIMESTAMP, Date.now().toString());
        return true;
      }

      return false;
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.error('[KeyManager] Failed to restore identity from backup:', error);
      }
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
   */
  static isValidPublicKey(publicKey: string): boolean {
    try {
      ec.keyFromPublic(publicKey, 'hex');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate that a string is a valid private key
   */
  static isValidPrivateKey(privateKey: string): boolean {
    try {
      const keyPair = ec.keyFromPrivate(privateKey);
      // Verify it can derive a public key
      keyPair.getPublic('hex');
      return true;
    } catch {
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


