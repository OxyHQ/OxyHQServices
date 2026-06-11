import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { OxyServices, oxyClient } from '@oxyhq/core';
import type { User, ApiError, SessionLoginResponse } from '@oxyhq/core';
import type { ManagedAccount, CreateManagedAccountInput } from '@oxyhq/core';
import { KeyManager } from '@oxyhq/core';
import type { ClientSession } from '@oxyhq/core';
import { toast } from '@oxyhq/bloom';
import { useAuthStore, type AuthState } from '../stores/authStore';
import { useShallow } from 'zustand/react/shallow';
import { useSessionSocket } from '../hooks/useSessionSocket';
import type { UseFollowHook } from '../hooks/useFollow.types';
import { useLanguageManagement } from '../hooks/useLanguageManagement';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useAuthOperations } from './hooks/useAuthOperations';
import { useDeviceManagement } from '../hooks/useDeviceManagement';
import { getStorageKeys, createPlatformStorage, type StorageInterface } from '../utils/storageHelpers';
import { isInvalidSessionError, isTimeoutOrNetworkError } from '../utils/errorHandlers';
import type { RouteName } from '../navigation/routes';
import { showBottomSheet as globalShowBottomSheet } from '../navigation/bottomSheetManager';
import { useQueryClient } from '@tanstack/react-query';
import { clearQueryCache } from '../hooks/queryClient';
import { useAvatarPicker } from '../hooks/useAvatarPicker';
import { useAccountStore } from '../stores/accountStore';
import { logger as loggerUtil } from '@oxyhq/core';
import { useWebSSO, isWebBrowser } from '../hooks/useWebSSO';

export interface OxyContextState {
  user: User | null;
  sessions: ClientSession[];
  activeSessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isTokenReady: boolean;
  isStorageReady: boolean;
  error: string | null;
  currentLanguage: string;
  currentLanguageMetadata: ReturnType<typeof useLanguageManagement>['metadata'];
  currentLanguageName: string;
  currentNativeLanguageName: string;

  // Identity (cryptographic key pair)
  hasIdentity: () => Promise<boolean>;
  getPublicKey: () => Promise<string | null>;

  // Authentication
  signIn: (publicKey: string, deviceName?: string) => Promise<User>;

  /**
   * Handle session from popup authentication
   * Updates auth state, persists session to storage
   */
  handlePopupSession: (session: SessionLoginResponse) => Promise<void>;

  // Session management
  logout: (targetSessionId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  setLanguage: (languageId: string) => Promise<void>;
  getDeviceSessions: () => Promise<
    Array<{
      sessionId: string;
      deviceId: string;
      deviceName?: string;
      lastActive?: string;
      expiresAt?: string;
    }>
  >;
  logoutAllDeviceSessions: () => Promise<void>;
  updateDeviceName: (deviceName: string) => Promise<void>;
  clearSessionState: () => Promise<void>;
  clearAllAccountData: () => Promise<void>;
  storageKeyPrefix: string;
  oxyServices: OxyServices;
  useFollow?: UseFollowHook;
  showBottomSheet?: (screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> }) => void;
  openAvatarPicker: () => void;

  // Managed accounts (sub-accounts / managed identities)
  actingAs: string | null;
  managedAccounts: ManagedAccount[];
  setActingAs: (userId: string | null) => void;
  refreshManagedAccounts: () => Promise<void>;
  createManagedAccount: (data: CreateManagedAccountInput) => Promise<ManagedAccount>;
}

const OxyContext = createContext<OxyContextState | null>(null);

/**
 * Minimal, decode-only shape of the session access-token JWT claims the
 * `POST /auth/refresh` endpoint returns. We only read `sessionId` (and `userId`
 * as a fallback). The token is already signed and verified server-side; the
 * client decodes the payload purely to recover the session id — it does NOT and
 * MUST NOT verify the signature.
 */
interface RefreshAccessTokenClaims {
  sessionId?: string;
  userId?: string;
  id?: string;
}

/**
 * Decode the payload of a JWT WITHOUT verifying its signature.
 *
 * The server (`POST /auth/refresh`) has already minted and signed this access
 * token; we only need to recover the `sessionId` claim from it on cold boot.
 * Returns `null` for any malformed input rather than throwing, so a bad token
 * simply falls through to the unauthenticated path.
 *
 * Implemented with manual base64url decoding (no `jwt-decode` dependency added
 * to `@oxyhq/services`). Works on web (where this cold-boot path runs) via
 * `atob`; if `atob` is unavailable (non-browser runtime) it is treated as
 * undecodable and returns `null`.
 */
