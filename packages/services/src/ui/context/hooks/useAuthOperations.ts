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
  logger?: (message: string, error?: unknown) => void;
}

export interface UseAuthOperationsResult {
  /** Create a new identity and register with the server */
  createIdentity: (username: string, email?: string) => Promise<{ user: User; recoveryPhrase: string[] }>;
  /** Import an existing identity from recovery phrase */
  importIdentity: (phrase: string, username?: string, email?: string) => Promise<User>;
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
  logger,
}: UseAuthOperationsOptions): UseAuthOperationsResult => {
  
  /**
   * Create a new identity with recovery phrase
   */
  const createIdentity = useCallback(
    async (username: string, email?: string): Promise<{ user: User; recoveryPhrase: string[] }> => {
      if (!storage) throw new Error('Storage not initialized');

      setAuthState({ isLoading: true, error: null });

      try {
        // Generate new identity with recovery phrase
        const { phrase, words, publicKey } = await RecoveryPhraseService.generateIdentityWithRecovery();

        // Create registration signature
        const { signature, timestamp } = await SignatureService.createRegistrationSignature(username, email);

        // Register with server
        const { user } = await oxyServices.register(publicKey, username, signature, timestamp, email);

        // Now sign in to create a session
        const fullUser = await performSignIn(publicKey);

        return {
          user: fullUser,
          recoveryPhrase: words,
        };
      } catch (error) {
        // Clean up identity if registration failed
        await KeyManager.deleteIdentity().catch(() => {});
        
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
    [oxyServices, storage, setAuthState, loginFailure, onError, logger],
  );

  /**
   * Import identity from recovery phrase
   */
  const importIdentity = useCallback(
    async (phrase: string, username?: string, email?: string): Promise<User> => {
      if (!storage) throw new Error('Storage not initialized');

      setAuthState({ isLoading: true, error: null });

      try {
        // Restore identity from phrase
        const publicKey = await RecoveryPhraseService.restoreFromPhrase(phrase);

        // Check if this identity is already registered
        const { registered } = await oxyServices.checkPublicKeyRegistered(publicKey);

        if (registered) {
          // Identity exists, just sign in
          return await performSignIn(publicKey);
        } else {
          // Need to register this identity
          if (!username) {
            throw new Error('Username is required for new registration');
          }

          const { signature, timestamp } = await SignatureService.createRegistrationSignature(username, email);
          await oxyServices.register(publicKey, username, signature, timestamp, email);
          
          return await performSignIn(publicKey);
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
    [oxyServices, storage, setAuthState, loginFailure, onError, logger],
  );

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
  };
};
