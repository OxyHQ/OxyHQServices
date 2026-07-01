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
import type { AccountNode, CreateAccountInput } from '@oxyhq/core';
import { KeyManager } from '@oxyhq/core';
import type { ClientSession } from '@oxyhq/core';
import {
  runColdBoot,
  resolveCentralAuthUrl,
  registrableApex,
  SSO_CALLBACK_PATH,
  ssoStateKey,
  ssoGuardKey,
  ssoDestKey,
  ssoNoSessionKey,
  ssoAttemptedKey,
  isCentralIdPOrigin,
  guardActive,
  allowSsoBounce,
  ssoNavigate,
  buildSsoBounceUrl,
  consumeSsoReturn,
} from '@oxyhq/core';
import { toast } from '@oxyhq/bloom';
import { useAuthStore, type AuthState } from '../stores/authStore';
import { useShallow } from 'zustand/react/shallow';
import type { UseFollowHook } from '../hooks/useFollow.types';
import { useLanguageManagement } from '../hooks/useLanguageManagement';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useAuthOperations, clearPriorSessionHintSafe } from './hooks/useAuthOperations';
import { useDeviceManagement } from '../hooks/useDeviceManagement';
import { getStorageKeys, createPlatformStorage, type StorageInterface } from '../utils/storageHelpers';
import { isInvalidSessionError, isTimeoutOrNetworkError } from '../utils/errorHandlers';
import {
  readActiveAuthuser,
  clearSignedOut,
  isSilentRestoreSuppressed,
  markSignedOut,
  clearSsoBounceState,
} from '../utils/activeAuthuser';
import type { RouteName } from '../navigation/routes';
import { showBottomSheet as globalShowBottomSheet } from '../navigation/bottomSheetManager';
import { useQueryClient } from '@tanstack/react-query';
import { clearQueryCache } from '../hooks/queryClient';
import { useAvatarPicker } from '../hooks/useAvatarPicker';
import { useAccountStore } from '../stores/accountStore';
import { logger as loggerUtil } from '@oxyhq/core';
import { useWebSSO, isWebBrowser } from '../hooks/useWebSSO';
import { buildSilentGuardKey } from '../../utils/silentGuardKey';
import { isCrossApexWeb, CrossApexDirectSignInError } from '../../utils/crossApex';
import { createInSessionRefreshHandler, startTokenRefreshScheduler } from './inSessionTokenRefresh';
import { mintSessionViaPerApexIframe } from './silentSessionRestore';
import {
  createSessionClient,
  deviceStateToClientSessions,
  activeSessionIdOf,
  activeUserOf,
  accountIdsOf,
} from '../session';

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
   * Sign in with a username/email + password.
   *
   * Commits a successful session into context state through the SAME path FedCM
   * / SSO use (so `isAuthenticated` / `user` update and the session is persisted
   * durably). Returns a discriminated result so the caller can branch on the
   * two-factor-required case — which creates NO session; the caller completes
   * the 2FA challenge with the returned `loginToken`.
   *
   * This is the keyless native sign-in path for the slimmed Accounts app, which
   * no longer holds a local cryptographic identity key.
   */
  signInWithPassword: (
    identifier: string,
    password: string,
    opts?: { deviceName?: string; deviceFingerprint?: string },
  ) => Promise<PasswordSignInResult>;

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

  // Unified account graph (self, owned orgs/projects/bots, accounts shared with
  // the caller). The cryptographic Commons/DID "identity" is a SEPARATE concept.
  //
  // UX concept: the user picks an account and the WHOLE app becomes that account
  // — a genuine, REAL-SESSION switch (`switchToAccount`), identical to switching
  // between device sign-ins. There is NO separate "active account" concept:
  // `user` IS the active account after a switch. The removed `X-Acting-As`
  // delegation header is gone entirely.
  /** Every account the caller can access — own personal root, owned, and shared — from `listAccounts()`. */
  accounts: AccountNode[];
  /**
   * Switch the active session INTO an account from the {@link accounts} graph
   * (a managed org/project/bot, or an account shared with the caller).
   *
   * Uniform with every other account switch: if the account is already on
   * this device's multi-account set, switches straight through the same
   * server-authoritative `SessionClient.switchAccount()` path {@link switchSession}
   * uses — no re-minting, no session churn. Only the FIRST switch into an
   * account mints+plants a REAL session via `oxyServices.switchToAccount` and
   * registers it into the device set (server-set httpOnly `oxy_rt_<authuser>`
   * cookie), so it survives reload / `refresh-all` and appears in the device
   * account list exactly like a device sign-in from then on. Either way,
   * afterwards `user` IS the target account, every request authenticates as
   * it, and the account graph + all React Query data are refreshed/invalidated.
   */
  switchToAccount: (accountId: string) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  createAccount: (data: CreateAccountInput) => Promise<AccountNode>;
}

const OxyContext = createContext<OxyContextState | null>(null);

/**
 * Result of {@link OxyContextState.signInWithPassword}.
 *
 * `'ok'` — the password was accepted and the resulting session has been
 * committed into context state (the SAME path FedCM / SSO sessions use), so
 * `isAuthenticated` / `user` are updated and the session is durably persisted;
 * the caller can proceed (e.g. navigate into the app).
 *
 * `'2fa_required'` — the account has two-factor auth enabled, so NO session was
 * created. The caller must complete the challenge with the returned short-lived
 * `loginToken` (`POST /security/2fa/verify-login`) before a session exists.
 */
export type PasswordSignInResult =
  | { status: 'ok' }
  | { status: '2fa_required'; loginToken: string };

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
 * Per-step fail-fast budget (ms) for the native shared-key cold-boot step
 * (`signInWithSharedIdentity`).
 *
 * That step does a challenge round-trip plus a verify against the shared
 * cross-app identity key; if the device holds no shared identity it returns
 * `null` quickly, but a slow/offline network must not let it block the cold
 * boot. 8s mirrors the stored-session bearer-validation budget
 * (`VALIDATION_TIMEOUT`) since both perform comparable bounded network work; on
 * expiry the step resolves to `null` and cold boot falls through (native then
 * reaches the unauthenticated backstop, web never runs this step at all).
 */
const SHARED_KEY_SIGNIN_TIMEOUT = 8000;

