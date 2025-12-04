import { useCallback } from 'react';
import type { ApiError, User } from '../../../models/interfaces';
import type { AuthState } from '../stores/authStore';
import type { ClientSession, SessionLoginResponse } from '../../../models/session';
import { DeviceManager } from '../../../utils/deviceManager';
import { fetchSessionsWithFallback, mapSessionsToClient } from '../utils/sessionHelpers';
import { handleAuthError, isInvalidSessionError } from '../utils/errorHandlers';
import type { StorageInterface } from '../utils/storageHelpers';
import type { OxyServices } from '../../../core';

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
  login: (username: string, password: string, deviceName?: string) => Promise<User>;
  signUp: (username: string, email: string, password: string) => Promise<User>;
  completeMfaLogin: (mfaToken: string, code: string) => Promise<User>;
  logout: (targetSessionId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
}

const LOGIN_ERROR_CODE = 'LOGIN_ERROR';
const MFA_ERROR_CODE = 'MFA_ERROR';
const SIGNUP_ERROR_CODE = 'SIGNUP_ERROR';
const LOGOUT_ERROR_CODE = 'LOGOUT_ERROR';
const LOGOUT_ALL_ERROR_CODE = 'LOGOUT_ALL_ERROR';

/**
 * Encapsulate authentication flows, multi-session aware logout, and MFA handling.
 *
 * @param options - Auth operation configuration
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
  const login = useCallback(
    async (username: string, password: string, deviceName?: string): Promise<User> => {
      if (!storage) throw new Error('Storage not initialized');

      setAuthState({ isLoading: true, error: null });

      try {
        const deviceFingerprint = DeviceManager.getDeviceFingerprint();
        const deviceInfo = await DeviceManager.getDeviceInfo();

        const response = await oxyServices.signIn(
          username,
          password,
          deviceName || deviceInfo.deviceName || DeviceManager.getDefaultDeviceName(),
          deviceFingerprint,
        );

        if (response && 'mfaRequired' in response && response.mfaRequired) {
          const mfaError = new Error('Multi-factor authentication required') as Error & {
            code: string;
            mfaToken?: string;
            expiresAt?: string;
          };
          mfaError.code = 'MFA_REQUIRED';
          mfaError.mfaToken = (response as { mfaToken?: string }).mfaToken;
          mfaError.expiresAt = (response as { expiresAt?: string }).expiresAt;
          throw mfaError;
        }

        const sessionResponse = response as SessionLoginResponse;
        await oxyServices.getTokenBySession(sessionResponse.sessionId);

        const fullUser = await oxyServices.getUserBySession(sessionResponse.sessionId);
        await applyLanguagePreference(fullUser);
        loginSuccess(fullUser);

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

        const existingSession = allDeviceSessions.find(
          (session) =>
            session.userId?.toString() === fullUser.id?.toString() &&
            session.sessionId !== sessionResponse.sessionId,
        );

        if (existingSession) {
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
      } catch (error) {
        const message = handleAuthError(error, {
          defaultMessage: 'Login failed',
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
    [
      applyLanguagePreference,
      logger,
      loginFailure,
      loginSuccess,
      onAuthStateChange,
      onError,
      oxyServices,
      saveActiveSessionId,
      setActiveSessionId,
      setAuthState,
      storage,
      switchSession,
      updateSessions,
    ],
  );

  const signUp = useCallback(
    async (username: string, email: string, password: string): Promise<User> => {
      if (!storage) throw new Error('Storage not initialized');
      setAuthState({ isLoading: true, error: null });

      try {
        await oxyServices.signUp(username, email, password);
        return await login(username, password);
      } catch (error) {
        const message = handleAuthError(error, {
          defaultMessage: 'Sign up failed',
          code: SIGNUP_ERROR_CODE,
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
    [login, logger, loginFailure, onError, oxyServices, setAuthState, storage],
  );

  const completeMfaLogin = useCallback(
    async (mfaToken: string, code: string): Promise<User> => {
      if (!storage) throw new Error('Storage not initialized');
      setAuthState({ isLoading: true, error: null });

      try {
        const response = await oxyServices.verifyTotpLogin(mfaToken, code);

        await oxyServices.getTokenBySession(response.sessionId);
        const fullUser = await oxyServices.getUserBySession(response.sessionId);

        setActiveSessionId(response.sessionId);
        await saveActiveSessionId(response.sessionId);
        loginSuccess(fullUser);
        await applyLanguagePreference(fullUser);

        try {
          const deviceSessions = await fetchSessionsWithFallback(oxyServices, response.sessionId, {
            fallbackUserId: fullUser.id,
            logger,
          });
          updateSessions(deviceSessions, { merge: true });
        } catch (error) {
          if (__DEV__) {
            console.warn('Failed to fetch sessions after MFA login:', error);
          }
        }

        onAuthStateChange?.(fullUser);
        return fullUser;
      } catch (error) {
        const message = handleAuthError(error, {
          defaultMessage: 'MFA verification failed',
          code: MFA_ERROR_CODE,
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
    [
      applyLanguagePreference,
      logger,
      loginFailure,
      loginSuccess,
      onAuthStateChange,
      onError,
      oxyServices,
      saveActiveSessionId,
      setActiveSessionId,
      setAuthState,
      storage,
      updateSessions,
    ],
  );

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
      logoutStore,
      onAuthStateChange,
      onError,
      oxyServices,
      sessions,
      setActiveSessionId,
      setAuthState,
      switchSession,
      updateSessions,
    ],
  );

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

  return {
    login,
    signUp,
    completeMfaLogin,
    logout,
    logoutAll,
  };
};


