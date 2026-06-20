import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
import { buildSilentGuardKey } from '../../utils/silentGuardKey';

export interface OxyContextState {
  user: User | null;
  sessions: ClientSession[];
  activeSessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isTokenReady: boolean;
  hasAccessToken: boolean;
  canUsePrivateApi: boolean;
  isPrivateApiPending: boolean;
  /**
   * Whether the initial auth determination has concluded.
   *
   * `false` from mount until the FIRST cold-boot session restore finishes —
   * during that window `isAuthenticated: false` is UNDETERMINED, not a
   * definitive "logged out". Flips to `true` exactly once the restore concludes
   * (a session was committed OR none exists) and never reverts. Consumers should
   * defer their first auth-dependent fetch until this is `true` so a cold-boot
   * web reload with an existing session does not fetch anonymous data.
   *
   * On native, cold boot runs only the `stored-session` step, so this resolves
   * promptly. It is set in the restore `finally`, so the success, no-session,
   * and error paths all reach `true` — it can never get stuck `false`.
   */
  isAuthResolved: boolean;
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
   * Handle a session returned by web SSO.
   * Updates auth state, persists session metadata to storage.
   */
  handleWebSession: (session: SessionLoginResponse) => Promise<void>;

  // Session management
  logout: (targetSessionId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<User>;
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
  /**
   * The app's Oxy OAuth client id / ApplicationCredential publicKey, as
   * supplied via the `clientId` prop. Required for the cross-app device
   * sign-in flow: the sign-in components send it to
   * `POST /auth/session/create` so the API can identify the requesting app by
   * its real registered client id (the consent identity is then resolved
   * server-side and shown by the central auth web). `null` when the consuming
   * app did not configure a client id — the device sign-in flow surfaces a
   * configuration error in that case.
   */
  clientId: string | null;
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
  /**
   * The app's Oxy OAuth client id / ApplicationCredential publicKey; required
   * for the cross-app device sign-in flow. See {@link OxyContextState.clientId}.
   */
  clientId?: string;
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
  // `buildSilentGuardKey` reads `window.location.origin` behind a guard that
  // also verifies `window.location` exists. This is critical: it runs
  // UNCONDITIONALLY at the top of `restoreSessionsFromStorage` (before the
  // cold-boot try/catch) on EVERY platform, and React Native aliases a global
  // `window` with NO `window.location`. Without that guard the read threw
  // `Cannot read property 'origin' of undefined` on native, escaping the
  // restore path so `markAuthResolved` never ran and stored-session restore was
  // never reached.
  return buildSilentGuardKey(() => oxyServices.getBaseURL?.());
}

/**
 * Per-step fail-fast budget for the cold-boot silent iframe (`silentSignIn`
 * against the per-apex `/auth/silent` host).
 *
 * This step ONLY succeeds when a durable per-apex `fedcm_session` cookie exists
 * (established by a prior `/sso` bounce). On the common reload of a logged-out
 * tab — or a tab that restores via the now-earlier stored-session step — the
 * iframe never posts a message, so the full wait would be dead latency in front
 * of the terminal `/sso` bounce. `silentSignIn` already fails fast on a load
 * error via `iframe.onerror`; this caps the no-message case. 2.5s is well above
 * a same-origin iframe handshake without blocking cold boot for several seconds.
 */
const SILENT_IFRAME_TIMEOUT = 2500;

/**
 * Per-step fail-fast budget for the cold-boot refresh-cookie restore
 * (`refreshAllSessions`).
 *
 * On a cross-domain RP the `Domain=oxy.so` refresh cookie never reaches
 * `api.<apex>`, so this request returns no accounts (or stalls behind a slow
 * endpoint) with no useful answer. As one cold-boot step it must not block the
 * fall-through to the terminal `/sso` bounce. 3s bounds the wait while leaving
 * ample headroom for a genuine first-party `*.oxy.so` rotation round-trip.
 */
const COOKIE_RESTORE_TIMEOUT = 3000;

/**
 * HARD overall deadline (ms) for the entire cold-boot step loop —
 * defense-in-depth so a single non-settling step can NEVER hang auth resolution
 * forever (the production regression: a `navigator.credentials.get()` that
 * ignored its abort signal left the `fedcm-silent` step's promise unsettled, so
 * `runColdBoot` never advanced to the terminal `/sso` bounce and auth hung
 * indefinitely).
 *
 * Every step ALREADY bounds its own network work (the stored-session bearer
 * validation at 8s, the silent iframe at `SILENT_IFRAME_TIMEOUT`, the refresh
 * cookie at `COOKIE_RESTORE_TIMEOUT`, FedCM silent at `FEDCM_SILENT_TIMEOUT`
 * plus its hard settle). On a healthy load the FIRST recovering step wins in a
 * single round-trip (1–3s) and the chain short-circuits long before this fires.
 * This budget only trips when one of those per-step bounds regresses.
 *
 * 20s is the chosen value: comfortably ABOVE the worst-case bounded
 * stored-session path under transient slowness (the 8s parallel validation
 * window plus a `switchSession` round-trip) so a genuinely slow-but-healthy
 * reload is never cut off, yet well BELOW the ~28–30s the previous
 * probe-first ordering took — and, critically, finite, so the user can never
 * sit on an indefinite spinner. When the deadline trips, `runColdBoot` keeps
 * iterating to the terminal `sso-bounce` step (whose navigation side effect
 * runs synchronously), so a genuine no-local-session first visit STILL reaches
 * the cross-domain `/sso` fallback. Native runs only the stored-session step,
 * which is bounded well under this, so the deadline never alters native flow.
 */
const COLD_BOOT_OVERALL_DEADLINE = 20000;

/**
 * Per-session timeout (ms) for the parallel stored-session validation in
 * `restoreStoredSession`. Each `validateSession` call races against this timer
 * so a single slow/offline session never blocks the whole startup validation
 * sweep — sessions that don't answer in time resolve to `null` (treated as
 * unvalidated) and the remaining sessions still settle.
 */
const VALIDATION_TIMEOUT = 8000;

/**
 * Fallback client-session validity window (ms) — 7 days — applied when a
 * restored account/session does not carry an explicit `expiresAt`. This is only
 * a local display/bookkeeping hint for the multi-session store; the server
 * remains the source of truth for actual session expiry. Used in the refresh
 * cookie restore, stored-session restore, and web-SSO session paths.
 */
const DEFAULT_SESSION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimum interval (ms) between visibility-driven IdP `/auth/session-check`
 * probes. Debounces the hidden-iframe session check so rapid tab focus/blur
 * cycles can't spawn a check-iframe storm; at most one probe runs per window.
 */
const IDP_SESSION_CHECK_COOLDOWN = 30000;

/**
 * Hard timeout (ms) for a single visibility-driven IdP `/auth/session-check`
 * iframe. If the IdP never posts a `oxy-session-check` message back, the iframe
 * and its listener are torn down after this budget so a non-responsive check
 * can never leak an iframe or a `message` listener.
 */
const IDP_SESSION_CHECK_TIMEOUT = 5000;

function getHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  if ('status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }

  if ('response' in error) {
    const response = (error as { response?: unknown }).response;
    if (response && typeof response === 'object' && 'status' in response) {
      const status = (response as { status?: unknown }).status;
      if (typeof status === 'number') {
        return status;
      }
    }
  }

  return undefined;
}

function isUnauthorizedStatus(error: unknown): boolean {
  return getHttpStatus(error) === 401;
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
  // Native defines a global `window` but no `window.location`; guard the
  // latter so reading `.hostname` can never throw off-browser. (Only reachable
  // from the web-only visibility check, but kept robust for parity.)
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return false;
  }
  let idpHostname: string;
  try {
    idpHostname = new URL(idpOrigin).hostname;
  } catch (parseError) {
    if (__DEV__) {
      loggerUtil.debug('Invalid IdP origin while checking same-site session status', { component: 'OxyContext' }, parseError as unknown);
    }
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

function isOnSsoCallbackPath(): boolean {
  return isWebBrowser() && window.location.pathname === SSO_CALLBACK_PATH;
}

const useBrowserLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

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
  clientId: clientIdProp,
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
  const [hasAccessToken, setHasAccessToken] = useState(() => Boolean(oxyServices.getAccessToken()));
  // Whether the FIRST cold-boot auth restore has concluded. Starts `false`
  // (auth undetermined) and flips to `true` exactly once — monotonic, never
  // reverts. It now flips the MOMENT a session commits (the common reload case
  // unblocks immediately, without waiting for the rest of the cold-boot chain),
  // with the restore `finally` as the no-session/error backstop. The ref makes
  // the flip idempotent across both sites so the setters fire at most once. See
  // `isAuthResolved` on the context type for the consumer contract.
  const [authResolved, setAuthResolved] = useState(false);
  const authResolvedRef = useRef(false);
  const userRef = useRef<User | null>(user);
  const isAuthenticatedRef = useRef(isAuthenticated);
  userRef.current = user;
  isAuthenticatedRef.current = isAuthenticated;
  const [initialized, setInitialized] = useState(false);
  const [ssoCallbackIntercepting, setSsoCallbackIntercepting] = useState(false);
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
  // pattern), `oxyServices === oxyClient`, so we skip the redundant self-write.
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

  // The app's Oxy OAuth client id surfaced on the context so the cross-app
  // device sign-in components (SignInModal / OxyAuthScreen) can identify the
  // requesting app to `POST /auth/session/create`. Normalized to a trimmed
  // non-empty string, or `null` when the consumer did not configure one — the
  // sign-in components surface a clear configuration error in that case rather
  // than falling back to any display string.
  const clientId = useMemo(() => {
    const trimmed = clientIdProp?.trim();
    return trimmed ? trimmed : null;
  }, [clientIdProp]);

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
  const clearingInvalidTokenRef = useRef(false);

  useEffect(() => {
    const handleTokenChange = (accessToken: string | null) => {
      setHasAccessToken(Boolean(accessToken));
      if (accessToken) {
        setTokenReady(true);
        return;
      }

      if (userRef.current || isAuthenticatedRef.current) {
        setTokenReady(false);
        if (clearingInvalidTokenRef.current) {
          return;
        }
        clearingInvalidTokenRef.current = true;
        clearSessionStateRef.current()
          .catch((clearError) => {
            logger('Failed to clear invalidated auth session', clearError);
          })
          .finally(() => {
            clearingInvalidTokenRef.current = false;
            if (authResolvedRef.current) {
              setTokenReady(true);
            }
          });
        return;
      }

      if (authResolvedRef.current) {
        setTokenReady(true);
      }
    };

    handleTokenChange(oxyServices.getAccessToken());
    return oxyServices.onTokensChanged(handleTokenChange);
  }, [logger, oxyServices]);

  // Durable, navigation-safe session persistence.
  //
  // Writes the active-session id and appends the session id to the durable
  // `session_ids` list, awaiting the READY storage instance (never the possibly
  // -null `storage` state) so a write is never dropped because it raced storage
  // init. Callers MUST invoke this BEFORE any work that can trigger a route
  // navigation (`onAuthStateChange`) — navigation can interrupt a still-pending
  // async write, which is exactly what once left `session_ids` empty after a
    // successful sign-in. Shared by the FedCM/SSO path and the cold-boot
  // refresh-cookie restore so both land the same durable record.
  const persistSessionDurably = useCallback(async (sessionId: string): Promise<void> => {
    const readyStorage = await getReadyStorage();
    await readyStorage.setItem(storageKeys.activeSessionId, sessionId);
    const existingIds = await readyStorage.getItem(storageKeys.sessionIds);
    let sessionIds: string[] = [];
    try {
      sessionIds = existingIds ? JSON.parse(existingIds) : [];
    } catch (parseError) {
      logger('Failed to parse persisted session ids; replacing corrupted storage value', parseError);
    }
    if (!sessionIds.includes(sessionId)) {
      sessionIds.push(sessionId);
      await readyStorage.setItem(storageKeys.sessionIds, JSON.stringify(sessionIds));
    }
  }, [getReadyStorage, logger, storageKeys.activeSessionId, storageKeys.sessionIds]);

  // Refs so the cold-boot restore can plant session state without widening its
  // dependency array (mirrors the existing ref pattern above).
  const setActiveSessionIdRef = useRef(setActiveSessionId);
  setActiveSessionIdRef.current = setActiveSessionId;
  const loginSuccessRef = useRef(loginSuccess);
  loginSuccessRef.current = loginSuccess;
  const onAuthStateChangeRef = useRef(onAuthStateChange);
  onAuthStateChangeRef.current = onAuthStateChange;

  // Flip the auth-resolution gate (`authResolved` + `tokenReady`) the MOMENT a
  // session commits, instead of waiting for the whole cold-boot chain to finish.
  // Idempotent and monotonic via `authResolvedRef`: the first call wins and the
  // setters fire at most once, so the restore `finally` backstop becomes a no-op
  // once a commit site has already marked resolution. Called from EVERY place a
  // user is actually committed (the FedCM/iframe/SSO path
  // `handleWebSSOSession`, the cookie-restore path, and the stored-session path)
  // so the common reload case unblocks the loading gate without sitting behind
  // the remaining (now-skipped) cold-boot steps.
  const markAuthResolved = useCallback(() => {
    if (authResolvedRef.current) {
      return;
    }
    authResolvedRef.current = true;
    setTokenReady(true);
    setAuthResolved(true);
  }, []);
  const markAuthResolvedRef = useRef(markAuthResolved);
  markAuthResolvedRef.current = markAuthResolved;

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
  // account (Google-style multi-account).
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
      // Bound the refresh so a cross-domain/stalled call cannot hang the cold
      // boot in front of the terminal `/sso` bounce (see COOKIE_RESTORE_TIMEOUT).
      snapshot = await oxyServices.refreshAllSessions({ timeout: COOKIE_RESTORE_TIMEOUT });
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
      expiresAt: account.expiresAt || new Date(now.getTime() + DEFAULT_SESSION_VALIDITY_MS).toISOString(),
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
    // A session is now committed — unblock the auth-resolution gate immediately
    // rather than waiting for `runColdBoot` to return (idempotent).
    markAuthResolvedRef.current();
    onAuthStateChangeRef.current?.(fullUser);
    return true;
  }, [oxyServices, persistSessionDurably]);

  // Native (and offline) stored-session restore — the ONLY restore path that
  // runs on React Native, and the web fallback when no cross-domain step won.
  //
  // Stored-session restore. Web uses this only as a fast local winner after
  // URL-return handling; native uses it as the durable SecureStore path. Native
  // first plants the shared access token from KeyManager, then validates the
  // stored session ids with the bearer already in memory.
  const restoreStoredSession = useCallback(async (): Promise<boolean> => {
    if (!storage) {
      return false;
    }

    const storedSessionIdsJson = await storage.getItem(storageKeys.sessionIds);
    const storedSessionIdsFromStorage: string[] = storedSessionIdsJson ? JSON.parse(storedSessionIdsJson) : [];
    let storedActiveSessionId = await storage.getItem(storageKeys.activeSessionId);
    const storedActiveAuthuser = isWebBrowser() ? readActiveAuthuser() : null;

    if (isWebBrowser() && !oxyServices.getAccessToken() && (storedActiveSessionId === null || storedActiveAuthuser === null)) {
      return false;
    }

    const nativeSharedSession = !isWebBrowser()
      ? await KeyManager.getSharedSession().catch(() => null)
      : null;
    if (nativeSharedSession?.accessToken) {
      oxyServices.setTokens(nativeSharedSession.accessToken);
      storedActiveSessionId = storedActiveSessionId ?? nativeSharedSession.sessionId;
    }

    const storedSessionIds = Array.from(new Set([
      ...storedSessionIdsFromStorage,
      ...(nativeSharedSession?.sessionId ? [nativeSharedSession.sessionId] : []),
    ]));

    let validSessions: ClientSession[] = [];

    if (storedSessionIds.length > 0) {
      // Validate all sessions in parallel (with a per-session timeout) to avoid
      // sequential blocking that freezes the app on startup
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
              const clientSession: ClientSession = {
                sessionId,
                deviceId: '',
                expiresAt: new Date(now.getTime() + DEFAULT_SESSION_VALIDITY_MS).toISOString(),
                lastActive: now.toISOString(),
                userId: validation.user.id?.toString() ?? '',
                isCurrent: sessionId === storedActiveSessionId,
              };
              if (isWebBrowser() && sessionId === storedActiveSessionId && storedActiveAuthuser !== null) {
                clientSession.authuser = storedActiveAuthuser;
              }
              return clientSession;
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
        // The stored session is committed (this is native's ONLY restore path
        // and the common web reload winner). Unblock the auth-resolution gate
        // immediately so the loading screen clears without waiting for the
        // remaining cold-boot steps to be evaluated/short-circuited (idempotent).
        markAuthResolvedRef.current();
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
  // Order (web): SSO return → stored session → FedCM silent
  // (central) → silent iframe (per-apex, the durable reload path) → cookie
  // restore → SSO bounce (terminal).
  //
  // LATENCY (FIX A): `stored-session` runs BEFORE the slow no-redirect probes
  // (`fedcm-silent`, `silent-iframe`, `cookie-restore`). On a normal reload the
  // local bearer validates in one round-trip and wins, so `runColdBoot`
  // short-circuits and never sits through those probes' timeouts (the prior
  // serial sum was a ~20-30s stall). `sso-return` MUST stay first — it consumes
  // the URL fragment before anything can strip it. On a
  // first visit with no local session, `stored-session` skips and the
  // cross-domain fallback chain (fedcm → iframe → cookie → sso-bounce) runs
  // exactly as before; the per-apex silent iframe still restores a durable
  // cross-domain session on reload WITHOUT a top-level bounce, so when it wins
  // `sso-bounce` never fires (no flash, no loop).
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

    // FIX-B precondition flag: set true the instant the (now-earlier)
    // `stored-session` step recovers a local bearer session. The slow web-only
    // probes (`fedcm-silent`, `silent-iframe`) AND `enabled` on `!storedSessionRestored`
    // so they are explicitly skipped once a local session won. `runColdBoot`
    // already short-circuits on the first `{kind:'session'}`, so on a winning
    // reload those `enabled` bodies are never even reached — this flag makes the
    // intent explicit and is redundant-safe. On a first-visit-no-local-session,
    // `stored-session` skips, this stays false, and the probes run as before.
    let storedSessionRestored = false;

    try {
      const outcome = await runColdBoot<true>({
        steps: [
          {
            // 0) Central SSO return: we are landing back from an `auth.oxy.so/sso`
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
            // 2) Stored-session bearer restore. NO `enabled` gate — runs on ALL
            // platforms. This is native's ONLY restore path (every web-only step
            // is disabled off-browser, so native reaches exactly this) AND the
            // common WEB reload winner.
            //
            // ORDERING (FIX A): this step now runs BEFORE the slow web-only
            // probes (`fedcm-silent`, `silent-iframe`, `cookie-restore`). On a
            // normal reload the local bearer validates in one round-trip and
            // wins; `runColdBoot` then short-circuits and never even evaluates
            // the slow no-redirect probes that would otherwise time out (the
            // ~20-30s serial stall). The `sso-return` step stays AHEAD of this
            // one — it must consume the URL fragment before any
            // later step (or anything else) strips it. On a first visit with no
            // local session this step skips and the cross-domain fallback chain
            // (fedcm → iframe → cookie → sso-bounce) runs exactly as before.
            id: 'stored-session',
            run: async () => {
              const restored = await restoreStoredSession();
              if (restored) {
                // FIX-B: record the win so the slow probes below explicitly skip
                // (belt-and-suspenders; `runColdBoot` already short-circuits).
                storedSessionRestored = true;
                return { kind: 'session', session: true };
              }
              return { kind: 'skip' };
            },
          },
          {
            // 3) FedCM silent reauthn (Chrome) against the CENTRAL IdP
            // (auth.oxy.so). `silentSignInWithFedCM` plants the access token
            // internally; we commit the returned session via
            // `handleWebSSOSession`. Guarded so it fires at most once per page
            // load across remounts. This is an enhancement layered above the
            // opaque-code bounce: when it succeeds the bounce never fires.
            //
            // FIX-B: additionally skipped when the earlier `stored-session` step
            // already recovered a local session — the probe cannot improve on a
            // valid local bearer, and skipping it avoids the silent round-trip.
            id: 'fedcm-silent',
            enabled: () =>
              !storedSessionRestored && fedcmSupported && !servicesSilentAttempted.has(silentKey),
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
            // 4) First-party silent iframe at the PER-APEX IdP — the DURABLE
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
            //
            // FIX-B: additionally skipped when `stored-session` already won.
            // FIX-D: bounded by `SILENT_IFRAME_TIMEOUT` (plus `iframe.onerror`
            // fail-fast in core) so a no-message iframe cannot stall cold boot.
            id: 'silent-iframe',
            enabled: () => !storedSessionRestored && isWebBrowser(),
            run: async () => {
              const perApexAuthUrl = autoDetectAuthWebUrl();
              if (!perApexAuthUrl || !commitWebSession) {
                return { kind: 'skip' };
              }
              const session = await oxyServices.silentSignIn?.({
                authWebUrlOverride: perApexAuthUrl,
                timeout: SILENT_IFRAME_TIMEOUT,
              });
              if (!session?.user || !session?.sessionId) {
                return { kind: 'skip' };
              }
              await commitWebSession(session);
              return { kind: 'session', session: true };
            },
          },
          {
            // 5) Refresh-cookie restore (first-party only). On `*.oxy.so` the
            // httpOnly `oxy_rt_${n}` cookies ride along and resurrect every
            // device-local slot. On a cross-domain RP (mention.earth, …) the
            // cookie is `Domain=oxy.so` so it never reaches `api.<apex>` —
            // `refreshAllSessions` returns `{accounts:[]}` and this skips. That
            // is correct; cross-domain restore is handled by the SSO bounce.
            // FIX-D: `restoreViaRefreshCookie` bounds the request with
            // `COOKIE_RESTORE_TIMEOUT` so a cross-domain stall cannot hang here.
            id: 'cookie-restore',
            enabled: () => isWebBrowser(),
            run: async () => {
              const restored = await restoreViaRefreshCookie();
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
        // Defense-in-depth: a single step whose promise never settles (the
        // production FedCM-silent hang) can no longer block the chain forever.
        // On expiry the runner keeps iterating to the terminal `sso-bounce`
        // step so a genuine no-local-session visit still reaches the
        // cross-domain `/sso` fallback; the `finally` backstop flips
        // `authResolved` regardless. See `COLD_BOOT_OVERALL_DEADLINE`.
        overallDeadlineMs: COLD_BOOT_OVERALL_DEADLINE,
        onStepDeadline: (id) => {
          if (__DEV__) {
            loggerUtil.debug(
              `Cold-boot step "${id}" exceeded the overall deadline (abandoned, falling through)`,
              { component: 'OxyContext', method: 'restoreSessionsFromStorage' },
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
      // Backstop: mark auth resolved on EVERY exit path — success, no-session,
      // AND error→catch→finally — and on native (which only runs the
      // `stored-session` step), so the gate can never hang `false`. Idempotent
      // via `markAuthResolved`'s ref: when a commit site already flipped it
      // mid-chain (the common reload case), this is a no-op. When no session was
      // recovered (the unauthenticated/error path), this is where `tokenReady` +
      // `authResolved` finally flip. Monotonic — never reverts on later restores.
      markAuthResolved();
    }
  }, [
    oxyServices,
    storage,
    restoreViaRefreshCookie,
    restoreStoredSession,
    runSsoReturn,
    markAuthResolved,
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
  // This effect fires the SAME `runSsoReturn` kernel the instant we hydrate ON
  // the callback path, BEFORE the cold boot (which awaits storage init). The
  // first render intentionally matches the app/router's static HTML; the
  // browser layout effect then hides the internal route and consumes the
  // callback before the first visible paint. That keeps SSR/SSG hydration stable
  // while still ensuring no app needs a `/__oxy/sso-callback` route.
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
  useBrowserLayoutEffect(() => {
    if (!isOnSsoCallbackPath()) {
      setSsoCallbackIntercepting(false);
      return;
    }
    let mounted = true;
    setSsoCallbackIntercepting(true);
    runSsoReturnRef.current().catch((error) => {
      if (__DEV__) {
        loggerUtil.debug(
          'Eager SSO callback interception failed (non-fatal)',
          { component: 'OxyContext', method: 'eagerSsoCallbackIntercept' },
          error,
        );
      }
    }).finally(() => {
      if (mounted) {
        setSsoCallbackIntercepting(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Web SSO: automatically check for cross-domain session on web platforms.
  // Updates all state and persists session metadata.
  const handleWebSSOSession = useCallback(async (session: SessionLoginResponse) => {
    if (!session?.user || !session?.sessionId) {
      if (__DEV__) {
        loggerUtil.warn('handleWebSSOSession: Invalid session', { component: 'OxyContext' });
      }
      return;
    }

    if (!session.accessToken) {
      throw new Error('Session response did not include an access token');
    }
    oxyServices.httpService.setTokens(session.accessToken);

    const clientSession = {
      sessionId: session.sessionId,
      deviceId: session.deviceId || '',
      expiresAt: session.expiresAt || new Date(Date.now() + DEFAULT_SESSION_VALIDITY_MS).toISOString(),
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
    } catch (profileError) {
      if (__DEV__) {
        loggerUtil.debug('Failed to fetch full user after web session; using session user fallback', { component: 'OxyContext', method: 'handleWebSSOSession' }, profileError as unknown);
      }
      // If the profile fetch fails, fall back to the minimal data from the session
      // so the user is still logged in (the store accepts User, but the shapes overlap at runtime).
      fullUser = session.user as unknown as User;
    }
    loginSuccess(fullUser);
    // A session is now committed (FedCM silent / per-apex iframe /
    // SSO-return all funnel through here) — unblock the auth-resolution
    // gate immediately, ahead of the cold-boot chain returning (idempotent).
    markAuthResolvedRef.current();
    onAuthStateChange?.(fullUser);
  }, [oxyServices, updateSessions, setActiveSessionId, loginSuccess, onAuthStateChange, persistSessionDurably]);

  // Expose `handleWebSSOSession` to the cold-boot FedCM/iframe/SSO steps,
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
      // Debounce: check at most once per cooldown window
      const now = Date.now();
      if (now - lastIdPCheckRef.current < IDP_SESSION_CHECK_COOLDOWN) return;
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
      setTimeout(cleanup, IDP_SESSION_CHECK_TIMEOUT);
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
    async (sessionId: string): Promise<User> => {
      // Propagate the activated user so callers (the device-flow sign-in,
      // `useSwitchSession`'s cache write, account chooser) receive it. The
      // underlying session-management `switchSession` already resolves the
      // `User`; the previous `Promise<void>` wrapper discarded it.
      return switchSession(sessionId);
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
    if (!isAuthenticated || !tokenReady || !oxyServices.getAccessToken()) {
      setManagedAccounts([]);
      return;
    }

    try {
      const accounts = await oxyServices.getManagedAccounts();
      setManagedAccounts(accounts);
    } catch (err) {
      if (isUnauthorizedStatus(err)) {
        setManagedAccounts([]);
        await clearSessionStateRef.current();
        return;
      }
      if (__DEV__) {
        loggerUtil.debug('Failed to load managed accounts', { component: 'OxyContext' }, err as unknown);
      }
    }
  }, [isAuthenticated, oxyServices, tokenReady]);

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
        storage.setItem(`${storageKeyPrefix}_acting_as`, userId).catch((persistError) => {
          loggerUtil.debug('Failed to persist acting-as account', { component: 'OxyContext' }, persistError as unknown);
        });
      } else {
        storage.removeItem(`${storageKeyPrefix}_acting_as`).catch((persistError) => {
          loggerUtil.debug('Failed to clear acting-as account', { component: 'OxyContext' }, persistError as unknown);
        });
      }
    }
  }, [oxyServices, storage, storageKeyPrefix]);

  const createManagedAccountFn = useCallback(async (data: CreateManagedAccountInput): Promise<ManagedAccount> => {
    const account = await oxyServices.createManagedAccount(data);
    await refreshManagedAccounts();
    return account;
  }, [oxyServices, refreshManagedAccounts]);

  const canUsePrivateApi = authResolved && isAuthenticated && tokenReady && hasAccessToken;
  const isPrivateApiPending = !authResolved || (isAuthenticated && (!tokenReady || !hasAccessToken));

  const contextValue: OxyContextState = useMemo(() => ({
    user,
    sessions,
    activeSessionId,
    isAuthenticated,
    isLoading,
    isTokenReady: tokenReady,
    hasAccessToken,
    canUsePrivateApi,
    isPrivateApiPending,
    isAuthResolved: authResolved,
    isStorageReady: storage !== null,
    error,
    currentLanguage,
    currentLanguageMetadata,
    currentLanguageName,
    currentNativeLanguageName,
    hasIdentity,
    getPublicKey,
    signIn,
    handleWebSession: handleWebSSOSession,
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
    clientId,
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
    hasAccessToken,
    canUsePrivateApi,
    isPrivateApiPending,
    getPublicKey,
    hasIdentity,
    isAuthenticated,
    isLoading,
    logout,
    logoutAll,
    logoutAllDeviceSessions,
    oxyServices,
    storageKeyPrefix,
    clientId,
    refreshSessionsWithUser,
    sessions,
    setLanguage,
    storage,
    switchSessionForContext,
    tokenReady,
    hasAccessToken,
    canUsePrivateApi,
    isPrivateApiPending,
    authResolved,
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
      {ssoCallbackIntercepting ? null : children}
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
  hasAccessToken: false,
  canUsePrivateApi: false,
  isPrivateApiPending: true,
  isAuthResolved: false,
  isStorageReady: false,
  error: null,
  currentLanguage: 'en',
  currentLanguageMetadata: null,
  currentLanguageName: 'English',
  currentNativeLanguageName: 'English',
  hasIdentity: () => Promise.resolve(false),
  getPublicKey: () => Promise.resolve(null),
  signIn: () => rejectMissingProvider<User>(),
  handleWebSession: () => rejectMissingProvider<void>(),
  logout: () => rejectMissingProvider<void>(),
  logoutAll: () => rejectMissingProvider<void>(),
  switchSession: () => rejectMissingProvider<User>(),
  removeSession: () => rejectMissingProvider<void>(),
  refreshSessions: () => rejectMissingProvider<void>(),
  setLanguage: () => rejectMissingProvider<void>(),
  getDeviceSessions: () => Promise.resolve([]),
  logoutAllDeviceSessions: () => rejectMissingProvider<void>(),
  updateDeviceName: () => rejectMissingProvider<void>(),
  clearSessionState: () => rejectMissingProvider<void>(),
  clearAllAccountData: () => rejectMissingProvider<void>(),
  storageKeyPrefix: 'oxy_session',
  clientId: null,
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
