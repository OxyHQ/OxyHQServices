import { useCallback } from 'react';
import type { ApiError, SessionClient, User } from '@oxyhq/core';
import type { AuthState } from '../../stores/authStore';
import type { ClientSession, SessionLoginResponse } from '@oxyhq/core';
import { DeviceManager } from '@oxyhq/core';
import { fetchSessionsWithFallback } from '../../utils/sessionHelpers';
import { handleAuthError, isInvalidSessionError } from '../../utils/errorHandlers';
import type { StorageInterface } from '../../utils/storageHelpers';
import type { OxyServices } from '@oxyhq/core';
import { SignatureService } from '@oxyhq/core';
import { isWebBrowser } from '../../hooks/useWebSSO';
import {
  clearSsoBounceState,
  markSignedOut,
  clearSignedOut,
} from '../../utils/activeAuthuser';
import { isCrossApexWeb, CrossApexDirectSignInError } from '../../../utils/crossApex';

export interface UseAuthOperationsOptions {
  oxyServices: OxyServices;
  storage: StorageInterface | null;
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
  /** Used only by `performSignIn`'s same-user duplicate-session dedup (legacy session-validate path; unrelated to the SessionClient device-account set). */
  switchSession: (sessionId: string) => Promise<User>;
  /**
   * The Fase 3-A/3-B `SessionClient` (server-authoritative device account
   * set). `logout` / `logoutAll` route SERVER-side revocation through
   * `sessionClient.signOut(...)` instead of the bearer/cookie logout
   * endpoints.
   */
  sessionClient: SessionClient;
  /** Reprojects `sessionClient.getState()` onto sessions/activeSessionId/user (Task 1's callback). Awaited after a partial `signOut` so the exposed state reflects the server truth before the call resolves. */
  syncFromClient: () => Promise<void>;
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
 *
 * Exported so `OxyContext`'s `syncFromClient` zero-account branch (a REMOTE
 * full sign-out) can invoke the EXACT same cleanup as the LOCAL `logout` /
 * `logoutAll` paths below — a remote sign-out must be indistinguishable from
 * a local one to the next cold boot.
 */
export function clearPriorSessionHintSafe(
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
  activeSessionId,
  setActiveSessionId,
  updateSessions,
  saveActiveSessionId,
  clearSessionState,
  clearPriorSessionHint,
  switchSession,
  sessionClient,
  syncFromClient,
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

      // Deliberate sign-in re-enables automatic silent restore: clear the durable
      // "deliberately signed out" flag so a prior sign-out no longer suppresses
      // the `fedcm-silent` / per-apex iframe cold-boot steps.
      clearSignedOut();

      // Register this recovered account+session into the server-authoritative
      // device-session set: `sessionClient.addCurrentAccount()` ->
      // `POST /session/device/add` derives identity from the bearer
      // `verifyChallenge` already planted internally, then `syncFromClient()`
      // reprojects the resulting server state onto the exposed
      // sessions/activeSessionId/user. Best-effort: a failure here must NEVER
      // fail the sign-in itself — cold boot re-registers this account into the
      // device set on the next load regardless.
      try {
        await sessionClient.addCurrentAccount();
        await syncFromClient();
      } catch (registrationError) {
        logger?.('Failed to register sign-in into device session set', registrationError);
      }

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
      sessionClient,
      setActiveSessionId,
      switchSession,
      syncFromClient,
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

        // Resolve the device account backing this session from the
        // server-authoritative `SessionClient` state — SERVER revocation now
        // goes through `sessionClient.signOut(...)` instead of the
        // bearer/cookie logout endpoints.
        const targetAccountId = sessionClient
          .getState()
          ?.accounts.find((account) => account.sessionId === sessionToLogout)?.accountId;
        if (!targetAccountId) {
          throw new Error(`No device account found for session "${sessionToLogout}"`);
        }

        await sessionClient.signOut({ accountId: targetAccountId });

        // The server has already decided what (if anything) remains active on
        // this device; reproject that truth onto the exposed sessions /
        // activeSessionId / user before deciding whether additional LOCAL
        // teardown is needed.
        const remainingAccounts = sessionClient.getState()?.accounts ?? [];
        await syncFromClient();

        if (sessionToLogout === activeSessionId && remainingAccounts.length === 0) {
          // Genuine FULL sign-out (no sessions remain): clear the per-origin
          // SSO bounce state so a fresh deliberate sign-in can re-probe, and
          // SET the deliberately-signed-out flag so the silent cold-boot steps
          // (`fedcm-silent` / per-apex iframe) do not re-mint a session from a
          // still-live IdP session on the next reload (mirrors `logoutAll`).
          markSignedOut();
          clearSsoBounceState();
          clearPriorSessionHintSafe(clearPriorSessionHint, logger);
          await clearSessionState();
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
      sessionClient,
      setAuthState,
      syncFromClient,
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
      // Server-side revocation of every account on this device now flows
      // through the SessionClient (`POST /session/device/signout` with
      // `{ all: true }`) — replaces the bearer `logoutAllSessions` +
      // web-cookie `logoutAllSessionsViaCookie` pair.
      await sessionClient.signOut({ all: true });
      if (isWebBrowser()) {
        // Deliberate full sign-out: suppress automatic silent restore on the next
        // cold boot so a still-live IdP session does not re-mint a session.
        markSignedOut();
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
  }, [activeSessionId, clearSessionState, clearPriorSessionHint, logger, onError, sessionClient, setAuthState]);

  return {
    signIn,
    logout,
    logoutAll,
  };
};
