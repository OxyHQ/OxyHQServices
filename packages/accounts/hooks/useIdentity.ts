import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import {
  KeyManager,
  RecoveryPhraseService,
  SignatureService,
  useOxy,
  useAuthStore,
} from '@oxyhq/services';
import { handleAuthError } from '@oxyhq/services/ui';
import type { User } from '@oxyhq/services';
import { useBiometricSignIn } from './useBiometricSignIn';
import { useIdentityStore, persistIdentitySyncState, getIdentitySyncStateFromStorage } from './identity/identityStore';
import { syncIdentityWithServer } from './identity/syncService';
import { acquireSyncLock, isSyncLockAborted } from './identity/syncLock';
import { useNetworkReconnect } from './identity/useNetworkReconnect';
import { isAlreadyRegisteredError } from './identity/errorUtils';

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
  const { oxyServices, isAuthenticated } = useOxy();
  const { signIn } = useBiometricSignIn();

  const isSynced = useIdentityStore((state) => state.isSynced);
  const isSyncing = useIdentityStore((state) => state.isSyncing);
  const setSynced = useIdentityStore((state) => state.setSynced);
  const setSyncing = useIdentityStore((state) => state.setSyncing);
  const hydrateStore = useIdentityStore((state) => state.hydrate);

  useEffect(() => {
    hydrateStore();
  }, [hydrateStore]);

  const isIdentitySynced = useCallback(async (): Promise<boolean> => {
    const synced = await getIdentitySyncStateFromStorage();
    setSynced(synced);
    return synced;
  }, [setSynced]);

  const syncIdentity = useCallback(
    async (): Promise<User> => {
      if (!oxyServices) throw new Error('OxyServices not initialized');
      if (!signIn) throw new Error('signIn not available');

      // Acquire global sync lock
      const lock = acquireSyncLock();
      setSyncing(true);

      try {
        const result = await syncIdentityWithServer({
          oxyServices,
          signIn,
          isAlreadySynced: isSynced,
          signal: lock.signal,
          onSessionExpired: async () => {
            setSynced(false);
            await persistIdentitySyncState(false);
          },
        });

        setSynced(true);
        await persistIdentitySyncState(true);

        return result.user;
      } catch (error) {
        if (isSyncLockAborted(error)) {
          throw new Error('Sync was cancelled');
        }
        handleAuthError(error, {
          defaultMessage: `Failed to sync identity: ${error instanceof Error ? error.message : String(error)}`,
          code: REGISTER_ERROR_CODE,
          setAuthError: (msg: string) => useAuthStore.setState({ error: msg }),
          logger: __DEV__ ? console.warn : undefined,
        });
        throw error;
      } finally {
        setSyncing(false);
        lock.release();
      }
    },
    [oxyServices, signIn, setSynced, setSyncing, isSynced],
  );

  const createIdentity = useCallback(
    async (): Promise<{ recoveryPhrase: string[]; synced: boolean; user?: User }> => {
      if (!oxyServices) throw new Error('OxyServices not initialized');
      if (!signIn) throw new Error('signIn not available');

      try {
        const { words, publicKey } = await RecoveryPhraseService.generateIdentityWithRecovery();
        
        setSynced(false);
        await persistIdentitySyncState(false);

        try {
          const { signature, timestamp } = await SignatureService.createRegistrationSignature();
          try {
            await oxyServices.register(publicKey, signature, timestamp);
          } catch (registerError: unknown) {
            if (!isAlreadyRegisteredError(registerError)) {
              throw registerError;
            }
          }
          
          setSynced(true);
          await persistIdentitySyncState(true);
          
          const user = await signIn(publicKey);

          return {
            recoveryPhrase: words,
            synced: true,
            user,
          };
        } catch {
          return { recoveryPhrase: words, synced: false };
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('Error during identity creation (identity may still exist):', error);
        }
        setSynced(false);
        await persistIdentitySyncState(false).catch(() => {});

        handleAuthError(error, {
          defaultMessage: 'Failed to create identity',
          code: REGISTER_ERROR_CODE,
          setAuthError: (msg: string) => useAuthStore.setState({ error: msg }),
          logger: __DEV__ ? console.warn : undefined,
        });
        throw error;
      }
    },
    [oxyServices, signIn, setSynced],
  );

  const importIdentity = useCallback(
    async (phrase: string): Promise<{ synced: boolean }> => {
      if (!oxyServices) throw new Error('OxyServices not initialized');

      try {
        const publicKey = await RecoveryPhraseService.restoreFromPhrase(phrase);
        
        setSynced(false);
        await persistIdentitySyncState(false);

        try {
          const { registered } = await oxyServices.checkPublicKeyRegistered(publicKey);
          
          if (!registered) {
            try {
              const { signature, timestamp } = await SignatureService.createRegistrationSignature();
              await oxyServices.register(publicKey, signature, timestamp);
            } catch (registerError: unknown) {
              if (!isAlreadyRegisteredError(registerError)) {
                throw registerError;
              }
            }
          }
          
          setSynced(true);
          await persistIdentitySyncState(true);
          return { synced: true };
        } catch (syncError) {
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
    [oxyServices, setSynced],
  );

  const hasIdentity = useCallback(() => KeyManager.hasIdentity(), []);
  const getPublicKey = useCallback(() => KeyManager.getPublicKey(), []);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const checkAndRestoreIdentity = async () => {
      try {
        const hasIdentityValue = await KeyManager.hasIdentity();
        if (hasIdentityValue) {
          const isValid = await KeyManager.verifyIdentityIntegrity();
          if (!isValid) {
            const restored = await KeyManager.restoreIdentityFromBackup();
            if (__DEV__) {
              console.warn('[useIdentity]', restored
                ? 'Identity restored from backup successfully'
                : 'Identity integrity check failed - user may need to restore from recovery phrase'
              );
            }
          } else {
            await KeyManager.backupIdentity();
          }
        } else {
          const restored = await KeyManager.restoreIdentityFromBackup();
          if (restored && __DEV__) {
            console.warn('[useIdentity] Identity restored from backup on startup');
          }
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('[useIdentity] Error during identity integrity check', error);
        }
      }
    };

    checkAndRestoreIdentity();
  }, []);

  // Network reconnect sync logic
  useNetworkReconnect({
    oxyServices,
    isAuthenticated,
    hasIdentity,
    syncIdentity,
    isSyncing,
  });

  return {
    createIdentity,
    importIdentity,
    syncIdentity,
    hasIdentity,
    getPublicKey,
    isIdentitySynced,
    identitySyncState: {
      isSynced: isSynced ?? true,
      isSyncing: isSyncing ?? false,
    },
  };
};
