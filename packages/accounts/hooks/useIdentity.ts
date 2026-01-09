import { useCallback, useEffect, useRef, useMemo } from 'react';
import { Platform } from 'react-native';
import { KeyManager, SignatureService, RecoveryPhraseService, useOxy, useAuthStore } from '@oxyhq/services';
import { handleAuthError, isInvalidSessionError, isTimeoutOrNetworkError, useStorage } from '@oxyhq/services/ui';
import type { User } from '@oxyhq/services';

const REGISTER_ERROR_CODE = 'REGISTER_ERROR';

export interface UseIdentityResult {
  /** Create a new identity locally (offline-first) and optionally sync with server */
  createIdentity: () => Promise<{ recoveryPhrase: string[]; synced: boolean; user?: User }>;
  /** Import an existing identity from recovery phrase */
  importIdentity: (phrase: string) => Promise<{ synced: boolean }>;
  /** Sync local identity with server (when online) */
  syncIdentity: () => Promise<User>;
  /** Check if device has an identity stored */
  hasIdentity: () => Promise<boolean>;
  /** Get the public key of the stored identity */
  getPublicKey: () => Promise<string | null>;
  /** Check if identity is synced with server */
  isIdentitySynced: () => Promise<boolean>;
  /** Identity sync state (reactive) */
  identitySyncState: {
    isSynced: boolean;
    isSyncing: boolean;
  };
}

/**
 * Identity management hook for accounts app.
 * Handles identity creation, import, sync, and network reconnect sync logic.
 * Uses oxy services for server operations (registration, sign-in, sessions).
 */