function decodeAccessTokenClaims(token: string): RefreshAccessTokenClaims | null {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const segments = token.split('.');
  if (segments.length !== 3) {
    return null;
  }
  const payloadSegment = segments[1];
  if (!payloadSegment) {
    return null;
  }
  try {
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    if (typeof atob !== 'function') {
      return null;
    }
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    );
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const claims = parsed as Record<string, unknown>;
    return {
      sessionId: typeof claims.sessionId === 'string' ? claims.sessionId : undefined,
      userId: typeof claims.userId === 'string' ? claims.userId : undefined,
      id: typeof claims.id === 'string' ? claims.id : undefined,
    };
  } catch {
    return null;
  }
}

/** Server response shape of `POST /auth/refresh`. */
interface RefreshCookieResponse {
  accessToken?: string;
  sessionId?: string;
}

export interface OxyContextProviderProps {
  children: ReactNode;
  oxyServices?: OxyServices;
  baseURL?: string;
  authWebUrl?: string;
  authRedirectUri?: string;
  storageKeyPrefix?: string;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: ApiError) => void;
}

let cachedUseFollowHook: UseFollowHook | null = null;

const loadUseFollowHook = (): UseFollowHook => {
  if (cachedUseFollowHook) {
    return cachedUseFollowHook;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useFollow } = require('../hooks/useFollow');
    cachedUseFollowHook = useFollow as UseFollowHook;
    return cachedUseFollowHook;
  } catch (error) {
    if (__DEV__) {
      loggerUtil.warn(
        'useFollow hook is not available. Please import useFollow from @oxyhq/services directly.',
        { component: 'OxyContext', method: 'loadUseFollowHook' },
        error
      );
    }

    const fallback: UseFollowHook = () => {
      throw new Error('useFollow hook is only available in the UI bundle. Import it from @oxyhq/services.');
    };

    cachedUseFollowHook = fallback;
    return cachedUseFollowHook;
  }
};

