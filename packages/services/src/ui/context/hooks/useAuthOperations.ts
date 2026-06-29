import { useCallback, useRef } from 'react';
import type { ApiError, User } from '@oxyhq/core';
import type { AuthState } from '../../stores/authStore';
import type { ClientSession, SessionLoginResponse } from '@oxyhq/core';
import { DeviceManager } from '@oxyhq/core';
import { fetchSessionsWithFallback } from '../../utils/sessionHelpers';
import { handleAuthError, isInvalidSessionError } from '../../utils/errorHandlers';
import type { StorageInterface } from '../../utils/storageHelpers';
import type { OxyServices } from '@oxyhq/core';
import { SignatureService } from '@oxyhq/core';
import { isWebBrowser } from '../../hooks/useWebSSO';
import { clearActiveAuthuser, clearSsoBounceState } from '../../utils/activeAuthuser';
import { isCrossApexWeb, CrossApexDirectSignInError } from '../../../utils/crossApex';

export interface UseAuthOperationsOptions {
  oxyServices: OxyServices;
  storage: StorageInterface | null;
  sessions: ClientSession[];
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  updateSessions: (sessions: ClientSession[], options?: { merge?: boolean }) => void;
  saveActiveSessionId: (sessionId: string) => Promise<void>;
  clearSessionState: () => Promise<void>;
  /**
   * Clear the durable returning-user hint (`storageKeys.priorSession`). Called
   * ONLY on EXPLICIT full sign-out — alongside `clearSsoBounceState()` — so the
   * next cold boot treats this device as a first-time anonymous visitor (no
   * forced `/sso` bounce). NEVER called on the passive token-expiry path, so an
   * expired session still recovers via a returning-user bounce. Best-effort.
   */
  clearPriorSessionHint: () => Promise<void>;
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
 * Fire-and-forget the durable returning-user hint clear on explicit sign-out.
 *
 * Mirrors the synchronous, non-blocking nature of the sibling
 * `clearSsoBounceState()`: sign-out must NEVER block on (or fail because of) a
 * best-effort storage write. The clear is invoked synchronously (so unit tests
 * can assert it ran) but its async settle is detached; any rejection is logged,
 * never thrown.
 */
function clearPriorSessionHintSafe(
  clearPriorSessionHint: () => Promise<void>,
  logger?: (message: string, error?: unknown) => void,
): void {
  clearPriorSessionHint().catch((hintError) => {
    logger?.('Failed to clear prior-session hint on sign-out', hintError);
  });
}

/**
 * Authentication operations using public key cryptography.
 * Accepts public key as parameter - identity management is handled by the app layer.
 */
export const useAuthOperations = ({
  oxyServices,
  sessions,
  activeSessionId,
  setActiveSessionId,
  updateSessions,
  saveActiveSessionId,
  clearSessionState,
  clearPriorSessionHint,
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
   * Internal function to perform challenge-response sign in.
   */
  const performSignIn = useCallback(
    async (publicKey: string): Promise<User> => {
      const deviceFingerprintObj = DeviceManager.getDeviceFingerprint();
      const deviceFingerprint = JSON.stringify(deviceFingerprintObj);
      const deviceInfo = await DeviceManager.getDeviceInfo();
      const deviceName = deviceInfo.deviceName || DeviceManager.getDefaultDeviceName();

      const challengeResponse = await oxyServices.requestChallenge(publicKey);
      const challenge = challengeResponse.challenge;

      // Note: Biometric authentication check should be handled by the app layer
      // (e.g., accounts app) before calling signIn. The biometric preference is stored
      // in local storage as 'oxy_biometric_enabled' and can be checked there.

      // Sign the challenge
      const { challenge: signature, timestamp } = await SignatureService.signChallenge(challenge);

      let fullUser: User;
      let sessionResponse: SessionLoginResponse;

      // `verifyChallenge` plants the first access token internally, mirroring
      // `claimSessionByToken`, so the client is authenticated as soon as this
      // resolves.
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
    ],
  );

  /**
   * Sign in with existing public key
   */
  const signIn = useCallback(
    async (publicKey: string, deviceName?: string): Promise<User> => {
      // On a cross-apex web RP a direct public-key sign-in mints a bearer against
      // the Oxy API but establishes no `fedcm_session`, so the session would be
      // lost on reload. Refuse it and direct the app to the durable IdP popup
      // ("Continue with Oxy"). Native and same-apex `*.oxy.so` are unaffected.
      if (isCrossApexWeb()) {
        throw new CrossApexDirectSignInError();
      }
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
        // Web multi-account sessions carry an `authuser` slot index backed by
        // an httpOnly `oxy_rt_${n}` cookie. Native sessions fall through to the
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
            // Genuine FULL sign-out (no sessions remain): clear the per-origin
            // SSO bounce state so a fresh deliberate sign-in can re-probe.
            clearSsoBounceState();
            clearPriorSessionHintSafe(clearPriorSessionHint, logger);
            await clearSessionState();
            return;
          }
        }
      } catch (error) {
        const isInvalid = isInvalidSessionError(error);

        if (isInvalid && targetSessionId === activeSessionId) {
          // The active session is invalid → full sign-out; clear SSO state too.
          clearSsoBounceState();
          clearPriorSessionHintSafe(clearPriorSessionHint, logger);
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
      clearPriorSessionHint,
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
      // Always invoke the bearer-protected global endpoint first: the public
      // `logoutAll`/`signOutAll` contract means revoking this user's sessions
      // across devices, not just clearing refresh cookies presented by the
      // current browser. On web, follow up with the cookie endpoint so every
      // device-local account slot is expired in the browser as well.
      await oxyServices.logoutAllSessions(activeSessionId);
      if (isWebBrowser()) {
        await oxyServices.logoutAllSessionsViaCookie();
        clearActiveAuthuser();
      }
      // logoutAll is ALWAYS a full sign-out: clear the per-origin SSO bounce
      // state (web-guarded internally) so a fresh sign-in can re-probe, and drop
      // the durable returning-user hint so the next cold boot is treated as a
      // first-time anonymous visitor (no forced `/sso` bounce after sign-out).
      clearSsoBounceState();
      clearPriorSessionHintSafe(clearPriorSessionHint, logger);
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
  }, [activeSessionId, clearSessionState, clearPriorSessionHint, logger, onError, oxyServices, setAuthState]);

  return {
    signIn,
    logout,
    logoutAll,
  };
};
