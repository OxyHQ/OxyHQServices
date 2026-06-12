import { useCallback, useRef } from 'react';
import type { ApiError, User } from '@oxyhq/core';
import type { AuthState } from '../../stores/authStore';
import type { ClientSession, SessionLoginResponse } from '@oxyhq/core';
import { DeviceManager } from '@oxyhq/core';
import { fetchSessionsWithFallback, mapSessionsToClient } from '../../utils/sessionHelpers';
import { handleAuthError, isInvalidSessionError } from '../../utils/errorHandlers';
import type { StorageInterface } from '../../utils/storageHelpers';
import type { OxyServices } from '@oxyhq/core';
import { SignatureService } from '@oxyhq/core';
import { isWebBrowser } from '../../hooks/useWebSSO';
import { clearActiveAuthuser } from '../../utils/activeAuthuser';

/** Type guard for error objects with optional code and status properties */
function isErrorWithCodeOrStatus(error: unknown): error is { code?: string; status?: number; message?: string } {
  return typeof error === 'object' && error !== null;
}

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
  /** Sign in with existing public key */
  signIn: (publicKey: string, deviceName?: string) => Promise<User>;
  /** Logout from current session */
  logout: (targetSessionId?: string) => Promise<void>;
  /** Logout from all sessions */
  logoutAll: () => Promise<void>;
}

const LOGIN_ERROR_CODE = 'LOGIN_ERROR';
const LOGOUT_ERROR_CODE = 'LOGOUT_ERROR';
const LOGOUT_ALL_ERROR_CODE = 'LOGOUT_ALL_ERROR';