export const OxyProvider: React.FC<OxyContextProviderProps> = ({
  children,
  oxyServices: providedOxyServices,
  baseURL,
  authWebUrl,
  authRedirectUri,
  storageKeyPrefix = 'oxy_session',
  onAuthStateChange,
  onError,
}) => {
  const oxyServicesRef = useRef<OxyServices | null>(null);

  if (!oxyServicesRef.current) {
    if (providedOxyServices) {
      oxyServicesRef.current = providedOxyServices;
    } else if (baseURL) {
      oxyServicesRef.current = new OxyServices({
        baseURL,
        authWebUrl,
        authRedirectUri,
      });
    } else {
      throw new Error('Either oxyServices or baseURL must be provided to OxyContextProvider');
    }
  }

  const oxyServices = oxyServicesRef.current;

  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    loginSuccess,
    loginFailure,
    logoutStore,
  } = useAuthStore(
    useShallow((state: AuthState) => ({
      user: state.user,
      isAuthenticated: state.isAuthenticated,
      isLoading: state.isLoading,
      error: state.error,
      loginSuccess: state.loginSuccess,
      loginFailure: state.loginFailure,
      logoutStore: state.logout,
    })),
  );

  const [tokenReady, setTokenReady] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const setAuthState = useAuthStore.setState;

  // Keep the shared `oxyClient` singleton's token store in lockstep with the
  // session owned by THIS provider's instance. Many apps construct their api
  // clients against the exported `oxyClient` singleton (reading
  // `oxyClient.getAccessToken()` to build Authorization headers) while passing
  // only `baseURL` to OxyProvider — in which case the provider owns a DIFFERENT
  // `OxyServices` instance and the singleton would otherwise never receive the
  // token, producing `Authorization: Bearer null`.
  //
  // Subscribing to `onTokensChanged` mirrors EVERY token mutation — sign-in,
  // session restore, switch, silent refresh, and sign-out/clear — onto the
  // singleton at the single source of truth in @oxyhq/core, with no per-app
  // plumbing and regardless of which auth code path fired.
  //
  // When the app passed the singleton itself as `oxyServices` (Mention's
  // pattern), `oxyServices === oxyClient`, so we skip the redundant self-write
  // and the subscription is a no-op mirror — fully backward compatible.
  useEffect(() => {
    if (oxyServices === oxyClient) {
      return;
    }

    const applyToSingleton = (accessToken: string | null) => {
      if (accessToken) {
        oxyClient.setTokens(accessToken);
      } else {
        oxyClient.clearTokens();
      }
    };

    // Seed the singleton with whatever token the instance already holds (it may
    // have been planted synchronously before this effect ran — e.g. a token set
    // during the same tick as mount), then keep it in sync going forward.
    applyToSingleton(oxyServices.getAccessToken());

    return oxyServices.onTokensChanged(applyToSingleton);
  }, [oxyServices]);

  const logger = useCallback((message: string, err?: unknown) => {
    if (__DEV__) {
      console.warn(`[OxyContext] ${message}`, err);
    }
  }, []);

  const storageKeys = useMemo(() => getStorageKeys(storageKeyPrefix), [storageKeyPrefix]);

  // Storage initialization.
  //
  // `storage` (state) drives render-time gating (`isStorageReady`) and the
  // hooks below. But it is `null` for a brief window after mount while
  // `createPlatformStorage()` resolves (a microtask on web; a dynamic
  // `import()` on native). Any persistence path that fires during that window
  // — e.g. an interactive FedCM sign-in the instant the screen mounts — would
  // read `storage === null` and SILENTLY skip writing the session, leaving the
  // user signed-in in-memory but with nothing to restore on reload.
  //
  // To make persistence robust regardless of timing we ALSO expose the storage
  // as an awaitable promise (`getReadyStorage`). Persistence code awaits the
  // ready instance instead of branching on the possibly-null state, so a write
  // is never silently dropped just because it raced storage init.
  const storageRef = useRef<StorageInterface | null>(null);
  const [storage, setStorage] = useState<StorageInterface | null>(null);

  // A single, stable deferred that resolves with the initialized storage. Built
  // lazily via a ref initializer so the resolver is captured exactly once and
  // the promise identity is stable across renders.
  const buildStorageDeferred = () => {
    let resolve: (storage: StorageInterface) => void = () => undefined;
    const promise = new Promise<StorageInterface>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const storageReadyRef = useRef<ReturnType<typeof buildStorageDeferred> | null>(null);
  if (storageReadyRef.current === null) {
    storageReadyRef.current = buildStorageDeferred();
  }
  const storageReady = storageReadyRef.current;

  // Resolve the storage instance that is guaranteed to be ready. Returns the
  // already-initialized instance synchronously when available, otherwise awaits
  // the init promise. Never resolves to `null`.
  const getReadyStorage = useCallback((): Promise<StorageInterface> => {
    if (storageRef.current) {
      return Promise.resolve(storageRef.current);
    }
    return storageReady.promise;
  }, [storageReady]);

  useEffect(() => {
    let mounted = true;
    createPlatformStorage()
      .then((storageInstance) => {
        // Resolve the ready-promise even if the component unmounted: in-flight
        // persistence awaiting it must still complete against a real store.
        storageRef.current = storageInstance;
        storageReady.resolve(storageInstance);
        if (mounted) {
          setStorage(storageInstance);
        }
      })
      .catch((err) => {
        if (mounted) {
          logger('Failed to initialize storage', err);
          onError?.({
            message: 'Failed to initialize storage',
            code: 'STORAGE_INIT_ERROR',
            status: 500,
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, [logger, onError, storageReady]);


  // Offline queuing is now handled by TanStack Query mutations
  // No need for custom offline queue

  const {
    currentLanguage,
    metadata: currentLanguageMetadata,
    languageName: currentLanguageName,
    nativeLanguageName: currentNativeLanguageName,
    setLanguage,
    applyLanguagePreference,
  } = useLanguageManagement({
    storage,
    languageKey: storageKeys.language,
    onError,
    logger,
  });

  const queryClient = useQueryClient();

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    updateSessions,
    switchSession,
    refreshSessions,
    clearSessionState,
    saveActiveSessionId,
    trackRemovedSession,
  } = useSessionManagement({
    oxyServices,
    storage,
    storageKeyPrefix,
    loginSuccess,
    logoutStore,
    applyLanguagePreference,
    onAuthStateChange,
    onError,
    setAuthError: (message) => setAuthState({ error: message }),
    logger,
    setTokenReady,
    queryClient,
  });

  const {
    signIn,
    logout,
    logoutAll,
  } = useAuthOperations({
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
  });

  // Clear all account data (sessions, cache, etc.)
  const clearAllAccountData = useCallback(async (): Promise<void> => {
    // Clear TanStack Query cache (in-memory)
    queryClient.clear();

    // Clear persisted query cache
    if (storage) {
      try {
        await clearQueryCache(storage);
      } catch (error) {
        logger('Failed to clear persisted query cache', error);
      }
    }

    // Clear session state (sessions, activeSessionId, storage)
    await clearSessionState();

    // Reset account store
    useAccountStore.getState().reset();

    // Clear HTTP service cache
    oxyServices.clearCache();
  }, [queryClient, storage, clearSessionState, logger, oxyServices]);

  const { getDeviceSessions, logoutAllDeviceSessions, updateDeviceName } = useDeviceManagement({
    oxyServices,
    activeSessionId,
    onError,
    clearSessionState,
    logger,
  });

  const useFollowHook = loadUseFollowHook();

  // Refs for mutable callbacks to avoid stale closures in restoreSessionsFromStorage (#187)
  const switchSessionRef = useRef(switchSession);
  switchSessionRef.current = switchSession;
  const updateSessionsRef = useRef(updateSessions);
  updateSessionsRef.current = updateSessions;
  const clearSessionStateRef = useRef(clearSessionState);
  clearSessionStateRef.current = clearSessionState;

  // Durable, navigation-safe session persistence.
  //
  // Writes the active-session id and appends the session id to the durable
  // `session_ids` list, awaiting the READY storage instance (never the possibly
  // -null `storage` state) so a write is never dropped because it raced storage
  // init. Callers MUST invoke this BEFORE any work that can trigger a route
  // navigation (`onAuthStateChange`) — navigation can interrupt a still-pending
  // async write, which is exactly what once left `session_ids` empty after a
  // successful sign-in. Shared by the FedCM/popup path and the cold-boot
  // refresh-cookie restore so both land the same durable record.
  const persistSessionDurably = useCallback(async (sessionId: string): Promise<void> => {
    const readyStorage = await getReadyStorage();
    await readyStorage.setItem(storageKeys.activeSessionId, sessionId);
    const existingIds = await readyStorage.getItem(storageKeys.sessionIds);
    let sessionIds: string[] = [];
    try { sessionIds = existingIds ? JSON.parse(existingIds) : []; } catch { /* corrupted storage */ }
    if (!sessionIds.includes(sessionId)) {
      sessionIds.push(sessionId);
      await readyStorage.setItem(storageKeys.sessionIds, JSON.stringify(sessionIds));
    }
  }, [getReadyStorage, storageKeys.activeSessionId, storageKeys.sessionIds]);

  // Refs so the cold-boot restore can plant session state without widening its
  // dependency array (mirrors the existing ref pattern above).
  const setActiveSessionIdRef = useRef(setActiveSessionId);
  setActiveSessionIdRef.current = setActiveSessionId;
  const loginSuccessRef = useRef(loginSuccess);
  loginSuccessRef.current = loginSuccess;
  const onAuthStateChangeRef = useRef(onAuthStateChange);
  onAuthStateChangeRef.current = onAuthStateChange;

  // Cold-boot session restore via the secure refresh cookie (web only).
  //
  // On a hard reload the in-app, bearer-protected token fetch
  // (`getTokenBySession` → `/session/token/:id`) 401s because there is no token
  // in memory yet, which previously cleared the session and bounced the user to
  // sign-in. Instead we call `POST {apiBaseUrl}/auth/refresh` with
  // `credentials: 'include'` and NO Authorization header: the browser
  // automatically attaches the first-party httpOnly `oxy_rt` cookie (set at
  // login/signup/fedcm-exchange), the server validates + rotates it and returns
  // a fresh session access token. JS never sees the refresh cookie (httpOnly) —
  // that is the security property.
  //
  // Returns `true` when the session was restored (caller short-circuits the
  // bearer path); `false` on 401 / no durable cookie / any failure (caller
  // proceeds unauthenticated through the existing flow — nothing is cleared).
  const restoreViaRefreshCookie = useCallback(async (): Promise<boolean> => {
    if (!isWebBrowser()) {
      return false;
    }

    const apiBaseUrl = oxyServices.getBaseURL();
    if (!apiBaseUrl) {
      return false;
    }

    let response: Response;
    try {
      // Direct credentialed, no-auth POST. We deliberately bypass the SDK's
      // HttpService here: it would attach the (absent) bearer and does not send
      // cookies. The refresh cookie is scoped to `Path=/auth/refresh` and sent
      // automatically same-site.
      response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch (fetchError) {
      // Offline / network error — fall through to the cached/stored-session flow.
      if (__DEV__) {
        loggerUtil.debug('Refresh-cookie restore network error (expected when offline)', { component: 'OxyContext', method: 'restoreViaRefreshCookie' }, fetchError as unknown);
      }
      return false;
    }

    // 401 (no/expired/reused cookie) and any non-2xx → no durable session.
    if (!response.ok) {
      return false;
    }

    let payload: RefreshCookieResponse;
    try {
      payload = (await response.json()) as RefreshCookieResponse;
    } catch {
      return false;
    }

    const accessToken = payload.accessToken;
    if (!accessToken) {
      return false;
    }

    // Recover the session id from the (server-signed) access-token claims, or
    // from the response body if the server included it. Decode-only; the server
    // already verified the signature.
    const claims = decodeAccessTokenClaims(accessToken);
    const sessionId = payload.sessionId ?? claims?.sessionId;
    if (!sessionId) {
      // A token with no resolvable session id cannot drive multi-session state.
      return false;
    }

    // Plant the fresh access token. The refresh token stays in the httpOnly
    // cookie and is never touched by JS.
    oxyServices.httpService.setTokens(accessToken);

    // Fetch the full user with the freshly planted token.
    let fullUser: User;
    try {
      fullUser = await oxyServices.getCurrentUser();
    } catch (userError) {
      // Token planted but profile fetch failed (e.g. transient network). Do not
      // claim a restored session; fall through so the stored-session flow can
      // retry. Leave the planted token in place — it is valid and harmless.
      if (__DEV__) {
        loggerUtil.debug('Refresh-cookie restore: getCurrentUser failed', { component: 'OxyContext', method: 'restoreViaRefreshCookie' }, userError as unknown);
      }
      return false;
    }

    const userId = fullUser.id?.toString() ?? claims?.userId ?? '';
    const now = new Date();
    const clientSession: ClientSession = {
      sessionId,
      deviceId: '',
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      lastActive: now.toISOString(),
      userId,
      isCurrent: true,
    };

    // Restore the active session into the multi-session store (merge: keep any
    // other sessions intact) and durably persist BEFORE notifying listeners.
    updateSessionsRef.current([clientSession], { merge: true });
    setActiveSessionIdRef.current(sessionId);
    await persistSessionDurably(sessionId);

    loginSuccessRef.current(fullUser);
    onAuthStateChangeRef.current?.(fullUser);
    return true;
  }, [oxyServices, persistSessionDurably]);

  const restoreSessionsFromStorage = useCallback(async (): Promise<void> => {
    if (!storage) {
      return;
    }

    setTokenReady(false);

    try {
      // Web cold-boot fast path: restore the active session from the secure
      // httpOnly refresh cookie before the bearer-protected stored-session
      // validation (which 401s on a hard reload). On success we are signed in
      // from the cookie alone — no FedCM needed. On failure we fall through to
      // the existing stored-session flow below; nothing is cleared.
      if (await restoreViaRefreshCookie()) {
        return;
      }

      const storedSessionIdsJson = await storage.getItem(storageKeys.sessionIds);
      const storedSessionIds: string[] = storedSessionIdsJson ? JSON.parse(storedSessionIdsJson) : [];
      const storedActiveSessionId = await storage.getItem(storageKeys.activeSessionId);

      let validSessions: ClientSession[] = [];

      if (storedSessionIds.length > 0) {
        // Validate all sessions in parallel (with 8s timeout per session) to avoid
        // sequential blocking that freezes the app on startup
        const VALIDATION_TIMEOUT = 8000;
        const results = await Promise.allSettled(
          storedSessionIds.map(async (sessionId) => {
            const timeoutPromise = new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), VALIDATION_TIMEOUT),
            );
            const validationPromise = oxyServices
              .validateSession(sessionId, { useHeaderValidation: true })
              .catch((validationError: unknown) => {
                if (!isInvalidSessionError(validationError) && !isTimeoutOrNetworkError(validationError)) {
                  logger('Session validation failed during init', validationError);
                } else if (__DEV__ && isTimeoutOrNetworkError(validationError)) {
                  loggerUtil.debug('Session validation timeout (expected when offline)', { component: 'OxyContext', method: 'restoreSessionsFromStorage' }, validationError as unknown);
                }
                return null;
              });

            return Promise.race([validationPromise, timeoutPromise]).then((validation) => {
              if (validation?.valid && validation.user) {
                const now = new Date();
                return {
                  sessionId,
                  deviceId: '',
                  expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                  lastActive: now.toISOString(),
                  userId: validation.user.id?.toString() ?? '',
                  isCurrent: sessionId === storedActiveSessionId,
                } as ClientSession;
              }
              return null;
            });
          }),
        );

        validSessions = results
          .filter((r): r is PromiseFulfilledResult<ClientSession | null> => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter((s): s is ClientSession => s !== null);

        // Always persist validated sessions to storage (even empty list)
        // to clear stale/expired session IDs that would cause 401 loops on restart
        updateSessionsRef.current(validSessions, { merge: false });
      }

      if (storedActiveSessionId) {
        try {
          await switchSessionRef.current(storedActiveSessionId);
        } catch (switchError) {
          // Silently handle expected errors (invalid sessions, timeouts, network issues)
          if (isInvalidSessionError(switchError)) {
            await storage.removeItem(storageKeys.activeSessionId);
            updateSessionsRef.current(
              validSessions.filter((session) => session.sessionId !== storedActiveSessionId),
              { merge: false },
            );
            // Don't log expected session errors during restoration
          } else if (isTimeoutOrNetworkError(switchError)) {
            // Timeout/network error - non-critical, don't block
            if (__DEV__) {
              loggerUtil.debug('Active session validation timeout (expected when offline)', { component: 'OxyContext', method: 'restoreSessionsFromStorage' }, switchError as unknown);
            }
          } else {
            // Only log unexpected errors
            logger('Active session validation error', switchError);
          }
        }
      }
    } catch (error) {
      if (__DEV__) {
        loggerUtil.error('Auth init error', error instanceof Error ? error : new Error(String(error)), { component: 'OxyContext', method: 'restoreSessionsFromStorage' });
      }
      await clearSessionStateRef.current();
    } finally {
      setTokenReady(true);
    }
  }, [
    logger,
    oxyServices,
    storage,
    storageKeys.activeSessionId,
    storageKeys.sessionIds,
    restoreViaRefreshCookie,
  ]);

  useEffect(() => {
    if (!storage || initialized) {
      return;
    }

    setInitialized(true);
    restoreSessionsFromStorage().catch((error) => {
      if (__DEV__) {
        logger('Failed to restore sessions from storage', error);
      }
    });
  }, [restoreSessionsFromStorage, storage, initialized, logger]);

  // Web SSO: Automatically check for cross-domain session on web platforms
  // Also used for popup auth - updates all state and persists session
  const handleWebSSOSession = useCallback(async (session: SessionLoginResponse) => {
    if (!session?.user || !session?.sessionId) {
      if (__DEV__) {
        loggerUtil.warn('handleWebSSOSession: Invalid session', { component: 'OxyContext' });
      }
      return;
    }

    // Set the access token on the HTTP client before updating UI state
    if (session.accessToken) {
      oxyServices.httpService.setTokens(session.accessToken);
    } else {
      await oxyServices.getTokenBySession(session.sessionId);
    }

    const clientSession = {
      sessionId: session.sessionId,
      deviceId: session.deviceId || '',
      expiresAt: session.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      lastActive: new Date().toISOString(),
      userId: session.user.id?.toString() ?? '',
      isCurrent: true,
    };

    updateSessions([clientSession], { merge: true });
    setActiveSessionId(session.sessionId);

    // Persist to storage BEFORE fetching the profile and BEFORE notifying the
    // auth-state-change callback. The token is planted and the in-memory store
    // is updated above; durably committing the session id here — ahead of
    // `getCurrentUser()` / `loginSuccess` / `onAuthStateChange` — is critical
    // because `onAuthStateChange` triggers a route navigation that can
    // interrupt/supersede a still-pending async write. Persisting first
    // guarantees the durable record lands; that is exactly what was missing
    // when `oxy_session_session_ids` came back empty after a successful FedCM
    // sign-in (the user appeared logged in until reload, then had no session to
    // restore). `persistSessionDurably` awaits the READY storage instance rather
    // than reading the possibly-null `storage` state, so a sign-in fired the
    // instant the screen mounts (before storage-init populates state) is not
    // silently dropped.
    await persistSessionDurably(session.sessionId);

    // Fetch the full user profile now that we have a valid access token and the
    // session is durably persisted. The session only carries MinimalUserData;
    // the store and callbacks expect a full User. The navigation kicked off by
    // `onAuthStateChange` now happens only after the durable write is committed.
    let fullUser: User;
    try {
      fullUser = await oxyServices.getCurrentUser();
    } catch {
      // If the profile fetch fails, fall back to the minimal data from the session
      // so the user is still logged in (the store accepts User, but the shapes overlap at runtime).
      fullUser = session.user as unknown as User;
    }
    loginSuccess(fullUser);
    onAuthStateChange?.(fullUser);
  }, [oxyServices, updateSessions, setActiveSessionId, loginSuccess, onAuthStateChange, persistSessionDurably]);

  // Enable web SSO only after local storage check completes and no user found
  const shouldTryWebSSO = isWebBrowser() && tokenReady && !user && initialized;

  useWebSSO({
    oxyServices,
    onSessionFound: handleWebSSOSession,
    onError: (error) => {
      if (__DEV__) {
        loggerUtil.debug('Web SSO check failed (non-critical)', { component: 'OxyContext' }, error);
      }
    },
    enabled: shouldTryWebSSO,
  });

  // IdP session validation via lightweight iframe check
  // When user returns to tab, verify auth.oxy.so still has their session
  // If session is gone (cleared/logged out), clear local session too
  const lastIdPCheckRef = useRef<number>(0);
  const pendingIdPCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isWebBrowser() || !user || !initialized) return;

    const checkIdPSession = () => {
      // Debounce: check at most once per 30 seconds
      const now = Date.now();
      if (now - lastIdPCheckRef.current < 30000) return;
      lastIdPCheckRef.current = now;

      // Clean up any in-flight check before starting a new one
      pendingIdPCleanupRef.current?.();

      // Load hidden iframe to check IdP session via postMessage
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'display:none;width:0;height:0;border:0';
      const idpOrigin = authWebUrl || 'https://auth.oxy.so';
      iframe.src = `${idpOrigin}/auth/session-check?client_id=${encodeURIComponent(window.location.origin)}`;

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        window.removeEventListener('message', handleMessage);
        iframe.remove();
      };

      const handleMessage = async (event: MessageEvent) => {
        if (event.origin !== idpOrigin) return;
        if (event.data?.type !== 'oxy-session-check') return;
        cleanup();

        if (!event.data.hasSession) {
          toast.info('Your session has ended. Please sign in again.');
          await clearSessionState();
        }
      };

      window.addEventListener('message', handleMessage);
      document.body.appendChild(iframe);
      setTimeout(cleanup, 5000); // Timeout after 5s
      pendingIdPCleanupRef.current = cleanup;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkIdPSession();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      pendingIdPCleanupRef.current?.();
      pendingIdPCleanupRef.current = null;
    };
  }, [user, initialized, clearSessionState, authWebUrl]);

  const activeSession = activeSessionId
    ? sessions.find((session) => session.sessionId === activeSessionId)
    : undefined;
  const currentDeviceId = activeSession?.deviceId ?? null;

  const userId = user?.id;

  const refreshSessionsWithUser = useCallback(
    () => refreshSessions(userId),
    [refreshSessions, userId],
  );

  const handleSessionRemoved = useCallback(
    (sessionId: string) => {
      trackRemovedSession(sessionId);
    },
    [trackRemovedSession],
  );

  const handleRemoteSignOut = useCallback(() => {
    toast.info('You have been signed out remotely.');
    logout().catch((remoteError) => logger('Failed to process remote sign out', remoteError));
  }, [logger, logout]);

  useSessionSocket({
    userId,
    activeSessionId,
    currentDeviceId,
    refreshSessions: refreshSessionsWithUser,
    clearSessionState,
    baseURL: oxyServices.getBaseURL(),
    getAccessToken: () => oxyServices.getAccessToken(),
    onRemoteSignOut: handleRemoteSignOut,
    onSessionRemoved: handleSessionRemoved,
  });

  const switchSessionForContext = useCallback(
    async (sessionId: string): Promise<void> => {
      await switchSession(sessionId);
    },
    [switchSession],
  );

  // Identity management wrappers (delegate to KeyManager)
  const hasIdentity = useCallback(async (): Promise<boolean> => {
    return KeyManager.hasIdentity();
  }, []);

  const getPublicKey = useCallback(async (): Promise<string | null> => {
    return KeyManager.getPublicKey();
  }, []);

  // Create showBottomSheet function that uses the global function
  const showBottomSheetForContext = useCallback(
    (screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> }) => {
      globalShowBottomSheet(screenOrConfig);
    },
    [],
  );

  // Avatar picker extracted into dedicated hook
  const { openAvatarPicker } = useAvatarPicker({
    oxyServices,
    currentLanguage,
    activeSessionId,
    queryClient,
    showBottomSheet: showBottomSheetForContext,
  });

  // --- Managed accounts state ---
  const [actingAs, setActingAsState] = useState<string | null>(null);
  const [managedAccounts, setManagedAccounts] = useState<ManagedAccount[]>([]);

  // Restore actingAs from storage on startup
  useEffect(() => {
    if (!storage || !initialized) return;
    let mounted = true;
    (async () => {
      try {
        const stored = await storage.getItem(`${storageKeyPrefix}_acting_as`);
        if (mounted && stored) {
          setActingAsState(stored);
          oxyServices.setActingAs(stored);
        }
      } catch (err) {
        if (__DEV__) {
          loggerUtil.debug('Failed to restore actingAs from storage', { component: 'OxyContext' }, err as unknown);
        }
      }
    })();
    return () => { mounted = false; };
  }, [storage, initialized, storageKeyPrefix, oxyServices]);

  // Load managed accounts when authenticated
  const refreshManagedAccounts = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) return;
    try {
      const accounts = await oxyServices.getManagedAccounts();
      setManagedAccounts(accounts);
    } catch (err) {
      if (__DEV__) {
        loggerUtil.debug('Failed to load managed accounts', { component: 'OxyContext' }, err as unknown);
      }
    }
  }, [isAuthenticated, oxyServices]);

  useEffect(() => {
    if (isAuthenticated && initialized && tokenReady) {
      refreshManagedAccounts();
    }
  }, [isAuthenticated, initialized, tokenReady, refreshManagedAccounts]);

  const setActingAs = useCallback((userId: string | null) => {
    oxyServices.setActingAs(userId);
    setActingAsState(userId);
    // Persist to storage
    if (storage) {
      if (userId) {
        storage.setItem(`${storageKeyPrefix}_acting_as`, userId).catch(() => {});
      } else {
        storage.removeItem(`${storageKeyPrefix}_acting_as`).catch(() => {});
      }
    }
  }, [oxyServices, storage, storageKeyPrefix]);

  const createManagedAccountFn = useCallback(async (data: CreateManagedAccountInput): Promise<ManagedAccount> => {
    const account = await oxyServices.createManagedAccount(data);
    await refreshManagedAccounts();
    return account;
  }, [oxyServices, refreshManagedAccounts]);

  const contextValue: OxyContextState = useMemo(() => ({
    user,
    sessions,
    activeSessionId,
    isAuthenticated,
    isLoading,
    isTokenReady: tokenReady,
    isStorageReady: storage !== null,
    error,
    currentLanguage,
    currentLanguageMetadata,
    currentLanguageName,
    currentNativeLanguageName,
    hasIdentity,
    getPublicKey,
    signIn,
    handlePopupSession: handleWebSSOSession,
    logout,
    logoutAll,
    switchSession: switchSessionForContext,
    removeSession: logout,
    refreshSessions: refreshSessionsWithUser,
    setLanguage,
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,
    clearSessionState,
    clearAllAccountData,
    storageKeyPrefix,
    oxyServices,
    useFollow: useFollowHook,
    showBottomSheet: showBottomSheetForContext,
    openAvatarPicker,
    actingAs,
    managedAccounts,
    setActingAs,
    refreshManagedAccounts,
    createManagedAccount: createManagedAccountFn,
  }), [
    activeSessionId,
    signIn,
    handleWebSSOSession,
    currentLanguage,
    currentLanguageMetadata,
    currentLanguageName,
    currentNativeLanguageName,
    error,
    getDeviceSessions,
    getPublicKey,
    hasIdentity,
    isAuthenticated,
    isLoading,
    logout,
    logoutAll,
    logoutAllDeviceSessions,
    oxyServices,
    storageKeyPrefix,
    refreshSessionsWithUser,
    sessions,
    setLanguage,
    storage,
    switchSessionForContext,
    tokenReady,
    updateDeviceName,
    clearAllAccountData,
    useFollowHook,
    user,
    showBottomSheetForContext,
    openAvatarPicker,
    actingAs,
    managedAccounts,
    setActingAs,
    refreshManagedAccounts,
    createManagedAccountFn,
  ]);

  return (
    <OxyContext.Provider value={contextValue}>
      {children}
    </OxyContext.Provider>
  );
};

