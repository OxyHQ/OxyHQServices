import { useCallback } from 'react';
import type { ApiError, User } from '../../../models/interfaces';
import type { AuthState } from '../../stores/authStore';
import type { ClientSession, SessionLoginResponse } from '../../../models/session';
import { DeviceManager } from '../../../utils/deviceManager';
import { fetchSessionsWithFallback, mapSessionsToClient } from '../utils/sessionHelpers';
import { handleAuthError, isInvalidSessionError } from '../utils/errorHandlers';
import type { StorageInterface } from '../utils/storageHelpers';
import type { OxyServices } from '../../../core';
import { KeyManager, SignatureService, RecoveryPhraseService } from '../../../crypto';

export interface UseAuthOperationsOptions {
  oxyServices: OxyServices;
  storage: StorageInterface | null;
  sessions: ClientSession[];
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  updateSessions: (sessions: ClientSession[], options?: { merge?: boolean }) => void;
  saveActiveSessionId: (sessionId: string) => Promise<void>;
  clearSessionState: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<User>;
  applyLanguagePreference: (user: User) => Promise<void>;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: ApiError) => void;
  loginSuccess: (user: User) => void;
  loginFailure: (message: string) => void;
  logoutStore: () => void;
  setAuthState: (state: Partial<AuthState>) => void;
  // Identity sync store actions
  setIdentitySynced: (synced: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  logger?: (message: string, error?: unknown) => void;
}

export interface UseAuthOperationsResult {
  /** Create a new identity locally (offline-first) and optionally sync with server */
  createIdentity: () => Promise<{ recoveryPhrase: string[]; synced: boolean }>;
  /** Import an existing identity from recovery phrase */
  importIdentity: (phrase: string) => Promise<{ synced: boolean }>;
  /** Sign in with existing identity on device */
  signIn: (deviceName?: string) => Promise<User>;
  /** Logout from current session */
  logout: (targetSessionId?: string) => Promise<void>;
  /** Logout from all sessions */
  logoutAll: () => Promise<void>;
  /** Check if device has an identity stored */
  hasIdentity: () => Promise<boolean>;
  /** Get the public key of the stored identity */
  getPublicKey: () => Promise<string | null>;
  /** Check if identity is synced with server */
  isIdentitySynced: () => Promise<boolean>;
  /** Sync local identity with server (when online) */
  syncIdentity: () => Promise<User>;
}

const LOGIN_ERROR_CODE = 'LOGIN_ERROR';
const REGISTER_ERROR_CODE = 'REGISTER_ERROR';
const LOGOUT_ERROR_CODE = 'LOGOUT_ERROR';
const LOGOUT_ALL_ERROR_CODE = 'LOGOUT_ALL_ERROR';

/**
 * Authentication operations using public key cryptography.
 * No passwords required - identity is based on ECDSA key pairs.
 */
