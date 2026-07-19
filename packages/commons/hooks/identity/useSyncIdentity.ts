import { useCallback, useEffect } from 'react';
import { useOxy, useAuthStore, handleAuthError } from '@oxyhq/services';
import type { User } from '@oxyhq/core';
import { useBiometricSignIn } from '../useBiometricSignIn';
import {
  useIdentityStore,
  persistIdentitySyncState,
  getIdentitySyncStateFromStorage,
} from './identityStore';
import { syncIdentityWithServer } from './syncService';
import { acquireSyncLock, isSyncLockAborted } from './syncLock';

const REGISTER_ERROR_CODE = 'REGISTER_ERROR';

export interface UseSyncIdentityResult {
  /** Sync the local identity with the server (register-if-needed + key sign-in). */
  syncIdentity: () => Promise<User>;
  /** Read + reconcile the persisted "synced with server" flag. */
  isIdentitySynced: () => Promise<boolean>;
  /** Reactive sync state. */
  identitySyncState: {
    isSynced: boolean;
    isSyncing: boolean;
  };
}

/**
 * The vault's single-flight identity → session sync, on its own.
 *
 * Extracted from {@link useIdentity} so a consumer that only needs to CONNECT the
 * session (e.g. `useSessionAutoConnect`, mounted at app boot) can reuse the exact
 * same sync path WITHOUT also co-mounting `useIdentity`'s network-reconnect poll
 * loop and on-mount integrity/backup effect. `useIdentity` composes this hook, so
 * its public surface is unchanged — this is decomposition, not a re-export shim.
 *
 * `syncIdentity` serializes globally via `acquireSyncLock` (throws
 * "Sync already in progress" if held), so concurrent callers never double-run;
 * it register-if-needed + signs in with the device's PRIMARY key.
 */
export function useSyncIdentity(): UseSyncIdentityResult {
  const { oxyServices } = useOxy();
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

  return {
    syncIdentity,
    isIdentitySynced,
    identitySyncState: {
      isSynced: isSynced ?? false,
      isSyncing: isSyncing ?? false,
    },
  };
}
