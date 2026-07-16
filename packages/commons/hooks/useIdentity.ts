import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy, useAuthStore, handleAuthError } from '@oxyhq/services';
import {
  KeyManager,
  RecoveryPhraseService,
  SignatureService,
  IdentityAlreadyExistsError,
  IdentityPersistError,
} from '@oxyhq/core';
import type { User } from '@oxyhq/core';
import { useBiometricSignIn } from './useBiometricSignIn';
import { useIdentityStore, persistIdentitySyncState, getIdentitySyncStateFromStorage, persistOnboardingComplete } from './identity/identityStore';
import { syncIdentityWithServer } from './identity/syncService';
import { acquireSyncLock, isSyncLockAborted } from './identity/syncLock';
import { useNetworkReconnect } from './identity/useNetworkReconnect';
import { isAlreadyRegisteredError } from './identity/errorUtils';
import { ONBOARDING_IDENTITY_QUERY_KEY, ONBOARDING_COMPLETE_QUERY_KEY } from './useOnboardingStatus';

const REGISTER_ERROR_CODE = 'REGISTER_ERROR';

/**
 * Module-scoped promise used to serialize identity-creation across React
 * re-renders / strict-mode double invocations / accidental double-taps.
 *
 * Without this lock, two concurrent `createIdentity()` calls would both
 * call `RecoveryPhraseService.generateIdentityWithRecovery()` and the
 * second would silently overwrite the first identity (and its recovery
 * phrase would be the only valid one) — catastrophic account loss for
 * any user whose flow re-fires the effect.
 */
let inFlightCreateIdentity: Promise<{ recoveryPhrase: string[]; synced: boolean; user?: User }> | null = null;
let inFlightImportIdentity: Promise<{ synced: boolean }> | null = null;