export const useIdentity = (): UseIdentityResult => {
  const { oxyServices, signIn, isAuthenticated } = useOxy();
  const { storage } = useStorage();
  
  // Get identity sync state from Zustand store using individual selectors to avoid infinite loops
  const isSyncedStore = useAuthStore((state) => state.isIdentitySynced);
  const isSyncing = useAuthStore((state) => state.isSyncing);
  const setIdentitySynced = useAuthStore((state) => state.setIdentitySynced);
  const setSyncing = useAuthStore((state) => state.setSyncing);

  // Sync protection ref to prevent concurrent calls
  const syncInProgressRef = useRef(false);

  /**
   * Check if identity is synced with server (reads from storage for persistence)
   */
  const isIdentitySynced = useCallback(async (): Promise<boolean> => {
    if (!storage) return true;
    const synced = await storage.getItem('oxy_identity_synced');
    const isSynced = synced !== 'false';
    setIdentitySynced(isSynced);
    return isSynced;
  }, [storage, setIdentitySynced]);

  /**
   * Sync local identity with server (call when online)
   */
  const syncIdentity = useCallback(
    async (): Promise<User> => {
      if (!storage) throw new Error('Storage not initialized');
      if (!oxyServices) throw new Error('OxyServices not initialized');
      if (!signIn) throw new Error('signIn not available');

      // Prevent concurrent sync calls
      if (syncInProgressRef.current) {
        throw new Error('Sync already in progress');
      }

      syncInProgressRef.current = true;
      setSyncing(true);

      try {
        const publicKey = await KeyManager.getPublicKey();
        if (!publicKey) {
          throw new Error('No identity found on this device');
        }

        // Check if already synced
        const alreadySynced = await storage.getItem('oxy_identity_synced');
        if (alreadySynced === 'true') {
          setIdentitySynced(true);
          
          // Try to sign in, but if it fails with auth error (expired session), clear synced flag and retry full sync
          try {
            const user = await signIn(publicKey);
            return user;
          } catch (signInError: unknown) {
            // If sign in fails with authentication error (401, expired session, etc.), clear synced flag and retry
            if (isInvalidSessionError(signInError)) {
              // Clear synced flag so we can retry full sync
              await storage.setItem('oxy_identity_synced', 'false');
              setIdentitySynced(false);
              // Continue with full sync flow below
            } else {
              // Other errors should propagate
              throw signInError;
            }
          }
        }

        // Check if already registered on server, register if not
        let needsRegistration = true;
        
        try {
          const { registered } = await oxyServices.checkPublicKeyRegistered(publicKey);
          needsRegistration = !registered;
        } catch (checkError: unknown) {
          // Check failed - assume we need to register (might be network issue)
          needsRegistration = true;
        }

        if (needsRegistration) {
          try {
            const { signature, timestamp } = await SignatureService.createRegistrationSignature();
            await oxyServices.register(publicKey, signature, timestamp);
          } catch (registerError: unknown) {
            const errorMessage = registerError instanceof Error ? registerError.message : String(registerError);
            const status = (registerError as any)?.status;
            
            // If already registered (409), that's OK - continue with sync
            if (status === 409 || errorMessage.includes('already') || errorMessage.includes('409')) {
              // Already registered - continue
            } else {
              // Other registration errors should propagate
              throw registerError;
            }
          }
        }

        // Mark as synced (Zustand store + storage)
        await storage.setItem('oxy_identity_synced', 'true');
        setIdentitySynced(true);

        // Sign in to create session and activate it
        const user = await signIn(publicKey);

        return user;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        handleAuthError(error, {
          defaultMessage: `Failed to sync identity: ${errorMessage}`,
          code: REGISTER_ERROR_CODE,
          setAuthError: (msg: string) => useAuthStore.setState({ error: msg }),
          logger: __DEV__ ? console.warn : undefined,
        });
        throw error;
      } finally {
        setSyncing(false);
        syncInProgressRef.current = false;
      }
    },
    [oxyServices, storage, signIn, setIdentitySynced, setSyncing],
  );

  /**
   * Create a new identity with recovery phrase (offline-first)
   * Identity is purely cryptographic - no username or email required
   */
  const createIdentity = useCallback(
    async (): Promise<{ recoveryPhrase: string[]; synced: boolean; user?: User }> => {
      if (!storage) throw new Error('Storage not initialized');
      if (!oxyServices) throw new Error('OxyServices not initialized');
      if (!signIn) throw new Error('signIn not available');

      try {
        // Generate new identity with recovery phrase (works offline)
        const { phrase, words, publicKey } = await RecoveryPhraseService.generateIdentityWithRecovery();

        // Mark as not synced
        await storage.setItem('oxy_identity_synced', 'false');
        setIdentitySynced(false);

        // Try to register and sign in with server (if online)
        try {
          const { signature, timestamp } = await SignatureService.createRegistrationSignature();
          await oxyServices.register(publicKey, signature, timestamp);
          
          // Mark as synced (Zustand store + storage)
          await storage.setItem('oxy_identity_synced', 'true');
          setIdentitySynced(true);

          // Automatically sign in after registration to create session
          const user = await signIn(publicKey);

          return {
            recoveryPhrase: words,
            synced: true,
            user,
          };
        } catch (syncError) {
          // Offline or server error - identity is created locally but not synced
          // Don't log errors - they're expected when offline
          
          return {
            recoveryPhrase: words,
            synced: false,
          };
        }
      } catch (error) {
        // CRITICAL: Never delete identity on error - it may have been successfully created
        // Only log the error and let the user recover using their recovery phrase
        if (__DEV__) {
          console.warn('Error during identity creation (identity may still exist):', error);
        }
        
        // Check if identity was actually created (keys exist)
        const hasIdentity = await KeyManager.hasIdentity().catch(() => false);
        if (hasIdentity) {
          // Identity exists - don't delete it! Just mark as not synced
          await storage.setItem('oxy_identity_synced', 'false').catch(() => {});
          setIdentitySynced(false);
        } else {
          // No identity exists - this was a generation failure, safe to clean up sync flag
          await storage.removeItem('oxy_identity_synced').catch(() => {});
          setIdentitySynced(false);
        }
        
        handleAuthError(error, {
          defaultMessage: 'Failed to create identity',
          code: REGISTER_ERROR_CODE,
          setAuthError: (msg: string) => useAuthStore.setState({ error: msg }),
          logger: __DEV__ ? console.warn : undefined,
        });
        throw error;
      }
    },
    [oxyServices, storage, signIn, setIdentitySynced],
  );

  /**
   * Import identity from recovery phrase (offline-first)
   */
  const importIdentity = useCallback(
    async (phrase: string): Promise<{ synced: boolean }> => {
      if (!storage) throw new Error('Storage not initialized');
      if (!oxyServices) throw new Error('OxyServices not initialized');

      try {
        // Restore identity from phrase (works offline)
        const publicKey = await RecoveryPhraseService.restoreFromPhrase(phrase);

        // Mark as not synced
        await storage.setItem('oxy_identity_synced', 'false');
        setIdentitySynced(false);

        // Try to sync with server
        try {
          // Check if this identity is already registered
          const { registered } = await oxyServices.checkPublicKeyRegistered(publicKey);

          if (registered) {
            // Identity exists, mark as synced
            await storage.setItem('oxy_identity_synced', 'true');
            setIdentitySynced(true);
            return { synced: true };
          } else {
            // Need to register this identity (identity is just the publicKey)
            const { signature, timestamp } = await SignatureService.createRegistrationSignature();
            await oxyServices.register(publicKey, signature, timestamp);
            
            await storage.setItem('oxy_identity_synced', 'true');
            setIdentitySynced(true);
            return { synced: true };
          }
        } catch (syncError) {
          // Offline - identity restored locally but not synced
          if (__DEV__) {
            console.warn('Identity imported locally, will sync when online', syncError);
          }
          return { synced: false };
        }
      } catch (error) {
        handleAuthError(error, {
          defaultMessage: 'Failed to import identity',
          code: REGISTER_ERROR_CODE,
          setAuthError: (msg: string) => useAuthStore.setState({ error: msg }),
          logger: __DEV__ ? console.warn : undefined,
        });
        throw error;
      }
    },
    [oxyServices, storage, setIdentitySynced],
  );

  /**
   * Check if device has an identity stored
   */
  const hasIdentity = useCallback(async (): Promise<boolean> => {
    return KeyManager.hasIdentity();
  }, []);

  /**
   * Get the public key of the stored identity
   */
  const getPublicKey = useCallback(async (): Promise<string | null> => {
    return KeyManager.getPublicKey();
  }, []);

  // Identity integrity check and auto-restore on startup
  // Skip on web platform - identity storage is only available on native platforms
  useEffect(() => {
    if (!storage) return;
    if (Platform.OS === 'web') return; // Identity operations are native-only

    const checkAndRestoreIdentity = async () => {
      try {
        // Check if identity exists and verify integrity
        const hasIdentityValue = await KeyManager.hasIdentity();
        if (hasIdentityValue) {
          const isValid = await KeyManager.verifyIdentityIntegrity();
          if (!isValid) {
            // Try to restore from backup
            const restored = await KeyManager.restoreIdentityFromBackup();
            if (__DEV__) {
              console.warn('[useIdentity]', restored
                ? 'Identity restored from backup successfully'
                : 'Identity integrity check failed - user may need to restore from recovery phrase'
              );
            }
          } else {
            // Identity is valid - ensure backup is up to date
            await KeyManager.backupIdentity();
          }
        } else {
          // No identity - try to restore from backup
          const restored = await KeyManager.restoreIdentityFromBackup();
          if (restored && __DEV__) {
            console.warn('[useIdentity] Identity restored from backup on startup');
          }
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('[useIdentity] Error during identity integrity check', error);
        }
        // Don't block app startup - user can recover with recovery phrase
      }
    };

    checkAndRestoreIdentity();
  }, [storage]);

  // Network reconnect sync logic - extracted from OxyContext
  useEffect(() => {
    if (!storage || !oxyServices) return;

    let wasOffline = false;
    let checkTimeout: NodeJS.Timeout | null = null;

    // Circuit breaker and exponential backoff state
    const stateRef = {
      consecutiveFailures: 0,
      currentInterval: 10000, // Start with 10 seconds
      baseInterval: 10000, // Base interval in milliseconds
      maxInterval: 60000, // Maximum interval (60 seconds)
      maxFailures: 5, // Circuit breaker threshold
    };

    const scheduleNextCheck = () => {
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }
      checkTimeout = setTimeout(() => {
        checkNetworkAndSync();
      }, stateRef.currentInterval) as unknown as NodeJS.Timeout;
    };

    const checkNetworkAndSync = async () => {
      try {
        // Skip if sync is already in progress or user is already authenticated
        if (syncInProgressRef.current || isAuthenticated) {
          scheduleNextCheck();
          return;
        }

        // Try a lightweight health check to see if we're online
        await oxyServices.healthCheck().catch(() => {
          wasOffline = true;
          throw new Error('Health check failed');
        });

        // Health check succeeded - reset circuit breaker and backoff
        if (stateRef.consecutiveFailures > 0) {
          stateRef.consecutiveFailures = 0;
          stateRef.currentInterval = stateRef.baseInterval;
        }

        // If we were offline and now we're online, sync identity if needed
        if (wasOffline && !isAuthenticated) {
          // Sync identity first (if not synced)
          try {
            const hasIdentityValue = await hasIdentity();
            if (hasIdentityValue && !syncInProgressRef.current) {
              // Check sync status directly - sync if not explicitly 'true'
              const syncStatus = await storage.getItem('oxy_identity_synced');
              if (syncStatus !== 'true') {
                syncInProgressRef.current = true;
                try {
                  await syncIdentity();
                } finally {
                  syncInProgressRef.current = false;
                }
              }
            }
          } catch (syncError: any) {
            syncInProgressRef.current = false;
            // Skip sync silently if username is required (expected when offline onboarding)
            if (syncError?.code === 'USERNAME_REQUIRED' || syncError?.message === 'USERNAME_REQUIRED') {
              // Don't log or show error - username will be set later
            } else if (!isTimeoutOrNetworkError(syncError)) {
              // Only log unexpected errors
              if (__DEV__) {
                console.warn('[useIdentity] Error syncing identity on reconnect', syncError);
              }
            }
          }

          // TanStack Query will automatically retry pending mutations
          wasOffline = false;
        }
      } catch (error) {
        // Network check failed - we're offline
        wasOffline = true;

        // Increment failure count and apply exponential backoff
        stateRef.consecutiveFailures++;

        // Calculate new interval with exponential backoff, capped at maxInterval
        const backoffMultiplier = Math.min(
          Math.pow(2, stateRef.consecutiveFailures - 1),
          stateRef.maxInterval / stateRef.baseInterval
        );
        stateRef.currentInterval = Math.min(
          stateRef.baseInterval * backoffMultiplier,
          stateRef.maxInterval
        );

        // If we hit the circuit breaker threshold, use max interval
        if (stateRef.consecutiveFailures >= stateRef.maxFailures) {
          stateRef.currentInterval = stateRef.maxInterval;
        }
      } finally {
        // Always schedule next check (will use updated interval)
        scheduleNextCheck();
      }
    };

    // Check immediately
    checkNetworkAndSync();

    return () => {
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }
    };
  }, [oxyServices, storage, syncIdentity, isAuthenticated, hasIdentity]);

  return {
    createIdentity,
    importIdentity,
    syncIdentity,
    hasIdentity,
    getPublicKey,
    isIdentitySynced,
    identitySyncState: {
      isSynced: isSyncedStore ?? true,
      isSyncing: isSyncing ?? false,
    },
  };
};