/**
 * Authentication operations using public key cryptography.
 * Accepts public key as parameter - identity management is handled by the app layer.
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
  // Ref to avoid recreating callbacks when sessions change
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  /**
   * Internal function to perform challenge-response sign in (works offline)
   */
  const performSignIn = useCallback(
    async (publicKey: string): Promise<User> => {
      const deviceFingerprintObj = DeviceManager.getDeviceFingerprint();
      const deviceFingerprint = JSON.stringify(deviceFingerprintObj);
      const deviceInfo = await DeviceManager.getDeviceInfo();
      const deviceName = deviceInfo.deviceName || DeviceManager.getDefaultDeviceName();

      let challenge: string;
      let isOffline = false;

      // Try to request challenge from server (online)
      try {
        const challengeResponse = await oxyServices.requestChallenge(publicKey);
        challenge = challengeResponse.challenge;
      } catch (error) {
        // Network error - generate challenge locally for offline sign-in
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isNetworkError = 
          errorMessage.includes('Network') ||
          errorMessage.includes('network') ||
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('fetch failed') ||
          (isErrorWithCodeOrStatus(error) && error.code === 'NETWORK_ERROR') ||
          (isErrorWithCodeOrStatus(error) && error.status === 0);

        if (isNetworkError) {
          if (__DEV__ && logger) {
            logger('Network unavailable, performing offline sign-in');
          }
          // Generate challenge locally
          challenge = await SignatureService.generateChallenge();
          isOffline = true;
        } else {
          // Re-throw non-network errors
          throw error;
        }
      }

      // Note: Biometric authentication check should be handled by the app layer
      // (e.g., accounts app) before calling signIn. The biometric preference is stored
      // in local storage as 'oxy_biometric_enabled' and can be checked there.

      // Sign the challenge
      const { challenge: signature, timestamp } = await SignatureService.signChallenge(challenge);

      let fullUser: User;
      let sessionResponse: SessionLoginResponse;

      if (isOffline) {
        // Offline sign-in: create local session and minimal user object
        if (__DEV__ && logger) {
          logger('Creating offline session');
        }

        // Generate a local session ID using cryptographically secure randomness
        const Crypto = await import('expo-crypto');
        const localSessionId = `offline_${Crypto.getRandomUUID()}`;
        const localDeviceId = `device_${Crypto.getRandomUUID()}`;
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

        // Create minimal user object with publicKey as id
        fullUser = {
          id: publicKey, // Use publicKey as id (per migration document)
          publicKey,
          username: '',
          privacySettings: {},
        } as User;

        sessionResponse = {
          sessionId: localSessionId,
          deviceId: localDeviceId,
          expiresAt,
          user: {
            id: publicKey,
            username: '',
          },
        };

        // Store offline session locally
        const offlineSession: ClientSession = {
          sessionId: localSessionId,
          deviceId: localDeviceId,
          expiresAt,
          lastActive: new Date().toISOString(),
          userId: publicKey,
          isCurrent: true,
        };

        setActiveSessionId(localSessionId);
        await saveActiveSessionId(localSessionId);
        updateSessions([offlineSession], { merge: true });

        // Mark session as offline for later sync
        if (storage) {
          await storage.setItem(`oxy_session_${localSessionId}_offline`, 'true');
        }

        if (__DEV__ && logger) {
          logger('Offline sign-in successful');
        }
      } else {
        // Online sign-in: use normal flow.
        // Verify and create session. `verifyChallenge` plants the first
        // access token (and refresh token) from the `/auth/verify` response
        // body internally — mirroring `claimSessionByToken` — so the client is
        // authenticated as soon as this resolves. We deliberately do NOT fall
        // back to the bearer-protected `GET /session/token/:sessionId` (C1
        // hardening): for a brand-new identity with no bearer yet that route
        // 401s, which previously broke the entire new-identity onboarding
        // flow. A token-less verify response simply leaves the client without
        // a bearer here rather than triggering that 401.
        sessionResponse = await oxyServices.verifyChallenge(
          publicKey,
          challenge,
          signature,
          timestamp,
          deviceName,
          deviceFingerprint,
        );

        // Get full user data
        fullUser = await oxyServices.getUserBySession(sessionResponse.sessionId);

        // Fetch device sessions
        let allDeviceSessions: ClientSession[] = [];
        try {
          allDeviceSessions = await fetchSessionsWithFallback(oxyServices, sessionResponse.sessionId, {
            fallbackDeviceId: sessionResponse.deviceId,
            fallbackUserId: fullUser.id,
            logger,
          });
        } catch (error) {
          if (__DEV__ && logger) {
            logger('Failed to fetch device sessions after login', error);
          }
        }

        // Check for existing session for same user and switch to it to avoid duplicates
        const existingSession = allDeviceSessions.find(
          (session) =>
            session.userId?.toString() === fullUser.id?.toString() &&
            session.sessionId !== sessionResponse.sessionId,
        );

        if (existingSession) {
          // Switch to existing session instead of creating duplicate
          try {
            await oxyServices.logoutSession(sessionResponse.sessionId, sessionResponse.sessionId);
          } catch (logoutError) {
            // Non-critical - continue to switch session even if logout fails
            if (__DEV__ && logger) {
              logger('Failed to logout duplicate session, continuing with switch', logoutError);
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
      }

      await applyLanguagePreference(fullUser);
      loginSuccess(fullUser);
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
      storage,
    ],
  );

  /**
   * Sign in with existing public key
   */
  const signIn = useCallback(
    async (publicKey: string, deviceName?: string): Promise<User> => {
      setAuthState({ isLoading: true, error: null });

      try {
        return await performSignIn(publicKey);
      } catch (error) {
        const message = handleAuthError(error, {
          defaultMessage: 'Sign in failed',
          code: LOGIN_ERROR_CODE,
          onError,
          setAuthError: (msg: string) => setAuthState({ error: msg }),
          logger,
        });
        loginFailure(message);
        throw error;
      } finally {
        setAuthState({ isLoading: false });
      }
    },
    [setAuthState, performSignIn, loginFailure, onError, logger],
  );

  /**
   * Logout from session
   */
  const logout = useCallback(
    async (targetSessionId?: string): Promise<void> => {
      if (!activeSessionId) return;

      try {
        const sessionToLogout = targetSessionId || activeSessionId;
        // Web multi-account: when the target session carries an `authuser`
        // slot index it is backed by an httpOnly `oxy_rt_${n}` cookie. Use
        // the cookie-cleared logout endpoint so the server can `Set-Cookie`
        // an immediate expiry alongside revoking the family. Native and
        // legacy sessions (no `authuser` plumbed yet) fall through to the
        // bearer-protected endpoint.
        const targetSession = sessionsRef.current.find((s) => s.sessionId === sessionToLogout);
        const targetAuthuser = targetSession?.authuser;
        if (isWebBrowser() && typeof targetAuthuser === 'number') {
          await oxyServices.logoutSessionByAuthuser(targetAuthuser);
        } else {
          await oxyServices.logoutSession(activeSessionId, sessionToLogout);
        }

        const filteredSessions = sessionsRef.current.filter((session) => session.sessionId !== sessionToLogout);
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
          setAuthError: (msg: string) => setAuthState({ error: msg }),
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
      // Semantics intentionally diverge by platform to match user expectation:
      //   - Web: "Sign out of all accounts" = sign out every device-local
      //     account on THIS device. The cookie endpoint is the only path
      //     that can `Set-Cookie` an immediate expiry on every
      //     `oxy_rt_${n}` slot (plus legacy `oxy_rt`) AND revoke every
      //     presented family server-side. The bearer-protected
      //     `logoutAllSessions(activeSessionId)` would only revoke the
      //     active user's sessions across devices and leave sibling
      //     accounts' cookies sitting on this device — wrong UX for the
      //     chooser's "Sign out of all accounts".
      //   - Native: there are no per-account cookies; "Sign out of all"
      //     keeps its long-standing "revoke every session of THIS user"
      //     meaning via the bearer endpoint.
      // After clearing on web, also drop the persisted active-authuser so
      // the next cold boot starts from a clean slate.
      if (isWebBrowser()) {
        await oxyServices.logoutAllSessionsViaCookie();
        clearActiveAuthuser();
      } else {
        await oxyServices.logoutAllSessions(activeSessionId);
      }
      await clearSessionState();
    } catch (error) {
      handleAuthError(error, {
        defaultMessage: 'Logout all failed',
        code: LOGOUT_ALL_ERROR_CODE,
        onError,
        setAuthError: (msg: string) => setAuthState({ error: msg }),
        logger,
      });
      throw error instanceof Error ? error : new Error('Logout all failed');
    }
  }, [activeSessionId, clearSessionState, logger, onError, oxyServices, setAuthState]);

  return {
    signIn,
    logout,
    logoutAll,
  };
};