export interface UseIdentityResult {
  /**
   * Create a new identity locally (offline-first) and optionally sync with server.
   * Pass `{ skipSync: true }` (e.g. when the caller already detected no
   * connectivity) to skip the register + signIn round-trip entirely instead of
   * blocking on a ~19s DNS timeout — the identity is still created locally and
   * the sync is deferred to the reconnect handler / username step.
   */
  createIdentity: (opts?: { skipSync?: boolean }) => Promise<{ recoveryPhrase: string[]; synced: boolean; user?: User }>;
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
  const queryClient = useQueryClient();

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
    async (opts?: { skipSync?: boolean }): Promise<{ recoveryPhrase: string[]; synced: boolean; user?: User }> => {
      if (!oxyServices) throw new Error('OxyServices not initialized');
      if (!signIn) throw new Error('signIn not available');

      // Serialize concurrent calls. Without this guard a fast double-tap
      // or React strict-mode double effect would generate (and persist)
      // two separate identities, losing access to the first one. The
      // recovery phrase shown to the user would only match the LAST one
      // written, so a user who already wrote down the first phrase would
      // be locked out.
      if (inFlightCreateIdentity) {
        return inFlightCreateIdentity;
      }

      const run = async (): Promise<{ recoveryPhrase: string[]; synced: boolean; user?: User }> => {
        // Pre-flight: if a complete identity already exists on this device,
        // we MUST NOT overwrite it without explicit user consent (a written
        // recovery phrase). Surface a typed error so the caller can route
        // to the "you already have an identity, sign in or destroy it" UI
        // instead of silently clobbering.
        const existingPublicKey = await KeyManager.getPublicKey();
        if (existingPublicKey) {
          // Caller is expected to handle this — typically by routing to
          // sign-in or to a confirmation screen.
          throw new IdentityAlreadyExistsError(existingPublicKey);
        }

        let words: string[];
        let publicKey: string;
        try {
          const result = await RecoveryPhraseService.generateIdentityWithRecovery();
          words = result.words;
          publicKey = result.publicKey;
        } catch (genError) {
          // Generation/persistence failed — there is no identity stored
          // locally, no phrase the user could have written down, and no
          // server state. Safe to surface the error as-is.
          console.error('[useIdentity] Failed to generate identity', genError);
          throw genError;
        }

        // From this point on, the identity exists locally. If we throw,
        // we MUST still return the phrase to the caller so it can be
        // shown to the user — losing it permanently would lock them out
        // the next time they wipe the app.
        setSynced(false);
        await persistIdentitySyncState(false);
        // A brand-new identity has NOT finished onboarding yet. Reset the
        // local milestone so this identity starts fresh — otherwise a stale
        // `true` left by a prior (deleted) identity on the same device would
        // route the new one straight to the vault, skipping its onboarding
        // wizard. It flips back to `true` only when THIS identity genuinely
        // completes (username + session) in `useOnboardingStatus`.
        await persistOnboardingComplete(false);

        // Caller detected no connectivity: skip the register + signIn round-trip
        // rather than stalling the "Setting up your account…" screen on a ~19s
        // DNS timeout. The identity already exists locally (keys generated
        // above); sync is deferred to the reconnect handler / username step.
        if (opts?.skipSync) {
          console.warn('[useIdentity] Offline during create — identity stored locally, server sync deferred');
          return { recoveryPhrase: words, synced: false };
        }

        try {
          const { signature, timestamp } = await SignatureService.createRegistrationSignature();

          try {
            await oxyServices.register(publicKey, signature, timestamp);
          } catch (registerError: unknown) {
            // 409 means already registered — that's fine, just sign in.
            if (!isAlreadyRegisteredError(registerError)) {
              throw registerError;
            }
          }

          const user = await signIn(publicKey);

          setSynced(true);
          await persistIdentitySyncState(true);

          // Commons is the ONLY app that writes the cross-app shared identity
          // slot other Oxy apps read for silent "Sign in with Oxy". Mirror it
          // now — after `signIn` — so the shared public key equals the
          // server-registered primary. Idempotent (guarded by
          // `hasSharedIdentity`), native-only (no-op on web), and swallows its
          // own errors, so it can never regress identity creation.
          await KeyManager.migrateToSharedIdentity();

          return {
            recoveryPhrase: words,
            synced: true,
            user,
          };
        } catch (syncError) {
          // Sync failed — identity exists locally, but the server doesn't
          // know about it yet. Log the underlying cause so devs can
          // distinguish a transient network blip from a real server
          // failure (the previous version silently swallowed all sync
          // errors which made debugging account-loss reports impossible).
          console.error('[useIdentity] Identity created locally but server sync failed', syncError);
          return { recoveryPhrase: words, synced: false };
        }
      };

      inFlightCreateIdentity = run();
      try {
        const result = await inFlightCreateIdentity;
        // Identity now exists on-device → refresh the shared onboarding probes so
        // routing (`useOnboardingStatus`) reflects both the new identity AND its
        // reset onboarding-complete milestone without a per-component re-check.
        queryClient.invalidateQueries({ queryKey: ONBOARDING_IDENTITY_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ONBOARDING_COMPLETE_QUERY_KEY });
        return result;
      } catch (error) {
        if (!(error instanceof IdentityAlreadyExistsError)) {
          handleAuthError(error, {
            defaultMessage: 'Failed to create identity',
            code: REGISTER_ERROR_CODE,
            setAuthError: (msg: string) => useAuthStore.setState({ error: msg }),
            logger: __DEV__ ? console.warn : undefined,
          });
        }
        setSynced(false);
        await persistIdentitySyncState(false).catch(() => undefined);
        throw error;
      } finally {
        inFlightCreateIdentity = null;
      }
    },
    [oxyServices, signIn, setSynced, queryClient],
  );

  const importIdentity = useCallback(
    async (phrase: string): Promise<{ synced: boolean }> => {
      if (!oxyServices) throw new Error('OxyServices not initialized');
      if (!signIn) throw new Error('signIn not available');

      // Serialize concurrent imports for the same reasons as createIdentity.
      if (inFlightImportIdentity) {
        return inFlightImportIdentity;
      }

      const run = async (): Promise<{ synced: boolean }> => {
        // If we already have an identity that does NOT match this phrase,
        // refuse to overwrite without an explicit confirmation handled
        // upstream. KeyManager.importKeyPair will also enforce this, but
        // checking first gives us a clearer error.
        const existingPublicKey = await KeyManager.getPublicKey();
        const incomingPublicKey = await RecoveryPhraseService.derivePublicKeyFromPhrase(phrase);
        if (existingPublicKey && existingPublicKey !== incomingPublicKey) {
          throw new IdentityAlreadyExistsError(existingPublicKey);
        }

        const publicKey = await RecoveryPhraseService.restoreFromPhrase(phrase);

        setSynced(false);
        await persistIdentitySyncState(false);
        // Reset the local onboarding milestone for the freshly-imported identity
        // (see the matching reset in `createIdentity`). It flips back to `true`
        // only when this identity completes onboarding in `useOnboardingStatus`.
        await persistOnboardingComplete(false);

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

          await signIn(publicKey);

          setSynced(true);
          await persistIdentitySyncState(true);

          // Populate the cross-app shared identity slot (see createIdentity).
          // Idempotent, native-only, error-swallowing — never regresses import.
          await KeyManager.migrateToSharedIdentity();

          return { synced: true };
        } catch (syncError) {
          console.error('[useIdentity] Identity imported locally but server sync failed', syncError);
          return { synced: false };
        }
      };

      inFlightImportIdentity = run();
      try {
        const result = await inFlightImportIdentity;
        // Identity now exists on-device → refresh the shared onboarding probes so
        // routing (`useOnboardingStatus`) reflects both the new identity AND its
        // reset onboarding-complete milestone without a per-component re-check.
        queryClient.invalidateQueries({ queryKey: ONBOARDING_IDENTITY_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ONBOARDING_COMPLETE_QUERY_KEY });
        return result;
      } catch (error) {
        if (!(error instanceof IdentityAlreadyExistsError) && !(error instanceof IdentityPersistError)) {
          handleAuthError(error, {
            defaultMessage: 'Failed to import identity',
            code: REGISTER_ERROR_CODE,
            setAuthError: (msg: string) => useAuthStore.setState({ error: msg }),
            logger: __DEV__ ? console.warn : undefined,
          });
        }
        throw error;
      } finally {
        inFlightImportIdentity = null;
      }
    },
    [oxyServices, signIn, setSynced, queryClient],
  );

  const hasIdentity = useCallback(() => KeyManager.hasIdentity(), []);
  const getPublicKey = useCallback(() => KeyManager.getPublicKey(), []);

  // Identity integrity check and backup restoration (native only).
  //
  // Runs once on mount. Verifies the stored identity can actually
  // sign + verify; if not, attempts to restore from the local backup
  // copy. We log every branch — silent failures here previously
  // masked real account-loss bugs because there was no breadcrumb in
  // the dev console.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const checkAndRestoreIdentity = async () => {
      try {
        const hasIdentityValue = await KeyManager.hasIdentity();
        if (hasIdentityValue) {
          const isValid = await KeyManager.verifyIdentityIntegrity();
          if (!isValid) {
            console.error('[useIdentity] Identity integrity check FAILED — attempting backup restore');
            const restored = await KeyManager.restoreIdentityFromBackup();
            if (!restored) {
              console.error('[useIdentity] Backup restore FAILED — identity is unrecoverable from this device');
            } else {
              console.warn('[useIdentity] Identity restored from on-device backup');
            }
          } else {
            // Healthy identity — refresh the backup copy so it tracks the
            // current keys. Important for the case where a user just
            // imported a new identity: without refreshing, the backup is
            // stale (or empty) and the next integrity failure would have
            // nothing to restore.
            const backedUp = await KeyManager.backupIdentity();
            if (!backedUp) {
              console.warn('[useIdentity] Failed to refresh on-device identity backup');
            }

            // Existing users (healthy primary identity but no shared slot yet
            // — e.g. created before shared-identity write-through shipped):
            // mirror it into the cross-app shared slot once, on the next
            // Commons open, so silent "Sign in with Oxy" works for apps
            // installed later. Native-only (this effect early-returns on web);
            // idempotent + error-swallowing.
            if (!(await KeyManager.hasSharedIdentity())) {
              await KeyManager.migrateToSharedIdentity();
            }
          }
        } else {
          // No identity in primary storage — see if the on-device backup
          // can rescue us (e.g., the user re-installed the app on the
          // same device with the keychain still intact).
          const restored = await KeyManager.restoreIdentityFromBackup();
          if (restored) {
            console.warn('[useIdentity] No primary identity found, restored from on-device backup');
            // Identity presence just flipped false → true. The shared onboarding
            // probe (`useOnboardingStatus`) cached the pre-restore `false` with
            // `staleTime: Infinity`, so invalidate its key to force a re-read of
            // KeyManager — otherwise a just-restored returning user (re-install
            // with the keychain intact) is mis-routed into create-identity.
            queryClient.invalidateQueries({ queryKey: ONBOARDING_IDENTITY_QUERY_KEY });
          }
        }
      } catch (error) {
        console.error('[useIdentity] checkAndRestoreIdentity threw unexpectedly', error);
      }
    };

    checkAndRestoreIdentity();
  }, [queryClient]);

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