export const OxyContextProvider = OxyProvider;

/**
 * Loading-state stub used when `useOxy()` is called outside an OxyProvider.
 * All async methods reject with a clear error so misuse is caught early
 * instead of silently no-oping and leaving the UI in a bad state.
 */
const PROVIDER_MISSING_ERROR_MESSAGE =
  'OxyProvider is not mounted. Wrap your app in <OxyProvider> before calling useOxy() methods.';

const rejectMissingProvider = <T,>(): Promise<T> =>
  Promise.reject(new Error(PROVIDER_MISSING_ERROR_MESSAGE));

// A stub OxyServices instance so the public type contract is preserved.
// Calling network methods on it before a provider mounts will fail with
// a descriptive baseURL — preferable to a null-pointer crash at the call site.
const LOADING_STATE_OXY_SERVICES = new OxyServices({
  baseURL: 'about:blank',
});

const LOADING_STATE: OxyContextState = {
  user: null,
  sessions: [],
  activeSessionId: null,
  isAuthenticated: false,
  isLoading: true,
  isTokenReady: false,
  isStorageReady: false,
  error: null,
  currentLanguage: 'en',
  currentLanguageMetadata: null,
  currentLanguageName: 'English',
  currentNativeLanguageName: 'English',
  hasIdentity: () => Promise.resolve(false),
  getPublicKey: () => Promise.resolve(null),
  signIn: () => rejectMissingProvider<User>(),
  handlePopupSession: () => rejectMissingProvider<void>(),
  logout: () => rejectMissingProvider<void>(),
  logoutAll: () => rejectMissingProvider<void>(),
  switchSession: () => rejectMissingProvider<void>(),
  removeSession: () => rejectMissingProvider<void>(),
  refreshSessions: () => rejectMissingProvider<void>(),
  setLanguage: () => rejectMissingProvider<void>(),
  getDeviceSessions: () => Promise.resolve([]),
  logoutAllDeviceSessions: () => rejectMissingProvider<void>(),
  updateDeviceName: () => rejectMissingProvider<void>(),
  clearSessionState: () => rejectMissingProvider<void>(),
  clearAllAccountData: () => rejectMissingProvider<void>(),
  storageKeyPrefix: 'oxy_session',
  oxyServices: LOADING_STATE_OXY_SERVICES,
  openAvatarPicker: () => {},
  actingAs: null,
  managedAccounts: [],
  setActingAs: () => {},
  refreshManagedAccounts: () => rejectMissingProvider<void>(),
  createManagedAccount: () => rejectMissingProvider<ManagedAccount>(),
};

export const useOxy = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    return LOADING_STATE;
  }
  return context;
};

export default OxyContext;