/**
 * HARD overall deadline (ms) for the entire cold-boot step loop —
 * defense-in-depth so a single non-settling step can NEVER hang auth resolution
 * forever (the production regression: a `navigator.credentials.get()` that
 * ignored its abort signal left the `fedcm-silent` step's promise unsettled, so
 * `runColdBoot` never advanced to the terminal `/sso` bounce and auth hung
 * indefinitely).
 *
 * Every step ALREADY bounds its own network work (the stored-session bearer
 * validation at 8s, the silent iframe at `SILENT_IFRAME_TIMEOUT`, FedCM
 * silent at `FEDCM_SILENT_TIMEOUT` plus its hard settle). On a healthy load
 * the FIRST recovering step wins in a
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
 * How long cold boot WAITS for the post-ladder SessionClient handoff
 * (`addCurrentAccount` + `start` + `syncFromClient`) before it resolves auth
 * and stops blocking. Once a ladder step planted a token the user is already
 * authenticated — the handoff only populates the multi-account set and the
 * server-authoritative active account, and those also arrive via the socket
 * subscription wired in `useEffect`. So on a slow/unresponsive backend we stop
 * AWAITING the handoff here (it keeps running in the background and projects
 * when it lands) rather than delaying `markAuthResolved` — otherwise the two
 * sequential `HttpService`-bounded REST calls could push auth resolution up to
 * ~10s past the ladder's own budget, reintroducing the exact spinner-stall
 * `COLD_BOOT_OVERALL_DEADLINE` exists to prevent. On the normal fast path the
 * handoff completes well within this, so the correct account shows with no
 * flash.
 */
const SESSION_HANDOFF_DEADLINE = 6000;

/**
 * Per-session soft timeout (ms) for the parallel stored-session validation in
 * `restoreStoredSession`. Each `validateSession` call races against this timer
 * so a single slow/offline session never blocks the whole startup validation
 * sweep. Sessions that don't answer in time are treated as unvalidated and kept
 * in the persisted ID list; only explicit invalid-session responses are pruned.
 */
