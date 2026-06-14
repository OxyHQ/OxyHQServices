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
import {
  runColdBoot,
  resolveCentralAuthUrl,
  autoDetectAuthWebUrl,
  SSO_CALLBACK_PATH,
  ssoStateKey,
  ssoGuardKey,
  ssoDestKey,
  ssoNoSessionKey,
  ssoAttemptedKey,
  isCentralIdPOrigin,
  guardActive,
  ssoNavigate,
  buildSsoBounceUrl,
  consumeSsoReturn,
} from '@oxyhq/core';
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
import { readActiveAuthuser, writeActiveAuthuser } from '../utils/activeAuthuser';
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

// Active-authuser persistence helpers (web localStorage; native no-op) live in
// `../utils/activeAuthuser` so the session-management and auth-operations hooks
// can share them without re-importing this 1k-line context file.

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

/**
 * Module-level run-once guard for the cold-boot `fedcm-silent` step.
 *
 * The FedCM silent step triggers a one-shot `navigator.credentials.get`
 * handshake that must fire AT MOST ONCE per page load — otherwise a provider
 * remount storm (route churn, StrictMode double-invoke, error-boundary
 * recovery) becomes a credential request storm. A per-instance ref resets on
 * every remount, so the guard must live at module scope. Keyed on
 * `origin|baseURL` so two providers pointed at the same API from the same
 * origin share one attempt; never cleared because only a fresh page load can
 * change the central IdP session state, and a fresh page load starts a fresh
 * module scope.
 *
 * This is a dedicated set — distinct from `useWebSSO`'s `silentSSOAttempted`
 * (which guards the post-boot INTERACTIVE button path) and never a core
 * module-level singleton (that re-evaluates under Metro web bundling and the
 * guard would not hold).
 */
const servicesSilentAttempted = new Set<string>();

/**
 * Build the `origin|baseURL` signature used as the silent-cold-boot guard key.
 */
function silentColdBootKey(oxyServices: OxyServices): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'no-origin';
  let baseURL = '';
  try {
    baseURL = oxyServices.getBaseURL?.() ?? '';
  } catch {
    baseURL = '';
  }
  return `${origin}|${baseURL}`;
}

/**
 * Whether `idpOrigin` is a same-site, first-party host of the current page —
 * i.e. it shares the page's registrable apex (last two labels), so a "no
 * session" answer from its `/auth/session-check` iframe is authoritative for
 * THIS app and may force a local sign-out.
 *
 * On a cross-site IdP (or any host whose relationship to the page can't be
 * positively established) this returns `false`, so the visibility-driven check
 * may surface a session-ended toast but MUST NOT clear local state — a
 * third-party / undetermined IdP answer can never force logout. Returns `false`
 * off-browser.
 */