export const useAuthOperations = ({
  oxyServices,
  storage,
  sessions,
  activeSessionId,
  setActiveSessionId,
  updateSessions,
  saveActiveSessionId,
  clearSessionState,
  switchSession,
  applyLanguagePreference,
  onAuthStateChange,
  onError,
  loginSuccess,
  loginFailure,
  logoutStore,
    setAuthState,
    setIdentitySynced,
    setSyncing,
    logger,
}: UseAuthOperationsOptions): UseAuthOperationsResult => {
  
  /**
   * Internal function to perform challenge-response sign in
   */
  const performSignIn = useCallback(
    async (publicKey: string): Promise<User> => {
      const deviceFingerprintObj = DeviceManager.getDeviceFingerprint();
      const deviceFingerprint = JSON.stringify(deviceFingerprintObj);
      const deviceInfo = await DeviceManager.getDeviceInfo();
      const deviceName = deviceInfo.deviceName || DeviceManager.getDefaultDeviceName();

      // Request challenge
      const { challenge } = await oxyServices.requestChallenge(publicKey);

      // Note: Biometric authentication check should be handled by the app layer
      // (e.g., accounts app) before calling signIn. The biometric preference is stored
      // in local storage as 'oxy_biometric_enabled' and can be checked there.

      // Sign the challenge
      const { challenge: signature, timestamp } = await SignatureService.signChallenge(challenge);

      // Verify and create session
      const sessionResponse = await oxyServices.verifyChallenge(
        publicKey,
        challenge,
        signature,
        timestamp,
        deviceName,
        deviceFingerprint,
      );

      // Get token for the session
      await oxyServices.getTokenBySession(sessionResponse.sessionId);

      // Get full user data
      const fullUser = await oxyServices.getUserBySession(sessionResponse.sessionId);
      await applyLanguagePreference(fullUser);
      loginSuccess(fullUser);

      // Fetch device sessions
      let allDeviceSessions: ClientSession[] = [];
      try {
        allDeviceSessions = await fetchSessionsWithFallback(oxyServices, sessionResponse.sessionId, {
          fallbackDeviceId: sessionResponse.deviceId,
          fallbackUserId: fullUser.id,
          logger,
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('Failed to fetch device sessions after login:', error);
        }
      }

      // Check for existing session for same user
      const existingSession = allDeviceSessions.find(
        (session) =>
          session.userId?.toString() === fullUser.id?.toString() &&
          session.sessionId !== sessionResponse.sessionId,
      );

      if (existingSession) {
        // Logout duplicate session
        try {
          await oxyServices.logoutSession(sessionResponse.sessionId, sessionResponse.sessionId);
        } catch (logoutError) {
          if (__DEV__) {
            console.warn('Failed to logout duplicate session:', logoutError);
          }
        }
        await switchSession(existingSession.sessionId);
        updateSessions(
          allDeviceSessions.filter((session) => session.sessionId !== sessionResponse.sessionId),
          { merge: false },
        );
        onAuthStateChange?.(fullUser);
        return fullUser;
      }

      setActiveSessionId(sessionResponse.sessionId);
      await saveActiveSessionId(sessionResponse.sessionId);
      updateSessions(allDeviceSessions, { merge: true });
      onAuthStateChange?.(fullUser);
      
      return fullUser;
    },
    [
      applyLanguagePreference,
      logger,
      loginSuccess,
      onAuthStateChange,
      oxyServices,
      saveActiveSessionId,
      setActiveSessionId,
      switchSession,
      updateSessions,
    ],
  );

  /**
   * Create a new identity with recovery phrase (offline-first)
   * Identity is purely cryptographic - no username or email required
   */
  const createIdentity = useCallback(
    async (): Promise<{ recoveryPhrase: string[]; synced: boolean }> => {
      if (!storage) throw new Error('Storage not initialized');

      setAuthState({ isLoading: true, error: null });

      try {
        // Generate new identity with recovery phrase (works offline)
        const { phrase, words, publicKey } = await RecoveryPhraseService.generateIdentityWithRecovery();

        // Mark as not synced
        await storage.setItem('oxy_identity_synced', 'false');
        setIdentitySynced(false);

        // Try to sync with server (will succeed if online)
        try {
          const { signature, timestamp } = await SignatureService.createRegistrationSignature();
          await oxyServices.register(publicKey, signature, timestamp);
          
          // Mark as synced (Zustand store + storage)
          await storage.setItem('oxy_identity_synced', 'true');
          setIdentitySynced(true);

          return {
            recoveryPhrase: words,
            synced: true,
          };
        } catch (syncError) {
          // Offline or server error - identity is created locally but not synced
          if (__DEV__) {
            console.log('[Auth] Identity created locally, will sync when online:', syncError);
          }
          
          return {
            recoveryPhrase: words,
            synced: false,
          };
        }
      } catch (error) {
        // Clean up identity if generation failed
        await KeyManager.deleteIdentity().catch(() => {});
        await storage.removeItem('oxy_identity_synced').catch(() => {});
        setIdentitySynced(true);
        
        const message = handleAuthError(error, {
          defaultMessage: 'Failed to create identity',
          code: REGISTER_ERROR_CODE,
          onError,
          setAuthError: (msg) => setAuthState({ error: msg }),
          logger,
        });
        loginFailure(message);
        throw error;
      } finally {
        setAuthState({ isLoading: false });
      }
    },
    [oxyServices, storage, setAuthState, loginFailure, onError, logger, setIdentitySynced],
  );

  /**
   * Check if identity is synced with server (reads from storage for persistence)
   */
  const isIdentitySyncedFn = useCallback(async (): Promise<boolean> => {
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

      setAuthState({ isLoading: true, error: null });
      setSyncing(true);

      try {
        const publicKey = await KeyManager.getPublicKey();
        if (!publicKey) {
          throw new Error('No identity found on this device');
        }

        // Check if already synced
        const alreadySynced = await storage.getItem('oxy_identity_synced');
        if (alreadySynced === 'true') {
          // Already synced, just sign in
          setIdentitySynced(true);
          return await performSignIn(publicKey);
        }

        // Check if already registered on server
        const { registered } = await oxyServices.checkPublicKeyRegistered(publicKey);

        if (!registered) {
          // Register with server (identity is just the publicKey)
          const { signature, timestamp } = await SignatureService.createRegistrationSignature();
          await oxyServices.register(publicKey, signature, timestamp);
        }

        // Mark as synced (Zustand store + storage)
        await storage.setItem('oxy_identity_synced', 'true');
        setIdentitySynced(true);

        // Sign in
        return await performSignIn(publicKey);
      } catch (error) {
        const message = handleAuthError(error, {
          defaultMessage: 'Failed to sync identity',
          code: REGISTER_ERROR_CODE,
          onError,
          setAuthError: (msg) => setAuthState({ error: msg }),
          logger,
        });
        loginFailure(message);
        throw error;
      } finally {
        setAuthState({ isLoading: false });
        setSyncing(false);
      }
    },
    [oxyServices, storage, setAuthState, performSignIn, loginFailure, onError, logger, setSyncing, setIdentitySynced],
  );

  /**
   * Import identity from recovery phrase (offline-first)
   */
  const importIdentity = useCallback(
    async (phrase: string): Promise<{ synced: boolean }> => {
      if (!storage) throw new Error('Storage not initialized');

      setAuthState({ isLoading: true, error: null });

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
            console.log('[Auth] Identity imported locally, will sync when online:', syncError);
          }
          return { synced: false };
        }
      } catch (error) {
        const message = handleAuthError(error, {
          defaultMessage: 'Failed to import identity',
          code: REGISTER_ERROR_CODE,
          onError,
          setAuthError: (msg) => setAuthState({ error: msg }),
          logger,
        });
        loginFailure(message);
        throw error;
      } finally {
        setAuthState({ isLoading: false });
      }
    },
    [oxyServices, storage, setAuthState, loginFailure, onError, logger, setIdentitySynced],
  );

  /**
   * Sign in with existing identity on device
   */
  const signIn = useCallback(
    async (deviceName?: string): Promise<User> => {
      if (!storage) throw new Error('Storage not initialized');

      setAuthState({ isLoading: true, error: null });

      try {
        // Get stored public key
        const publicKey = await KeyManager.getPublicKey();
        if (!publicKey) {
          throw new Error('No identity found on this device. Please create or import an identity.');
        }

        return await performSignIn(publicKey);
      } catch (error) {
        const message = handleAuthError(error, {
          defaultMessage: 'Sign in failed',
          code: LOGIN_ERROR_CODE,
          onError,
          setAuthError: (msg) => setAuthState({ error: msg }),
          logger,
        });
        loginFailure(message);
        throw error;
      } finally {
        setAuthState({ isLoading: false });
      }
    },
    [storage, setAuthState, performSignIn, loginFailure, onError, logger],
  );

  /**
   * Logout from session
   */
  const logout = useCallback(
    async (targetSessionId?: string): Promise<void> => {
      if (!activeSessionId) return;

      try {
        const sessionToLogout = targetSessionId || activeSessionId;
        await oxyServices.logoutSession(activeSessionId, sessionToLogout);

        const filteredSessions = sessions.filter((session) => session.sessionId !== sessionToLogout);
        updateSessions(filteredSessions, { merge: false });

        if (sessionToLogout === activeSessionId) {
          if (filteredSessions.length > 0) {
            await switchSession(filteredSessions[0].sessionId);
          } else {
            await clearSessionState();
            return;
          }
        }
      } catch (error) {
        const isInvalid = isInvalidSessionError(error);

        if (isInvalid && targetSessionId === activeSessionId) {
          await clearSessionState();
          return;
        }

        handleAuthError(error, {
          defaultMessage: 'Logout failed',
          code: LOGOUT_ERROR_CODE,
          onError,
          setAuthError: (msg) => setAuthState({ error: msg }),
          logger,
          status: isInvalid ? 401 : undefined,
        });
      }
    },
    [
      activeSessionId,
      clearSessionState,
      logger,
      onError,
      oxyServices,
      sessions,
      setAuthState,
      switchSession,
      updateSessions,
    ],
  );

  /**
   * Logout from all sessions
   */
  const logoutAll = useCallback(async (): Promise<void> => {
    if (!activeSessionId) {
      const error = new Error('No active session found');
      setAuthState({ error: error.message });
      onError?.({ message: error.message, code: LOGOUT_ALL_ERROR_CODE, status: 404 });
      throw error;
    }

    try {
      await oxyServices.logoutAllSessions(activeSessionId);
      await clearSessionState();
    } catch (error) {
      handleAuthError(error, {
        defaultMessage: 'Logout all failed',
        code: LOGOUT_ALL_ERROR_CODE,
        onError,
        setAuthError: (msg) => setAuthState({ error: msg }),
        logger,
      });
      throw error instanceof Error ? error : new Error('Logout all failed');
    }
  }, [activeSessionId, clearSessionState, logger, onError, oxyServices, setAuthState]);

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

  return {
    createIdentity,
    importIdentity,
    signIn,
    logout,
    logoutAll,
    hasIdentity,
    getPublicKey,
    isIdentitySynced: isIdentitySyncedFn,
    syncIdentity,
  };
};