const VALIDATION_TIMEOUT = 8000;
const VALIDATION_TIMEOUT_RESULT = 'validation-timeout' as const;
type StoredSessionValidationResult =
  | { session: ClientSession | null; timedOut: false }
  | { sessionId: string; timedOut: true };

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
  const pageApex = registrableApex(pageHostname);
  const idpApex = registrableApex(idpHostname);
  // Require a real registrable apex (not a shared/public suffix) AND an exact
  // apex match AND that the IdP host is the page apex itself or a subdomain of it.
  if (!pageApex || idpApex !== pageApex) return false;
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

  // Clear the durable "had a signed-in Oxy session before" hint.
  //
  // The hint (`storageKeys.priorSession`) is WRITTEN whenever a session is
  // established/restored — every commit funnels through `persistSessionDurably`,
  // and the stored-session reload winner sets it directly to backfill
  // pre-existing installs. It lives in the SAME `storageKeyPrefix`-scoped
  // durable store as the session ids, so it SURVIVES a session expiring; it is
  // cleared ONLY here, on EXPLICIT full sign-out (wired into `clearAllAccountData`
  // and the `useAuthOperations` logout paths — never the passive token-expiry
  // path). At cold boot the hint is read into `hadPriorSession` and feeds
  // `allowSsoBounce`: a RETURNING visitor (hint present) whose local session has
  // lapsed still gets ONE terminal `/sso` establish bounce so a central-only
  // cross-domain session recovers, while a truly first-time anonymous visitor is
  // never force-redirected.
  const clearPriorSessionHint = useCallback(async (): Promise<void> => {
    const readyStorage = await getReadyStorage();
    await readyStorage.removeItem(storageKeys.priorSession);
  }, [getReadyStorage, storageKeys.priorSession]);

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
    clearSessionState,
    saveActiveSessionId,
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

  // Session-sync integration layer (Fase 3-A -> 3-B). Built ONCE per
  // `oxyServices` instance via a lazy ref (mirrors the `oxyServicesRef`
  // pattern above) so the underlying `SessionClient` — and its socket
  // connection, once started — is never recreated across renders.
  //
  // ADDITIVE + INERT for this task: `client.start()` is NOT called here (that
  // is Task 2's job, which also retires the 8-step cold boot below). Until
  // then `client.getState()` never advances past `null`, so `syncFromClient`
  // is a guaranteed no-op in production — the existing cold-boot-driven state
  // remains the sole authority. The wiring exists so the projection can be
  // exercised in isolation against a controlled client before the authority
  // flip.
  const sessionClientPairRef = useRef<ReturnType<typeof createSessionClient> | null>(null);
  if (!sessionClientPairRef.current) {
    sessionClientPairRef.current = createSessionClient(oxyServices);
  }
  const { client: sessionClient, host: sessionClientHost } = sessionClientPairRef.current;

  // Cold-boot registration dedup (Task 5). `handleWebSSOSession` (declared
  // below) is the single commit funnel for every web ladder step that mints a
  // session (`sso-return`, `shared-key-signin`, `fedcm-silent`,
  // `silent-iframe`) — it registers the recovered account into the device set
  // itself (`sessionClient.addCurrentAccount()`). The cold-boot post-ladder
  // handoff ALSO registers, but only as a FALLBACK for the `stored-session`
  // step, which commits through a completely different path
  // (`switchSessionRef`) and never touches `sessionClient` on its own. This
  // ref lets the handoff detect "did a ladder step already register this
  // boot?" and skip a redundant second `POST /session/device/add`. Reset at
  // the start of every cold-boot pass.
  const registeredDuringBootRef = useRef(false);

  // Projects `client.getState()` onto the exposed `sessions` / `activeSessionId`
  // / `user` via the SAME setters the existing cold-boot/session-management
  // paths use. This is the SOLE authority for both a locally-initiated mutation
  // (switch/logout resolving here) AND a REMOTELY-pushed `session_state` (the
  // `device:<deviceId>` socket owned by `client.start()`, subscribed to below) —
  // there is no per-domain `useSessionSocket` anymore.
  //
  // GAP FIX (Task 4): when the pushed/bootstrapped state reports ZERO device
  // accounts, this device has been fully signed out — either by the LOCAL
  // `logout()`/`logoutAll()` mutation (which also runs its own explicit
  // cleanup) or, just as importantly, by a REMOTE actor (another tab/device
  // removing the last session, or an admin revoking every device account)
  // pushing that same empty state over the socket. The prior per-domain
  // `useSessionSocket` forced a local sign-out in this situation
  // (`triggerLocalSignOut`); without an equivalent here a remote full sign-out
  // would leave `user`/`isAuthenticated`/the bearer token stale until the next
  // 401. Route through the SAME `clearSessionState()` a local full sign-out
  // uses (authStore reset, token clear, query-cache clear, storage clear) —
  // idempotent with the local-logout caller's own explicit call.
  //
  // DELIBERATE-SIGN-OUT GUARD (Task 5): a zero-account state — however it
  // arrived — is just as terminal as a local `logout()`/`logoutAll()`, so it
  // sets the SAME durable "deliberately signed out" flag (web-only,
  // best-effort) that those two callers set directly. Without this, a remote
  // full wipe would leave the flag unset, and the `fedcm-silent`/`silent-iframe`
  // cold-boot steps AND the `useWebSSO` post-boot safety net could silently
  // re-mint a session from a still-live FedCM credential right after this
  // device was authoritatively signed out everywhere.
  //
  // REMOTE-SIGN-OUT SUPPRESSION FIX (review H1): the terminal `sso-bounce`
  // cold-boot step is gated on the durable prior-session hint
  // (`allowSsoBounce` = `hasPriorSession || hasLocalSession`), NOT on the
  // deliberately-signed-out flag set above. Leaving that hint in place after a
  // REMOTE full sign-out means the next reload still performs one terminal
  // `/sso` establish bounce, which can silently re-mint a session from a
  // still-live central `fedcm_session` — signing the user back in right after
  // they were signed out everywhere. Clear the SAME cleanup set the LOCAL
  // `logout()`/`logoutAll()` paths use (`useAuthOperations.ts`) — SSO bounce
  // state + the prior-session hint — so a remote sign-out is indistinguishable
  // from a local one to the next cold boot.
  const syncFromClient = useCallback(async (): Promise<void> => {
    const state = sessionClient.getState();
    if (state === null) {
      // INERT: no session state has been bootstrapped (client.start() has not
      // run). Never overwrite the existing cold-boot-driven state.
      return;
    }
    if (state.accounts.length === 0) {
      sessionClientHost.setCurrentAccountId(null);
      if (isWebBrowser()) {
        markSignedOut();
      }
      clearSsoBounceState();
      clearPriorSessionHintSafe(clearPriorSessionHint, logger);
      await clearSessionState();
      return;
    }
    // LAST-WRITE-WINS GUARD (review I3): `syncFromClient` is called
    // concurrently — once per socket `notify()` push AND once per direct
    // mutation call — and each invocation captures `state` before an async
    // profile fetch (`getUsersByIds`). `SessionClient`'s own state is
    // monotonic by revision, but this projection previously was not: a
    // SLOWER, OLDER fetch resolving AFTER a newer one would still apply its
    // now-stale captured `state`, clobbering `user`/`sessions`/
    // `activeSessionId` back to an outdated account. Capture the revision
    // this fetch is FOR, then after the await, re-read the client's current
    // state and bail if it has since moved past the captured revision — a
    // fresher call has already applied (or will apply) the current truth.
    const capturedRevision = state.revision;
    const ids = accountIdsOf(state);
    const users = ids.length > 0 ? await oxyServices.getUsersByIds(ids) : [];
    const latest = sessionClient.getState();
    if (!latest || latest.revision !== capturedRevision) {
      return;
    }
    const usersById = new Map(users.map((resolvedUser) => [resolvedUser.id, resolvedUser]));
    updateSessions(deviceStateToClientSessions(latest, usersById));
    setActiveSessionId(activeSessionIdOf(latest));
    const activeUser = activeUserOf(latest, usersById);
    if (activeUser) {
      loginSuccess(activeUser);
    }
    sessionClientHost.setCurrentAccountId(latest.activeAccountId);
  }, [
    oxyServices,
    sessionClient,
    sessionClientHost,
    updateSessions,
    setActiveSessionId,
    loginSuccess,
    clearSessionState,
    clearPriorSessionHint,
    logger,
  ]);

  useEffect(() => {
    return sessionClient.subscribe(() => {
      void syncFromClient();
    });
  }, [sessionClient, syncFromClient]);

  const {
    signIn,
    logout,
    logoutAll,
  } = useAuthOperations({
    oxyServices,
    storage,
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

    // Explicit FULL sign-out: drop the durable returning-user hint so the next
    // cold boot treats this device as a first-time anonymous visitor (no forced
    // `/sso` bounce). NOT done on the passive token-expiry path, so an expired
    // session still recovers via a returning-user bounce.
    await clearPriorSessionHint();

    // Reset account store
    useAccountStore.getState().reset();

    // Clear HTTP service cache
    oxyServices.clearCache();
  }, [queryClient, storage, clearSessionState, clearPriorSessionHint, logger, oxyServices]);

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

  // In-session access-token refresh (SDK-owned; every Expo RP inherits it).
  //
  // The services path never installed an `authRefreshHandler`, so the owner
  // `HttpService.refreshAccessToken` short-circuited to null and a 15-minute
  // access token expired with the app open while `isAuthenticated` stayed true —
  // a zombie logged-in state whose cross-apex feed calls 401-looped. Here we (1)
  // install a handler that re-mints a fresh token WITHOUT a reload using the SAME
  // durable silent-restore arms cold boot uses, and (2) start a proactive
  // scheduler that refreshes ~60s before expiry (and on tab-focus / app-
  // foreground) so the common case never even hits the reactive 401 path. The
  // linked client (`createLinkedClient`) delegates its refresh back to this owner
  // handler, so it is fixed for free.
  //
  // Runs once per `oxyServices` instance (stable, ref-constructed), and BEFORE
  // any cold-boot request can 401: cold boot is gated on async storage init, so
  // this synchronous mount effect installs the handler first. On cleanup the
  // handler is detached and the scheduler torn down (timer + foreground listener)
  // so nothing leaks across a provider remount. `setAuthRefreshHandler` is
  // optional-chained to tolerate partial test stubs.
  useEffect(() => {
    oxyServices.httpService.setAuthRefreshHandler?.(createInSessionRefreshHandler(oxyServices));
    const scheduler = startTokenRefreshScheduler(oxyServices);
    return () => {
      scheduler.dispose();
      oxyServices.httpService.setAuthRefreshHandler?.(null);
    };
  }, [oxyServices]);

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
    // A session is now durably committed — set the returning-user hint so a
    // future cold boot whose local session has lapsed still gets ONE `/sso`
    // establish bounce (see `markPriorSessionHint`). Every web commit path
    // (FedCM / silent iframe / SSO return / password / cookie restore) funnels
    // through here, so this is the single chokepoint for the hint.
    await readyStorage.setItem(storageKeys.priorSession, '1');
  }, [getReadyStorage, logger, storageKeys.activeSessionId, storageKeys.sessionIds, storageKeys.priorSession]);

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
  // `handleWebSSOSession` and the stored-session path) so the common reload
  // case unblocks the loading gate without sitting behind the remaining
  // (now-skipped) cold-boot steps.
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
    let unvalidatedSessionIds: string[] = [];

    if (storedSessionIds.length > 0) {
      // Validate all sessions in parallel (with a per-session timeout) to avoid
      // sequential blocking that freezes the app on startup
      const results = await Promise.allSettled(
        storedSessionIds.map(async (sessionId) => {
          const timeoutPromise = new Promise<typeof VALIDATION_TIMEOUT_RESULT>((resolve) =>
            setTimeout(() => resolve(VALIDATION_TIMEOUT_RESULT), VALIDATION_TIMEOUT),
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
            if (validation === VALIDATION_TIMEOUT_RESULT) {
              return { sessionId, timedOut: true as const };
            }
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
              return { session: clientSession, timedOut: false as const };
            }
            return { session: null, timedOut: false as const };
          });
        }),
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const value: StoredSessionValidationResult = result.value;
        if (value.timedOut) {
          unvalidatedSessionIds.push(value.sessionId);
        } else if (value.session) {
          validSessions.push(value.session);
        }
      }

      // Persist validated sessions while preserving soft-timed-out IDs. This
      // still clears sessions that were explicitly rejected as invalid, but
      // avoids logging out valid secondary accounts solely because the API was
      // slow during startup.
      updateSessionsRef.current(validSessions, {
        merge: false,
        preserveSessionIds: unvalidatedSessionIds,
      });
    }

    if (storedActiveSessionId) {
      try {
        await switchSessionRef.current(storedActiveSessionId);
        // The stored session is committed (this is native's ONLY restore path
        // and the common web reload winner). Unblock the auth-resolution gate
        // immediately so the loading screen clears without waiting for the
        // remaining cold-boot steps to be evaluated/short-circuited (idempotent).
        markAuthResolvedRef.current();
        // Backfill the returning-user hint. A reload winner already had the hint
        // set at original sign-in, but pre-existing installs (signed in before
        // this hint shipped) get it set here so their NEXT lapse-and-return still
        // earns one `/sso` establish bounce. `storage` is non-null (guarded at
        // the top of this callback); best-effort, never blocks restore.
        await storage.setItem(storageKeys.priorSession, '1');
        return true;
      } catch (switchError) {
        // Silently handle expected errors (invalid sessions, timeouts, network issues)
        if (isInvalidSessionError(switchError)) {
          await storage.removeItem(storageKeys.activeSessionId);
          updateSessionsRef.current(
            validSessions.filter((session) => session.sessionId !== storedActiveSessionId),
            { merge: false, preserveSessionIds: unvalidatedSessionIds },
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
    storageKeys.priorSession,
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
  // Order (web): SSO return → stored session → shared-key sign-in (native
  // only, disabled here) → FedCM silent (central) → silent iframe (per-apex,
  // the durable reload path) → SSO bounce (terminal). This is a pure
  // TOKEN-ACQUISITION ladder — it mints the first per-domain access token by
  // whichever means recovers one fastest. Once a token is acquired (or the
  // ladder exhausts), the SERVER-authoritative `SessionClient` takes over:
  // `addCurrentAccount` + `start` bootstrap the device session set and
  // multi-account/active-account state from `GET /session/device/state`, so
  // WHICH account is active is decided server-side, not by a client-persisted
  // slot. There is no oxy_rt refresh-cookie restore step in this ladder.
  //
  // LATENCY (FIX A): `stored-session` runs BEFORE the slow no-redirect probes
  // (`fedcm-silent`, `silent-iframe`). On a normal reload the local bearer
  // validates in one round-trip and wins, so `runColdBoot` short-circuits and
  // never sits through those probes' timeouts (the prior serial sum was a
  // ~20-30s stall). `sso-return` MUST stay first — it consumes the URL
  // fragment before anything can strip it. On a first visit with no local
  // session, `stored-session` skips and the cross-domain fallback chain
  // (fedcm → iframe → sso-bounce) runs exactly as before; the per-apex silent
  // iframe still restores a durable cross-domain session on reload WITHOUT a
  // top-level bounce, so when it wins `sso-bounce` never fires (no flash, no
  // loop).
  // Order (native): stored session only (every web-only step is disabled
  // off-browser).
  const restoreSessionsFromStorage = useCallback(async (): Promise<void> => {
    if (!storage) {
      return;
    }

    setTokenReady(false);
    // Fresh per-boot flag — see the declaration comment above `sessionClient`.
    registeredDuringBootRef.current = false;

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

    // FIX-B smart-gate input: has this device/app EVER had a signed-in Oxy
    // session (the durable `priorSession` hint, set on every commit, cleared
    // only on explicit full sign-out)? Read ONCE here — synchronously usable by
    // the terminal `sso-bounce` `enabled` gate below — so a RETURNING visitor
    // whose local session has lapsed still earns one `/sso` establish bounce,
    // while a truly first-time anonymous visitor is never force-redirected.
    // `storage` is non-null (guarded above); a read failure is treated as "no
    // prior session" (fail safe toward anonymous-browse).
    let hadPriorSession = false;
    try {
      hadPriorSession = (await storage.getItem(storageKeys.priorSession)) === '1';
    } catch (priorSessionReadError) {
      if (__DEV__) {
        loggerUtil.debug(
          'Failed to read prior-session hint (treating as first-time visitor)',
          { component: 'OxyContext', method: 'restoreSessionsFromStorage' },
          priorSessionReadError as unknown,
        );
      }
    }

    // DELIBERATELY-SIGNED-OUT gate (web): when the user pressed "Sign out", the
    // central IdP session (FedCM credential association / per-apex `fedcm_session`
    // cookie) can still be live, so the AUTOMATIC silent steps below
    // (`fedcm-silent`, `silent-iframe`) would re-mint a session on the very next
    // cold boot and sign the user back in without intent. Read the durable flag
    // ONCE here (synchronously usable by the step `enabled` gates) and skip those
    // two steps while it is set. Any deliberate sign-in clears it. The `sso-bounce`
    // step is already self-suppressed after sign-out (its `hasPriorSession` hint is
    // cleared), and the local `stored-session` restore step is unaffected — a
    // deliberate sign-out clears those credentials anyway.
    const silentRestoreBlocked = isSilentRestoreSuppressed();

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
            // probes (`fedcm-silent`, `silent-iframe`). On a normal reload the
            // local bearer validates in one round-trip and wins; `runColdBoot`
            // then short-circuits and never even evaluates the slow
            // no-redirect probes that would otherwise time out (the ~20-30s
            // serial stall). The `sso-return` step stays AHEAD of this one —
            // it must consume the URL fragment before any later step (or
            // anything else) strips it. On a first visit with no local
            // session this step skips and the cross-domain fallback chain
            // (fedcm → iframe → sso-bounce) runs exactly as before.
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
            // 2.5) Shared-key SSO (NATIVE ONLY) — same-device, no interaction.
            //
            // When a sibling Oxy app (the Commons identity vault) has written
            // the cross-app shared identity into the `group.so.oxy.shared`
            // keychain, this mints THIS app's session from it silently:
            // `signInWithSharedIdentity()` proves control of the shared key
            // (challenge → sign → verify, which plants the tokens server-side)
            // and returns a `SessionLoginResponse`, which we commit through the
            // SAME path the web SSO steps use (`handleWebSSOSession`), so state,
            // durable persistence, profile fetch, and `markAuthResolved` all run
            // identically. Returns `null` when no shared identity is present, so
            // a device without Commons simply falls through.
            //
            // ORDERING: runs immediately AFTER `stored-session` (an already
            // restored local bearer always wins first — `storedSessionRestored`
            // gates this off) and BEFORE the web-only probes (which are gated
            // off on native anyway). Native-only: `enabled` requires
            // `!isWebBrowser()`, and the core method also returns `null` on web,
            // so `WebOxyProvider` / the web path are entirely unaffected.
            // Bounded by `SHARED_KEY_SIGNIN_TIMEOUT` so a slow/offline network
            // cannot stall cold boot.
            id: 'shared-key-signin',
            enabled: () => !isWebBrowser() && !storedSessionRestored,
            run: async () => {
              if (!commitWebSession) {
                return { kind: 'skip' };
              }
              let timeoutId: ReturnType<typeof setTimeout> | undefined;
              const session = await Promise.race<SessionLoginResponse | null>([
                oxyServices.signInWithSharedIdentity?.() ?? Promise.resolve(null),
                new Promise<null>((resolve) => {
                  timeoutId = setTimeout(() => resolve(null), SHARED_KEY_SIGNIN_TIMEOUT);
                }),
              ]).finally(() => {
                if (timeoutId !== undefined) {
                  clearTimeout(timeoutId);
                }
              });
              if (!session) {
                return { kind: 'skip' };
              }
              await commitWebSession(session);
              // Record the win so the (web-only) probes below explicitly skip —
              // belt-and-suspenders; `runColdBoot` already short-circuits on the
              // first `{kind:'session'}`, and those probes are off on native.
              storedSessionRestored = true;
              return { kind: 'session', session: true };
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
              !storedSessionRestored &&
              !silentRestoreBlocked &&
              fedcmSupported &&
              !servicesSilentAttempted.has(silentKey),
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
            // The per-apex iframe mint itself lives in
            // `mintSessionViaPerApexIframe` (shared verbatim with the in-session
            // refresh handler so the two paths can never drift): it points the
            // iframe at `autoDetectAuthWebUrl()` and skips when there is no
            // per-apex IdP (localhost/IP/single-label/off-browser). Web only; on
            // native `isWebBrowser()` gates it off, so native never runs an
            // iframe.
            //
            // FIX-B: additionally skipped when `stored-session` already won.
            // FIX-D: bounded by `SILENT_IFRAME_TIMEOUT` (plus `iframe.onerror`
            // fail-fast in core) so a no-message iframe cannot stall cold boot.
            id: 'silent-iframe',
            enabled: () => !storedSessionRestored && !silentRestoreBlocked && isWebBrowser(),
            run: async () => {
              if (!commitWebSession) {
                return { kind: 'skip' };
              }
              // Shared with the in-session refresh handler: the ONE
              // implementation of "mint a first-party per-apex token without a
              // reload" lives in `silentSessionRestore` so cold boot and refresh
              // never drift.
              const session = await mintSessionViaPerApexIframe(oxyServices, SILENT_IFRAME_TIMEOUT);
              if (!session) {
                return { kind: 'skip' };
              }
              await commitWebSession(session);
              return { kind: 'session', session: true };
            },
          },
          {
            // 5) SSO bounce (TERMINAL, web only, at most once). No local session
            // was found by any step above. Top-level navigate to the central
            // `auth.oxy.so/sso?prompt=none` so the IdP can either mint a session
            // (returning an opaque code we exchange on the callback) or report
            // `none`. This step tears the document down on success — its `skip`
            // result is only observed if `assign` no-ops. Disabled on the IdP
            // itself, once the NO_SESSION flag is set, or while a bounce guard is
            // still active (loop + self-heal protection).
            id: 'sso-bounce',
            enabled: () => {
              // Smart gate (SDK-owned, shared with `WebOxyProvider` via core's
              // `allowSsoBounce`). The terminal `/sso` establish-bounce is the
              // ONLY cold-boot step that can recover a session living SOLELY at
              // the central IdP (a cross-apex RP whose local session expired),
              // and it is what plants the per-apex `fedcm_session` cookie the
              // earlier silent-iframe step relies on. So it is allowed iff a
              // prior-signed-in hint exists OR a local session was recovered this
              // boot (`storedSessionRestored`, always false here — an earlier step
              // would have won — but passed for spec fidelity): a RETURNING user
              // still gets ONE bounce, while a truly first-time anonymous visitor
              // does NOT (anonymous browse). The per-tab loop guards below
              // (`ssoNoSessionKey`, `ssoAttemptedKey`, `guardActive`) still cap an
              // allowed bounce at one per cold boot.
              if (!allowSsoBounce({
                hasPriorSession: hadPriorSession,
                hasLocalSession: storedSessionRestored,
              })) {
                return false;
              }
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

      // TOKEN LADDER → SESSIONCLIENT AUTHORITY HANDOFF. The steps above are
      // ONLY a token-acquisition ladder — they mint the first per-domain
      // access token by whichever means recovers one fastest. Once a session
      // is known (either this cold boot committed one via the ladder, or an
      // access token is already held in memory — e.g. a prior render already
      // planted it), hand off to the server-authoritative `SessionClient`:
      // `addCurrentAccount` registers this recovered account+session into the
      // server `DeviceSession` (derives identity from the bearer), `start`
      // bootstraps the full device-session state (server `activeAccountId` +
      // `activeToken`) and connects the realtime socket, and `syncFromClient`
      // projects that state onto the exposed `sessions`/`activeSessionId`/
      // `user`. This is what lets a switched (managed/org) account survive
      // reload: the SERVER, not a client-persisted slot, owns which account is
      // active. Never call the client when no session was acquired — an
      // anonymous visitor must stay logged out. Failures are logged and
      // swallowed; they must never throw out of cold boot.
      //
      // `addCurrentAccount` is SKIPPED when `registeredDuringBootRef` is
      // already `true` — every ladder step except `stored-session` commits
      // through `handleWebSSOSession`, which registers the account itself
      // (see its own `sessionClient.addCurrentAccount()` call). Without this
      // guard a winning `sso-return` / `shared-key-signin` / `fedcm-silent` /
      // `silent-iframe` step would register the SAME account twice
      // (`POST /session/device/add` called back-to-back). `start()` and
      // `syncFromClient()` still always run — `start()` is idempotent
      // (no-ops once already started) and is what connects the realtime
      // socket for the first time.
      if (outcome.kind === 'session' || oxyServices.getAccessToken()) {
        // Self-contained: never throws (own try/catch), so it is safe to let it
        // outlive the race below and finish in the background if the deadline
        // trips — the socket subscription then projects the state when it lands.
        const handoff = (async () => {
          try {
            if (!registeredDuringBootRef.current) {
              await sessionClient.addCurrentAccount();
            }
            await sessionClient.start();
            await syncFromClient();
          } catch (startErr) {
            loggerUtil.warn(
              'cold-boot: SessionClient start failed',
              { component: 'OxyContext', method: 'restoreSessionsFromStorage' },
              startErr as unknown,
            );
          }
        })();
        // Bound how long auth resolution waits for the handoff (see
        // `SESSION_HANDOFF_DEADLINE`): the token is already planted, so on a
        // slow backend we proceed to `markAuthResolved` and let the handoff
        // complete asynchronously rather than stalling the spinner.
        let handoffDeadlineId: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          handoff,
          new Promise<void>((resolve) => {
            handoffDeadlineId = setTimeout(resolve, SESSION_HANDOFF_DEADLINE);
          }),
        ]).finally(() => {
          if (handoffDeadlineId !== undefined) {
            clearTimeout(handoffDeadlineId);
          }
        });
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
    storageKeys.priorSession,
    restoreStoredSession,
    runSsoReturn,
    markAuthResolved,
    sessionClient,
    syncFromClient,
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

    // A committed web session re-enables automatic silent restore: clear the
    // durable "deliberately signed out" flag. This funnel is reached by deliberate
    // sign-ins (password, interactive FedCM, `/sso` return) AND by the silent
    // cold-boot steps — but those are GATED on the flag, so when it is set they
    // never run and never reach here; clearing is therefore only hit on a genuine
    // (re-)sign-in or when restore was already permitted, both correct.
    clearSignedOut();

    // Register this recovered account+session into the server-authoritative
    // device-session set. Every web primary-session restore funnels through
    // here — FedCM silent (`/fedcm/exchange`), per-apex `/auth/silent` iframe,
    // central `/sso` return, and keyless password sign-in — and each of them
    // needs the resulting account added to the device's `DeviceSession` doc so
    // the sign-in persists across reload / other tabs / devices and the
    // realtime `device:<deviceId>` socket has an account to track.
    // `sessionClient.addCurrentAccount()` (`POST /session/device/add`) derives
    // identity from the bearer this function just planted above;
    // `syncFromClient()` reprojects the resulting server state onto the
    // exposed sessions/activeSessionId/user. Best-effort: a failure here must
    // NEVER fail the sign-in itself — cold boot re-registers this account into
    // the device set on the next load regardless. `registeredDuringBootRef` is
    // flipped on success so the cold-boot post-ladder handoff (which reaches
    // every step, including this one) does not redundantly re-register the
    // SAME account with a second `POST /session/device/add`.
    try {
      await sessionClient.addCurrentAccount();
      registeredDuringBootRef.current = true;
      await syncFromClient();
    } catch (registrationError) {
      loggerUtil.warn(
        'handleWebSSOSession: failed to register session into device set',
        { component: 'OxyContext', method: 'handleWebSSOSession' },
        registrationError as unknown,
      );
    }

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
  }, [oxyServices, updateSessions, setActiveSessionId, loginSuccess, onAuthStateChange, persistSessionDurably, sessionClient, syncFromClient]);

  // Expose `handleWebSSOSession` to the cold-boot FedCM/iframe/SSO steps,
  // which reference it through a ref because they are declared above this
  // callback. Assigned synchronously on every render so the ref is populated
  // before the cold-boot effect (gated on `storage`/`initialized`) can fire.
  handleWebSSOSessionRef.current = handleWebSSOSession;

  // Keyless native sign-in: username/email + password. The slimmed Accounts app
  // (which no longer holds a local identity key) uses this; it commits a
  // successful session through the SAME `handleWebSSOSession` path FedCM / SSO
  // use, so state, durable persistence, profile fetch, and `markAuthResolved`
  // all run identically. The API returns either a full session OR a two-factor
  // handoff (`{ twoFactorRequired, loginToken }`) — we surface the latter as a
  // discriminated result so the caller can run the 2FA challenge without any
  // session being committed.
  const signInWithPassword = useCallback(
    async (
      identifier: string,
      password: string,
      opts?: { deviceName?: string; deviceFingerprint?: string },
    ): Promise<PasswordSignInResult> => {
      // On a cross-apex web RP a direct password sign-in mints a bearer against
      // the Oxy API but establishes no `fedcm_session`, so the session would be
      // lost on reload. Refuse it and direct the app to the durable IdP popup
      // ("Continue with Oxy"). Native and same-apex `*.oxy.so` are unaffected.
      if (isCrossApexWeb()) {
        throw new CrossApexDirectSignInError();
      }
      const response = await oxyServices.signIn(
        identifier,
        password,
        opts?.deviceName,
        opts?.deviceFingerprint,
      );
      // Core types `signIn` as `SessionLoginResponse`, but the API may instead
      // return a 2FA challenge handoff. Widen with optional fields (no `any`) to
      // read them — the added members are optional, so the base type is
      // assignable to this intersection.
      const maybeTwoFactor: SessionLoginResponse & {
        twoFactorRequired?: boolean;
        loginToken?: string;
      } = response;
      if (maybeTwoFactor.twoFactorRequired && maybeTwoFactor.loginToken) {
        return { status: '2fa_required', loginToken: maybeTwoFactor.loginToken };
      }
      // Full session — commit it through the shared web-session path.
      await handleWebSSOSession(response);
      return { status: 'ok' };
    },
    [oxyServices, handleWebSSOSession],
  );

  // Cross-domain silent SSO is now owned by the `fedcm-silent` / `silent-iframe`
  // cold-boot steps above (the ordered `runColdBoot` sequence). `useWebSSO`
  // remains mounted for its module-level run-once guard and its interactive
  // FedCM helpers, and as a bounded post-boot safety net: it can fire at most
  // once per page load (its own module guard), and only AFTER cold boot has
  // finished (`tokenReady`) with no user recovered. We deliberately keep
  // `shouldTryWebSSO` as `tokenReady && !user && initialized` — it is NOT
  // loosened; cold boot runs while `tokenReady` is false, so this never races
  // the cold-boot silent step.
  //
  // DELIBERATE-SIGN-OUT GUARD (session-sync cutover, Task 5): `tokenReady`
  // does not reset to `false` when a session that was already established
  // ENDS (local `logout()`/`logoutAll()`, or a remote full sign-out pushed
  // over the `SessionClient` socket — see `syncFromClient`'s zero-accounts
  // branch below) — only `user` goes back to `null`. Without this guard,
  // `shouldTryWebSSO` would flip true for the FIRST time at the moment of
  // that sign-out (since it had never been true before while authenticated)
  // and this "post-boot safety net" would fire `useWebSSO`'s still-unconsumed
  // module-level guard, silently re-minting a session from a still-live
  // FedCM credential — undoing the sign-out the instant it completes. Both
  // sign-out paths set the durable deliberately-signed-out flag (`markSignedOut`
  // — directly on local logout, or via `syncFromClient` on a remote wipe), so
  // gating on `!isSilentRestoreSuppressed()` here closes the gap the same way
  // the cold-boot `fedcm-silent`/`silent-iframe` steps already do
  // (`silentRestoreBlocked`).
  const shouldTryWebSSO =
    isWebBrowser() && tokenReady && !user && initialized && !isSilentRestoreSuppressed();

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
  //
  // KEPT (session-sync cutover audit, Task 5): this is NOT redundant with the
  // `SessionClient` socket (`device:<deviceId>`, `session_state` push). That
  // socket only fires for revocations that flow through oxy-api's
  // `DeviceSession` authority (`POST /session/device/signout` and friends). A
  // sign-out at the CENTRAL IdP itself (`auth.oxy.so`'s own `AuthSession` /
  // `fedcm_session` — e.g. a direct IdP-side sign-out, or an admin/security
  // revocation there) does not currently touch `DeviceSession` at all, so no
  // socket push follows — this iframe poll is the ONLY mechanism that catches
  // it today. A future phase should move this server-side (IdP deactivation
  // -> `DeviceSession` update -> broadcast over the same socket), at which
  // point this client-side poll becomes redundant and can be deleted.
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

  // Exposed `refreshSessions`: re-bootstraps the server-authoritative device
  // state (`GET /session/device/state`, the SAME request `SessionClient.start()`
  // makes) and reprojects it via `syncFromClient` — a manual pull-to-refresh
  // counterpart to the realtime `device:<deviceId>` socket `client.start()`
  // already owns (there is no per-domain `useSessionSocket` anymore; a REMOTE
  // sign-out or account change arrives over that socket and is handled by
  // `syncFromClient`'s subscription below, including the full-sign-out gap fix
  // documented above it).
  const refreshSessionsForContext = useCallback(async (): Promise<void> => {
    await sessionClient.bootstrap();
    await syncFromClient();
  }, [sessionClient, syncFromClient]);

  // Exposed `switchSession`: routes through the server-authoritative
  // `SessionClient` (Fase 3-B) rather than `useSessionManagement`'s own
  // `switchSession` (which remains, unchanged, for `useAuthOperations`'
  // internal same-user duplicate-session dedup — a different, legacy
  // session-validate concept unrelated to switching the device's ACTIVE
  // account). Resolves the target account from the current device state,
  // asks the server to switch, reprojects, and returns the now-active user.
  const switchSessionForContext = useCallback(
    async (sessionId: string): Promise<User> => {
      const targetAccountId = sessionClient
        .getState()
        ?.accounts.find((account) => account.sessionId === sessionId)?.accountId;
      if (!targetAccountId) {
        throw new Error(`No device account found for session "${sessionId}"`);
      }

      await sessionClient.switchAccount(targetAccountId);
      await syncFromClient();

      const activeUser = useAuthStore.getState().user;
      if (!activeUser) {
        throw new Error('Active account profile could not be resolved after switch');
      }
      return activeUser;
    },
    [sessionClient, syncFromClient],
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

  // --- Account graph state ---
  const [accounts, setAccounts] = useState<AccountNode[]>([]);

  // Load the unified account graph when authenticated
  const refreshAccounts = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || !tokenReady || !oxyServices.getAccessToken()) {
      setAccounts([]);
      return;
    }

    try {
      const list = await oxyServices.listAccounts();
      setAccounts(list);
    } catch (err) {
      if (isUnauthorizedStatus(err)) {
        setAccounts([]);
        await clearSessionStateRef.current();
        return;
      }
      if (__DEV__) {
        loggerUtil.debug('Failed to load accounts', { component: 'OxyContext' }, err as unknown);
      }
    }
  }, [isAuthenticated, oxyServices, tokenReady]);

  useEffect(() => {
    if (isAuthenticated && initialized && tokenReady) {
      refreshAccounts();
    }
  }, [isAuthenticated, initialized, tokenReady, refreshAccounts]);

  // Shared post-switch side effects, run identically regardless of which
  // `switchToAccount` branch handled the switch below: reload the switchable
  // account graph (the new active account's relationships differ) and
  // invalidate every query so all data refetches as the new account.
  const runPostAccountSwitchSideEffects = useCallback(async (): Promise<void> => {
    await refreshAccounts();
    queryClient.invalidateQueries();
  }, [refreshAccounts, queryClient]);

  // Switch the active session INTO an account from the unified graph. In the
  // REAL-SESSION model this is identical to switching device sign-ins: the
  // whole app becomes that account. There is exactly ONE uniform path for
  // that — the device's server-authoritative `SessionClient.switchAccount()`
  // — used for EVERY switch, org/managed accounts included:
  //
  //  - If `accountId` is ALREADY registered on this device's multi-account
  //    set (a prior `switchToAccount`/sign-in already added it), switch
  //    straight through `sessionClient.switchAccount()` — the SAME path
  //    `switchSession` uses for ordinary device sessions. No new session is
  //    minted, so no session churn / deactivation of the account's existing
  //    session (H4).
  //  - Only the FIRST time an account is switched into does it need minting:
  //    `oxyServices.switchToAccount` mints+plants a real session, then
  //    `sessionClient.addCurrentAccount()` registers it into the device set
  //    (server-set httpOnly `oxy_rt_<authuser>` cookie, so the session joins
  //    the device multi-account set and survives reload / `refresh-all`).
  //    Every subsequent switch into that same account takes the branch above.
  const switchToAccount = useCallback(async (accountId: string): Promise<void> => {
    const deviceState = sessionClient.getState();
    if (deviceState?.accounts.some((account) => account.accountId === accountId)) {
      await sessionClient.switchAccount(accountId);
      await syncFromClient();
      await runPostAccountSwitchSideEffects();
      return;
    }

    const result = await oxyServices.switchToAccount(accountId);
    if (!result?.user || !result?.sessionId) {
      throw new Error('Account switch did not return a valid session');
    }

    // A switch is a deliberate sign-in into an account: re-enable automatic silent
    // restore by clearing any prior "deliberately signed out" flag.
    clearSignedOut();

    // `oxyServices.switchToAccount` already planted `result.accessToken` as the
    // active token; mirror the minted session into the multi-account store and
    // mark it current. The device account SET (and its `authuser` slot
    // numbering) is server-authoritative via `SessionClient` — the
    // `addCurrentAccount` + `syncFromClient` reprojection below supersedes this
    // local mirror with the server's own state.
    const now = new Date();
    const clientSession: ClientSession = {
      sessionId: result.sessionId,
      deviceId: result.deviceId || '',
      expiresAt: result.expiresAt || new Date(now.getTime() + DEFAULT_SESSION_VALIDITY_MS).toISOString(),
      lastActive: now.toISOString(),
      userId: result.user.id?.toString() ?? '',
      isCurrent: true,
    };
    updateSessions([clientSession], { merge: true });
    setActiveSessionId(result.sessionId);
    await persistSessionDurably(result.sessionId);

    // Register the switched-to account into the device's server-authoritative
    // multi-account set (the SAME `SessionClient.addCurrentAccount()` the
    // cold-boot handoff uses — it derives identity from the bearer, which
    // `oxyServices.switchToAccount` already planted above) and reproject
    // state, so the switch persists across reload / other tabs / devices
    // instead of only living in this provider's local session-management
    // state.
    await sessionClient.addCurrentAccount();
    await syncFromClient();

    // Fetch the canonical User for the new account (the switch result carries
    // only MinimalUserData); fall back to that minimal shape if the profile
    // fetch fails so the app still reflects the switched identity.
    let fullUser: User;
    try {
      fullUser = await oxyServices.getCurrentUser();
    } catch (profileError) {
      if (__DEV__) {
        loggerUtil.debug('Failed to fetch full user after account switch; using switch result user', { component: 'OxyContext', method: 'switchToAccount' }, profileError as unknown);
      }
      fullUser = result.user as unknown as User;
    }
    loginSuccess(fullUser);
    onAuthStateChange?.(fullUser);

    await runPostAccountSwitchSideEffects();
  }, [oxyServices, updateSessions, setActiveSessionId, persistSessionDurably, sessionClient, syncFromClient, loginSuccess, onAuthStateChange, runPostAccountSwitchSideEffects]);

  const createAccountFn = useCallback(async (data: CreateAccountInput): Promise<AccountNode> => {
    const account = await oxyServices.createAccount(data);
    await refreshAccounts();
    return account;
  }, [oxyServices, refreshAccounts]);

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
    signInWithPassword,
    handleWebSession: handleWebSSOSession,
    logout,
    logoutAll,
    switchSession: switchSessionForContext,
    removeSession: logout,
    refreshSessions: refreshSessionsForContext,
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
    accounts,
    switchToAccount,
    refreshAccounts,
    createAccount: createAccountFn,
  }), [
    activeSessionId,
    signIn,
    signInWithPassword,
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
    refreshSessionsForContext,
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
    accounts,
    switchToAccount,
    refreshAccounts,
    createAccountFn,
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
  signInWithPassword: () => rejectMissingProvider<PasswordSignInResult>(),
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
  accounts: [],
  switchToAccount: () => rejectMissingProvider<void>(),
  refreshAccounts: () => rejectMissingProvider<void>(),
  createAccount: () => rejectMissingProvider<AccountNode>(),
};

export const useOxy = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    return LOADING_STATE;
  }
  return context;
};

export default OxyContext;