function isSameSiteIdP(idpOrigin: string): boolean {
  if (typeof window === 'undefined') return false;
  let idpHostname: string;
  try {
    idpHostname = new URL(idpOrigin).hostname;
  } catch {
    return false;
  }
  const pageHostname = window.location.hostname;
  if (!idpHostname || !pageHostname) return false;
  if (idpHostname === pageHostname) return true;
  const apexOf = (hostname: string): string => hostname.split('.').slice(-2).join('.');
  const pageApex = apexOf(pageHostname);
  // Require a real registrable apex (≥2 labels) AND an exact apex match AND that
  // the IdP host is the page apex itself or a subdomain of it.
  if (pageHostname.split('.').length < 2) return false;
  if (apexOf(idpHostname) !== pageApex) return false;
  return idpHostname === pageApex || idpHostname.endsWith(`.${pageApex}`);
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
      // Target the CENTRAL IdP for TRUE cross-domain SSO. Every RP
      // (mention.earth, homiio.com, alia.onl, …) delegates to the one central
      // `auth.oxy.so` — it owns the host-only `fedcm_session` cookie and the
      // central session store reached via `api.oxy.so`, so a single sign-in
      // there is observed by all RPs through the opaque-code `/sso` bounce.
      // `resolveCentralAuthUrl(authWebUrl)` returns the explicit `authWebUrl`
      // prop when provided (explicit always wins) and the central default
      // otherwise. This is NOT per-apex auto-detection — central SSO is
      // deliberately central. A consumer-provided `OxyServices` instance is
      // never mutated; only the baseURL-only construction path applies this.
      oxyServicesRef.current = new OxyServices({
        baseURL,
        authWebUrl: resolveCentralAuthUrl(authWebUrl),
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
      loggerUtil.warn(message, { component: 'OxyContext' }, err);
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

  // `handleWebSSOSession` is declared further down (it depends on values that
  // are only available there). The FedCM/iframe cold-boot steps need to commit
  // a recovered session through it, so we route the call through a ref that is
  // populated once the callback exists. The ref is assigned synchronously on
  // every render before the cold-boot effect can fire (the effect is gated on
  // `storage` + `initialized`, both of which settle after first render).
  const handleWebSSOSessionRef = useRef<((session: SessionLoginResponse) => Promise<void>) | null>(null);

  // Cold-boot session restore via the secure refresh cookies (web only).
  //
  // Calls `oxyServices.refreshAllSessions()` → `POST /auth/refresh-all` with
  // `credentials: 'include'`. The server rotates every device-local
  // `oxy_rt_${authuser}` cookie in parallel and returns one entry per valid
  // account (Google-style multi-account). On an older server that lacks the
  // multi-account endpoint, the SDK transparently falls back to the legacy
  // `/auth/refresh` single-account path and wraps the result in the same
  // shape, so this caller doesn't branch.
  //
  // Active-account selection: the persisted `oxy_active_authuser` slot index
  // wins when it matches a returned account; otherwise the lowest `authuser`
  // is picked. JS never sees the refresh cookies (httpOnly).
  //
  // Returns `true` when at least one session was restored (caller short-
  // circuits the bearer path); `false` on no signed-in accounts / any failure
  // (caller proceeds unauthenticated through the existing flow — nothing is
  // cleared).
  const restoreViaRefreshCookie = useCallback(async (): Promise<boolean> => {
    if (!isWebBrowser()) {
      return false;
    }

    let snapshot;
    try {
      snapshot = await oxyServices.refreshAllSessions();
    } catch (fetchError) {
      // Offline / network error — fall through to the cached/stored-session flow.
      if (__DEV__) {
        loggerUtil.debug('Refresh-all cookie restore network error (expected when offline)', { component: 'OxyContext', method: 'restoreViaRefreshCookie' }, fetchError as unknown);
      }
      return false;
    }

    if (snapshot.accounts.length === 0) {
      return false;
    }

    // Pick the active account: persisted authuser if it still matches a returned
    // account, otherwise the lowest authuser (deterministic). The server has
    // already sorted ascending so [0] is the lowest.
    const persistedAuthuser = readActiveAuthuser();
    const matched = persistedAuthuser !== null
      ? snapshot.accounts.find((a) => a.authuser === persistedAuthuser)
      : undefined;
    const activeAccount = matched ?? snapshot.accounts[0];

    // Plant the active access token. Sibling accounts' access tokens stay in
    // the snapshot (the chooser can drive a per-account refresh via
    // `refreshTokenViaCookie({authuser})` on switch).
    oxyServices.httpService.setTokens(activeAccount.accessToken);

    // Fetch the full user with the freshly planted token. The refresh-all
    // payload includes a minimal user shape (id, username, name, avatar,
    // email, color) — sufficient for the chooser but the auth store wants the
    // canonical User document for downstream rendering.
    let fullUser: User;
    try {
      fullUser = await oxyServices.getCurrentUser();
    } catch (userError) {
      // Token planted but profile fetch failed (e.g. transient network). Do
      // not claim a restored session; fall through so the stored-session flow
      // can retry. Leave the planted token in place — it is valid and harmless.
      if (__DEV__) {
        loggerUtil.debug('Refresh-all cookie restore: getCurrentUser failed', { component: 'OxyContext', method: 'restoreViaRefreshCookie' }, userError as unknown);
      }
      return false;
    }

    // Build a ClientSession per returned account so the multi-session store
    // reflects every device-local slot, not just the active one. The active
    // account is flagged `isCurrent: true`.
    const now = new Date();
    const clientSessions: ClientSession[] = snapshot.accounts.map((account) => ({
      sessionId: account.sessionId,
      deviceId: '',
      expiresAt: account.expiresAt || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      lastActive: now.toISOString(),
      userId: account.user?.id,
      isCurrent: account.sessionId === activeAccount.sessionId,
      authuser: account.authuser,
    }));

    updateSessionsRef.current(clientSessions, { merge: true });
    setActiveSessionIdRef.current(activeAccount.sessionId);
    writeActiveAuthuser(activeAccount.authuser);
    await persistSessionDurably(activeAccount.sessionId);

    loginSuccessRef.current(fullUser);
    onAuthStateChangeRef.current?.(fullUser);
    return true;
  }, [oxyServices, persistSessionDurably]);

  // Native (and offline) stored-session restore — the ONLY restore path that
  // runs on React Native, and the web fallback when no cross-domain step won.
  //
  // Verbatim-extracted from the previous `restoreSessionsFromStorage` body: it
  // reads the durable `session_ids` / `active_session_id` slots, validates each
  // stored session in parallel (bearer `validateSession`), and switches to the
  // stored active session via the session-management `switchSession`. This body
  // is platform-agnostic and gated by NO `enabled()` predicate so it runs on
  // every platform — on native it is reached unconditionally (every web-only
  // step ahead of it is disabled by `isWebBrowser()`), so native restore is
  // exactly this and nothing else (no FedCM / iframe / refresh-all /
  // handleAuthCallback).
  const restoreStoredSession = useCallback(async (): Promise<boolean> => {
    if (!storage) {
      return false;
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
                loggerUtil.debug('Session validation timeout (expected when offline)', { component: 'OxyContext', method: 'restoreStoredSession' }, validationError as unknown);
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
        return true;
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
            loggerUtil.debug('Active session validation timeout (expected when offline)', { component: 'OxyContext', method: 'restoreStoredSession' }, switchError as unknown);
          }
        } else {
          // Only log unexpected errors
          logger('Active session validation error', switchError);
        }
      }
    }

    return false;
  }, [
    logger,
    oxyServices,
    storage,
    storageKeys.activeSessionId,
    storageKeys.sessionIds,
  ]);

  // Shared in-flight `runSsoReturn` promise — see the CONCURRENCY note on
  // `runSsoReturn` below. Lets the eager interception effect and the cold-boot
  // `sso-return` step share one `consumeSsoReturn` invocation race-free.
  const inFlightSsoReturnRef = useRef<Promise<boolean> | null>(null);

  // Central cross-domain SSO return handler (web). A THIN wrapper over core's
  // `consumeSsoReturn`, which performs the entire security-critical kernel —
  // parse the IdP redirect fragment, validate the CSRF `state`, strip the
  // fragment FIRST, exchange the opaque single-use code, restore the user's
  // pre-bounce destination (same-origin only), and set the per-origin
  // NO_SESSION loop breaker on every non-ok outcome — and RETURNS the exchanged
  // session (or `null`) WITHOUT committing. We preserve services' contract by
  // committing the returned session here via `handleWebSSOSession`. Shared by
  // the `sso-return` cold-boot step AND the bfcache `pageshow` re-evaluation, so
  // the same kernel runs exactly once per delivered fragment regardless of how
  // the page was (re)shown.
  //
  // Returns `true` when a session was committed (caller short-circuits), `false`
  // otherwise. Off-browser `consumeSsoReturn` is a no-op returning `null`, so
  // this returns `false` (native never reaches it).
  //
  // CONCURRENCY: the eager SSO-callback interception effect and the cold-boot
  // `sso-return` step can both invoke this in the same tick when we land on the
  // callback path. `consumeSsoReturn` strips the fragment FIRST, so a naive
  // second invocation would parse an already-stripped URL and return `null` —
  // leaving the losing caller with no session (and on an `ok` outcome could let
  // the terminal bounce fire spuriously). The FIRST call's promise is memoised in
  // `inFlightSsoReturnRef` and SHARED with every concurrent caller, so the single
  // `consumeSsoReturn` invocation — and its single commit via `handleWebSSOSession`
  // — is delivered identically to both paths. Cleared once it settles so a later,
  // genuinely-separate return (e.g. a bfcache restore) runs a fresh pass.
  const runSsoReturn = useCallback((): Promise<boolean> => {
    if (inFlightSsoReturnRef.current) {
      return inFlightSsoReturnRef.current;
    }
    const inFlight = consumeSsoReturn(oxyServices, {
      isWeb: isWebBrowser,
      onExchangeError: (error) => {
        if (__DEV__) {
          loggerUtil.debug(
            'SSO code exchange failed (treating as no session)',
            { component: 'OxyContext', method: 'runSsoReturn' },
            error,
          );
        }
      },
    })
      .then(async (session): Promise<boolean> => {
        if (!session) {
          return false;
        }
        const commitWebSession = handleWebSSOSessionRef.current;
        if (!commitWebSession) {
          return false;
        }
        await commitWebSession(session);
        return true;
      })
      .finally(() => {
        inFlightSsoReturnRef.current = null;
      });
    inFlightSsoReturnRef.current = inFlight;
    return inFlight;
  }, [oxyServices]);

  // Cold boot — the single, ordered, short-circuit session-recovery sequence,
  // consuming the SAME `runColdBoot` core primitive as `WebOxyProvider`. The
  // FIRST step that yields a session wins; every later step is skipped. Each
  // web-only step is gated by `isWebBrowser()`, so on native ONLY
  // `stored-session` runs.
  //
  // Order (web): redirect callback → SSO return → FedCM silent (central) →
  // silent iframe (per-apex, the durable reload path) → cookie restore →
  // stored session → SSO bounce (terminal). The per-apex silent iframe is what
  // restores a durable cross-domain session on reload WITHOUT a top-level
  // bounce, so when it wins `sso-bounce` never fires (no flash, no loop).
  // Order (native): stored session only (every web-only step is disabled
  // off-browser).
  const restoreSessionsFromStorage = useCallback(async (): Promise<void> => {
    if (!storage) {
      return;
    }

    setTokenReady(false);

    const commitWebSession = handleWebSSOSessionRef.current;
    const silentKey = silentColdBootKey(oxyServices);
    const fedcmSupported = isWebBrowser() && oxyServices.isFedCMSupported?.() === true;

    try {
      const outcome = await runColdBoot<true>({
        steps: [
          {
            // 0) Redirect callback wins: a popup/redirect sign-in just landed
            // back on this page with `access_token`/`session_id` query params.
            // `handleAuthCallback` plants the token but returns a PLACEHOLDER
            // user (empty id), so we hydrate the REAL user via `getCurrentUser`
            // and commit through `handleWebSSOSession` before claiming a
            // session — never expose a placeholder user (R4).
            id: 'redirect',
            enabled: () => isWebBrowser(),
            run: async () => {
              const callbackSession = oxyServices.handleAuthCallback?.();
              if (!callbackSession || !commitWebSession) {
                return { kind: 'skip' };
              }
              const fullUser = await oxyServices.getCurrentUser();
              await commitWebSession({ ...callbackSession, user: fullUser });
              return { kind: 'session', session: true };
            },
          },
          {
            // 1) Central SSO return: we are landing back from an `auth.oxy.so/sso`
            // bounce with the result in the URL fragment. Parse it, validate the
            // CSRF state, exchange the opaque code, and commit. On any non-ok
            // outcome `runSsoReturn` sets the per-origin NO_SESSION flag so the
            // terminal `sso-bounce` step is disabled — the loop breaker.
            id: 'sso-return',
            enabled: () => isWebBrowser(),
            run: async () => {
              const committed = await runSsoReturn();
              return committed ? { kind: 'session', session: true } : { kind: 'skip' };
            },
          },
          {
            // 2) FedCM silent reauthn (Chrome) against the CENTRAL IdP
            // (auth.oxy.so). `silentSignInWithFedCM` plants the access token
            // internally; we commit the returned session via
            // `handleWebSSOSession`. Guarded so it fires at most once per page
            // load across remounts. This is an enhancement layered above the
            // opaque-code bounce: when it succeeds the bounce never fires.
            id: 'fedcm-silent',
            enabled: () => fedcmSupported && !servicesSilentAttempted.has(silentKey),
            run: async () => {
              servicesSilentAttempted.add(silentKey);
              const session = await oxyServices.silentSignInWithFedCM?.();
              if (!session || !commitWebSession) {
                return { kind: 'skip' };
              }
              await commitWebSession(session);
              return { kind: 'session', session: true };
            },
          },
          {
            // 3) First-party silent iframe at the PER-APEX IdP — the DURABLE
            // cross-domain reload-restore path. The durable session lives as a
            // first-party `fedcm_session` cookie on `auth.<rp-apex>` (e.g.
            // `auth.mention.earth`), established during the `/sso` bounce's
            // `/sso/establish` hop. That host is SAME-SITE to the RP page, so
            // the cookie is first-party under Safari ITP / Firefox TCP — and
            // an iframe read is NOT a top-level navigation, so it restores on
            // reload with NO flash and works in a backgrounded tab. This is the
            // step that prevents the re-bounce loop: when it finds a session,
            // the terminal `sso-bounce` never fires.
            //
            // The instance is configured with `authWebUrl=auth.oxy.so` (central,
            // for the bounce + FedCM), so we explicitly point the iframe at the
            // per-apex host via `autoDetectAuthWebUrl()` and `silentSignIn`'s
            // `authWebUrlOverride`. On a `*.oxy.so` RP the per-apex host IS the
            // central host (`auth.oxy.so`), so this is a same-host no-op-
            // equivalent. When auto-detection bails (localhost/IP/single-label)
            // there is no per-apex IdP and the step skips. Web only; on native
            // `isWebBrowser()` gates it off, so native never runs an iframe.
            id: 'silent-iframe',
            enabled: () => isWebBrowser(),
            run: async () => {
              const perApexAuthUrl = autoDetectAuthWebUrl();
              if (!perApexAuthUrl || !commitWebSession) {
                return { kind: 'skip' };
              }
              const session = await oxyServices.silentSignIn?.({
                authWebUrlOverride: perApexAuthUrl,
              });
              if (!session?.user || !session?.sessionId) {
                return { kind: 'skip' };
              }
              await commitWebSession(session);
              return { kind: 'session', session: true };
            },
          },
          {
            // 4) Refresh-cookie restore (first-party only). On `*.oxy.so` the
            // httpOnly `oxy_rt_${n}` cookies ride along and resurrect every
            // device-local slot. On a cross-domain RP (mention.earth, …) the
            // cookie is `Domain=oxy.so` so it never reaches `api.<apex>` —
            // `refreshAllSessions` returns `{accounts:[]}` and this skips. That
            // is correct; cross-domain restore is handled by the SSO bounce.
            id: 'cookie-restore',
            enabled: () => isWebBrowser(),
            run: async () => {
              const restored = await restoreViaRefreshCookie();
              return restored ? { kind: 'session', session: true } : { kind: 'skip' };
            },
          },
          {
            // 5) Stored-session bearer restore. NO `enabled` gate — runs on ALL
            // platforms. This is native's ONLY restore path (every web-only step
            // is disabled off-browser, so native reaches exactly this).
            id: 'stored-session',
            run: async () => {
              const restored = await restoreStoredSession();
              return restored ? { kind: 'session', session: true } : { kind: 'skip' };
            },
          },
          {
            // 6) SSO bounce (TERMINAL, web only, at most once). No local session
            // was found by any step above. Top-level navigate to the central
            // `auth.oxy.so/sso?prompt=none` so the IdP can either mint a session
            // (returning an opaque code we exchange on the callback) or report
            // `none`. This step tears the document down on success — its `skip`
            // result is only observed if `assign` no-ops. Disabled on the IdP
            // itself, once the NO_SESSION flag is set, or while a bounce guard is
            // still active (loop + self-heal protection).
            id: 'sso-bounce',
            enabled: () => {
              if (!isWebBrowser() || window.top !== window.self) {
                return false;
              }
              const origin = window.location.origin;
              if (isCentralIdPOrigin(origin)) {
                return false;
              }
              if (window.sessionStorage.getItem(ssoNoSessionKey(origin)) === '1') {
                return false;
              }
              if (window.sessionStorage.getItem(ssoAttemptedKey(origin)) === '1') {
                return false;
              }
              if (guardActive(window.sessionStorage, origin, Date.now())) {
                return false;
              }
              return true;
            },
            run: async () => {
              const origin = window.location.origin;
              const state = oxyServices.generateSsoState();
              window.sessionStorage.setItem(ssoStateKey(origin), state);
              window.sessionStorage.setItem(ssoGuardKey(origin), String(Date.now()));
              window.sessionStorage.setItem(ssoDestKey(origin), window.location.href);
              // OUTCOME-INDEPENDENT once-guard: mark the probe attempted the instant we
              // commit to the bounce, so even if the callback never lands cleanly no
              // second bounce can ever fire this tab (the definitive loop breaker).
              window.sessionStorage.setItem(ssoAttemptedKey(origin), '1');

              const url = buildSsoBounceUrl(origin, state, oxyServices.config?.authWebUrl);

              // TERMINAL: the document is torn down by this navigation. The
              // `skip` below is only reached if `assign` is a no-op (e.g. the
              // navigation is blocked); in that case we fall through
              // unauthenticated, which is correct.
              ssoNavigate(url);
              return { kind: 'skip' };
            },
          },
        ],
        onStepError: (id, error) => {
          if (__DEV__) {
            loggerUtil.debug(
              `Cold-boot step "${id}" errored (non-fatal, falling through)`,
              { component: 'OxyContext', method: 'restoreSessionsFromStorage' },
              error,
            );
          }
        },
      });

      if (__DEV__ && outcome.kind === 'session') {
        loggerUtil.debug(
          `Cold boot recovered a session via "${outcome.via}"`,
          { component: 'OxyContext', method: 'restoreSessionsFromStorage' },
        );
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
    oxyServices,
    storage,
    restoreViaRefreshCookie,
    restoreStoredSession,
    runSsoReturn,
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

  // bfcache re-evaluation (web only, registered once). When a page is restored
  // from the back/forward cache (`e.persisted`) NO cold boot re-runs — React
  // state is resurrected as-is — yet the page may have been frozen mid-bounce
  // and resurrected ON the SSO callback with a fresh fragment in the URL. Re-run
  // the `sso-return` parse so the opaque code is still exchanged (and the
  // fragment stripped + NO_SESSION flag maintained) on a bfcache restore. Routed
  // through a ref so the listener registers exactly once and never churns with
  // `runSsoReturn`'s identity.
  const runSsoReturnRef = useRef(runSsoReturn);
  runSsoReturnRef.current = runSsoReturn;

  useEffect(() => {
    if (!isWebBrowser()) {
      return;
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        return;
      }
      runSsoReturnRef.current().catch((error) => {
        if (__DEV__) {
          loggerUtil.debug(
            'bfcache SSO return re-evaluation failed (non-fatal)',
            { component: 'OxyContext', method: 'onPageShow' },
            error,
          );
        }
      });
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // EAGER, universal SSO-callback interception (web only, once on mount).
  //
  // When the central IdP redirects the RP back to the internal callback path
  // ({@link SSO_CALLBACK_PATH}), the app's own router would otherwise mount on
  // `/__oxy/sso-callback` — a route NO app declares — and briefly flash its
  // +not-found screen before the storage-gated cold-boot `sso-return` step gets
  // a chance to strip the fragment and restore the real destination.
  //
  // This effect fires the SAME `runSsoReturn` kernel the instant we mount ON the
  // callback path, BEFORE the cold boot (which awaits storage init). It restores
  // the pre-bounce destination (and, on `ok`, commits the exchanged session via
  // `handleWebSSOSession`) immediately, so the router re-syncs off the callback
  // path and never lingers on it. Because the SDK owns this interception
  // entirely, NO app needs a `/__oxy/sso-callback` route — it works identically
  // across every consumer with zero per-app code.
  //
  // It is purely ADDITIVE. The later cold-boot `sso-return` step stays as
  // defense-in-depth for the non-callback-path case; `consumeSsoReturn` strips
  // the fragment first, so once this eager pass has run the cold-boot step is a
  // harmless idempotent no-op (a second parse of the now-fragment-less URL
  // returns `null`). The path guard scopes this strictly to the callback path,
  // so a normal page load is untouched. Routed through `runSsoReturnRef` (the
  // SAME ref the bfcache handler uses) so deps stay `[]` and it registers once.
  //
  // Timing: `handleWebSSOSessionRef.current` is assigned SYNCHRONOUSLY during
  // render (see below, around the `handleWebSSOSession` declaration), and effects
  // run only after the render commits, so on an `ok` outcome the commit path is
  // already wired when this fires at eager-mount time. If for any reason it were
  // not yet set, the later cold-boot `sso-return` step would commit it — but the
  // ref IS set during render, so the eager `ok` commit works.
  useEffect(() => {
    if (!isWebBrowser()) {
      return;
    }
    if (window.location.pathname !== SSO_CALLBACK_PATH) {
      return;
    }
    runSsoReturnRef.current().catch((error) => {
      if (__DEV__) {
        loggerUtil.debug(
          'Eager SSO callback interception failed (non-fatal)',
          { component: 'OxyContext', method: 'eagerSsoCallbackIntercept' },
          error,
        );
      }
    });
  }, []);

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

  // Expose `handleWebSSOSession` to the cold-boot FedCM/iframe/redirect steps,
  // which reference it through a ref because they are declared above this
  // callback. Assigned synchronously on every render so the ref is populated
  // before the cold-boot effect (gated on `storage`/`initialized`) can fire.
  handleWebSSOSessionRef.current = handleWebSSOSession;

  // Cross-domain silent SSO is now owned by the `fedcm-silent` / `silent-iframe`
  // cold-boot steps above (the ordered `runColdBoot` sequence). `useWebSSO`
  // remains mounted for its module-level run-once guard and its interactive
  // FedCM helpers, and as a bounded post-boot safety net: it can fire at most
  // once per page load (its own module guard), and only AFTER cold boot has
  // finished (`tokenReady`) with no user recovered. We deliberately keep
  // `shouldTryWebSSO` as `tokenReady && !user && initialized` — it is NOT
  // loosened; cold boot runs while `tokenReady` is false, so this never races
  // the cold-boot silent step.
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

  // Use the RESOLVED IdP origin (the auto-detected `auth.<rp-apex>` planted on
  // the instance config), not the raw `authWebUrl` prop — on a cross-domain RP
  // the prop is undefined but the instance was constructed with the detected
  // value, so the check must target the same first-party IdP the cold-boot
  // iframe used.
  const resolvedAuthWebUrl = oxyServices.config?.authWebUrl;

  useEffect(() => {
    if (!isWebBrowser() || !user || !initialized) return;

    const idpOrigin = resolvedAuthWebUrl || 'https://auth.oxy.so';

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
          // Only a SAME-SITE, first-party IdP answer is authoritative enough to
          // force a local sign-out. On a cross-site / undetermined IdP the
          // "no session" answer must never clear local state (a third-party
          // can't be trusted to end this app's session). Surface the toast in
          // both cases, but gate the destructive `clearSessionState()`.
          if (isSameSiteIdP(idpOrigin)) {
            toast.info('Your session has ended. Please sign in again.');
            await clearSessionState();
          }
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
  }, [user, initialized, clearSessionState, resolvedAuthWebUrl]);

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

