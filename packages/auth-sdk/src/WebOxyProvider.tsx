/**
 * @oxyhq/auth — Web Authentication Provider
 *
 * Clean implementation with ZERO React Native dependencies.
 * Provides FedCM and redirect authentication methods.
 * Uses centralized AuthManager for token and session management.
 */

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
import {
  OxyServices,
  CrossDomainAuth,
  createAuthManager,
  resolveCentralAuthUrl,
  runColdBoot,
  logger,
  SSO_CALLBACK_PATH,
  ssoStateKey,
  ssoNoSessionKey,
  ssoGuardKey,
  ssoDestKey,
  ssoAttemptedKey,
  isCentralIdPOrigin,
  guardActive,
  buildSsoBounceUrl,
  consumeSsoReturn,
} from '@oxyhq/core';
import type {
  AuthManager,
  User,
  SessionLoginResponse,
  ClientSession,
  AuthManagerAccount,
  ColdBootStep,
  ColdBootOutcome,
} from '@oxyhq/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { attachQueryPersistence, clearQueryCache, createQueryClient } from './hooks/queryClient';
import { isWebBrowser } from './hooks/useWebSSO';

export interface WebAuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * The app's Oxy OAuth client id (ApplicationCredential publicKey), as
   * supplied via the `clientId` prop. Used to identify this app in OAuth
   * authorize / consent flows (issue #214). Normalized to a trimmed non-empty
   * string, or `null` when the consuming app did not configure one.
   */
  clientId: string | null;
  activeSessionId: string | null;
  /**
   * Device-session list derived from `accounts`. Every `AuthManagerAccount`
   * is projected into a `ClientSession` with `authuser` populated.
   */
  sessions: ClientSession[];
  /**
   * Every device-local account the AuthManager knows about, sorted by
   * `authuser` ascending. Populated by the cookie-path
   * `restoreFromCookies()` on cold boot and refreshed by `switchAccount`
   * / `signOutAccount` / `signOutAll`.
   */
  accounts: AuthManagerAccount[];
  /** Currently-active `authuser` slot, or `null` when no slots are signed in. */
  activeAuthuser: number | null;
}

export interface WebAuthActions {
  /**
   * Sign in via the preferred method (auto / fedcm / redirect).
   */
  signIn: () => Promise<void>;
  signInWithFedCM: () => Promise<void>;
  signInWithRedirect: () => void;
  signOut: () => Promise<void>;
  isFedCMSupported: () => boolean;
  /**
   * Switch to a different session by its server-side session id. Web
   * implementation resolves the corresponding `authuser` slot and rotates
   * it via the httpOnly refresh cookie.
   */
  switchSession: (sessionId: string) => Promise<void>;
  /**
   * Multi-account: switch to a different device-local slot by `authuser`
   * index. Mints a fresh access token via `POST /auth/refresh?authuser=N`
   * (no bearer required) and updates the active state.
   */
  switchAccount: (authuser: number) => Promise<void>;
  /**
   * Multi-account: sign out a specific device-local slot. Clears the
   * `oxy_rt_${authuser}` cookie server-side and drops the slot from the
   * registry. If the active slot was signed out, the lowest remaining
   * authuser is promoted to active.
   */
  signOutAccount: (authuser: number) => Promise<void>;
  /**
   * Multi-account: sign out EVERY device-local slot at once. Clears every
   * `oxy_rt_${n}` cookie server-side. Equivalent to `signOut()` in the
   * cookie path.
   */
  signOutAll: () => Promise<void>;
  clearSessionState: () => Promise<void>;
}

export interface WebOxyContextValue extends WebAuthState, WebAuthActions {
  oxyServices: OxyServices;
  crossDomainAuth: CrossDomainAuth;
  authManager: AuthManager;
}

const WebOxyContext = createContext<WebOxyContextValue | null>(null);

/**
 * Discriminated union carried by each cold-boot step's `kind: 'session'`
 * result. The `method` tag lets the post-runner switch reproduce today's exact
 * per-branch commit:
 *   - `redirect` / `fedcm` → `handleAuthSuccess(session, method)`.
 *   - `cookie` → the AuthManager restore path (`setUser` + `syncAccounts*` +
 *     `setActiveSessionId`), which deliberately does NOT funnel through
 *     `handleAuthSuccess`.
 *
 * The `redirect` and `fedcm` variants carry a fully-hydrated
 * `SessionLoginResponse` (real user, never the empty-id placeholder). The
 * `cookie` variant carries the already-fetched `User` plus the active session
 * id resolved from the AuthManager registry.
 */
type ColdBootSession =
  | { method: 'redirect' | 'fedcm' | 'sso'; session: SessionLoginResponse }
  | { method: 'cookie'; user: User; activeSessionId: string | null };

/**
 * The precise result of the `sso-return` step — always the `sso` variant or
 * `null`. Returned by `runSsoReturn` so both call sites (the cold-boot step and
 * the bfcache `pageshow` handler) can read `.session` without narrowing the
 * full {@link ColdBootSession} union.
 */
type SsoReturnSession = { method: 'sso'; session: SessionLoginResponse };

/**
 * Module-level run-once guard for the central FedCM silent sign-in step.
 *
 * The init effect runs again whenever the provider remounts (route change,
 * StrictMode double-invoke, error-boundary recovery). The redirect-callback
 * and cookie-restore steps are cheap and idempotent, but the FedCM silent step
 * triggers `navigator.credentials.get` (`mediation: 'silent'`) against the
 * central IdP, which must fire AT MOST ONCE per page load. Otherwise a remount
 * storm becomes a credential-request storm.
 *
 * Keyed on `origin|baseURL` (the same signature `useWebSSO.ssoSignature` uses)
 * so two providers on the same origin pointed at different APIs each get their
 * own one-shot budget, while same-origin same-API remounts share one. The set
 * is intentionally never cleared: only a fresh page load (a fresh module scope)
 * can change the IdP session state.
 */
const fedcmSilentSignInAttempted = new Set<string>();

/**
 * Per-step fail-fast budget for the cold-boot refresh-cookie restore
 * (`authManager.initialize()` → `refreshAllSessions`).
 *
 * On a cross-domain RP the `Domain=oxy.so` refresh cookie never reaches
 * `api.<apex>`, so this request returns no accounts (or stalls behind a slow
 * endpoint) with no useful answer. As one cold-boot step it must not block the
 * fall-through to the terminal `/sso` bounce. 3s bounds the wait while leaving
 * ample headroom for a genuine first-party `*.oxy.so` rotation round-trip.
 * Mirrors the services `OxyContext` constant of the same name.
 */
const COOKIE_RESTORE_TIMEOUT = 3000;

/**
 * Build the run-once signature for the silent sign-in guard. Matches
 * `useWebSSO.ssoSignature` exactly: `${origin}|${baseURL}`.
 */
function silentSignInKey(oxyServices: OxyServices): string {
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
 * Clear all per-origin SSO bounce sessionStorage keys. Called ONLY on EXPLICIT
 * user sign-out (`signOut` / `clearSessionState`) — never on a cold-boot
 * failure path — so a fresh deliberate sign-in can re-probe the central IdP.
 * Clearing on cold-boot failure would reintroduce the redirect loop.
 *
 * No-ops off-web and on any storage failure (best-effort).
 */
function clearSsoBounceStateWeb(): void {
  if (!isWebBrowser()) return;
  try {
    const storage = window.sessionStorage;
    if (!storage) return;
    const origin = window.location.origin;
    storage.removeItem(ssoAttemptedKey(origin));
    storage.removeItem(ssoNoSessionKey(origin));
    storage.removeItem(ssoGuardKey(origin));
    storage.removeItem(ssoStateKey(origin));
    storage.removeItem(ssoDestKey(origin));
  } catch {
    // Best-effort; swallow SecurityError (e.g. Safari private mode).
  }
}

function isOnSsoCallbackPath(): boolean {
  return isWebBrowser() && window.location.pathname === SSO_CALLBACK_PATH;
}

const useBrowserLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

export interface WebOxyProviderProps {
  children: ReactNode;
  baseURL: string;
  /**
   * The FAPI (Federated Auth API / IdP) origin. When omitted, the provider
   * auto-detects `https://auth.<rp-domain>` from `window.location.hostname`
   * so an RP only needs to CNAME `auth.<rp-domain>` → the central IdP and
   * everything else (FedCM config URL, redirect URL) follows.
   * Pass explicitly to override (e.g. point at a staging IdP).
   */
  authWebUrl?: string;
  /**
   * The app's Oxy OAuth client id (ApplicationCredential publicKey). Used to
   * identify this app in OAuth authorize / consent flows (issue #214).
   *
   * Stored on `OxyServices.config.clientId` and surfaced on the web context as
   * `clientId`. Purely declarative — unrelated to the cross-domain
   * `/sso?client_id=<rp-origin>` bounce, which is left untouched.
   */
  clientId?: string;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: Error) => void;
  preferredAuthMethod?: 'auto' | 'fedcm' | 'redirect';
  skipAutoCheck?: boolean;
  /**
   * When `true`, skips ONLY the terminal `sso-bounce` cold-boot step — the
   * force-redirect to `auth.<apex>/sso?prompt=none` that fires for a visitor
   * with no recoverable local session. Every other cold-boot step still runs
   * (callback consume, FedCM silent, `/auth/silent` iframe, stored-session,
   * cookie-restore), so a returning signed-in user is still silently
   * restored; only the bounce for a truly anonymous visitor is suppressed.
   * This lets an app allow anonymous browsing instead of force-redirecting to
   * the central IdP. Default `false`.
   */
  disableAutoSso?: boolean;
}

/**
 * Web-only Oxy Provider
 *
 * Provides authentication context for pure web applications (React, Next.js, Vite).
 * Supports FedCM and redirect authentication methods.
 *
 * @example
 * ```tsx
 * import { WebOxyProvider, useAuth } from '@oxyhq/auth';
 *
 * function App() {
 *   return (
 *     <WebOxyProvider baseURL="https://api.oxy.so">
 *       <YourApp />
 *     </WebOxyProvider>
 *   );
 * }
 * ```
 */
export function WebOxyProvider({
  children,
  baseURL,
  authWebUrl,
  clientId: clientIdProp,
  onAuthStateChange,
  onError,
  preferredAuthMethod = 'auto',
  skipAutoCheck = false,
  disableAutoSso = false,
}: WebOxyProviderProps) {
  // Normalize the app's OAuth client id to a trimmed non-empty string, or
  // `null` when the consumer did not configure one. Surfaced on the web
  // context as `clientId` and stored on `OxyServices.config.clientId` for
  // later OAuth-authorize use (issue #214).
  const clientId = useMemo(() => {
    const trimmed = clientIdProp?.trim();
    return trimmed ? trimmed : null;
  }, [clientIdProp]);
  const [oxyServices] = useState(
    // Central cross-domain SSO targets ONE IdP (`auth.oxy.so`). Resolve the
    // auth web URL via the central default — an explicit `authWebUrl` still
    // wins (e.g. to point at a staging IdP). `clientId` is stored on the
    // config for later OAuth-authorize use; it does NOT affect SSO bounce.
    () => new OxyServices({
      baseURL,
      authWebUrl: resolveCentralAuthUrl(authWebUrl),
      clientId: clientIdProp?.trim() || undefined,
    })
  );
  const [crossDomainAuth] = useState(() => new CrossDomainAuth(oxyServices));
  // Web uses the cookie session model: refresh tokens live in httpOnly
  // `oxy_rt_${authuser}` cookies and access tokens live in-memory inside
  // the AuthManager registry. Token material is never persisted to
  // JS-accessible storage.
  const [authManager] = useState(() => createAuthManager(oxyServices, {
    autoRefresh: true,
  }));
  const [queryClient] = useState(() => createQueryClient());

  // Block first render until the persisted localStorage cache has been
  // restored — mirrors the RN OxyProvider pattern. Without this gate the
  // first paint observes an empty cache and any consumer reading
  // `getQueryData(...)` synchronously (or using `placeholderData: 'previous'`
  // gating) misses the persisted blob.
  //
  // Persistence is attached inside the same effect so we can hold a
  // reference to the `restored` promise and only flip `isRestoring` to
  // false once it settles (success OR failure). Detach on unmount so HMR
  // doesn't leak subscriptions.
  const [isRestoring, setIsRestoring] = useState(true);
  useEffect(() => {
    let mounted = true;
    const { restored, unsubscribe } = attachQueryPersistence(queryClient);
    restored.finally(() => {
      if (mounted) setIsRestoring(false);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [queryClient]);

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(!skipAutoCheck);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [ssoCallbackIntercepting, setSsoCallbackIntercepting] = useState(false);

  // Multi-account state — populated by the AuthManager cookie path
  // (`restoreFromCookies` / `switchAuthuser` / `signOutAuthuser`).
  const [accounts, setAccounts] = useState<AuthManagerAccount[]>([]);
  const [activeAuthuser, setActiveAuthuserState] = useState<number | null>(null);

  /**
   * Refresh the React-visible multi-account state from the AuthManager.
   * Called after every cookie-path operation so the UI sees the latest
   * snapshot atomically.
   */
  const syncAccountsFromManager = useCallback(() => {
    setAccounts(authManager.getAccounts());
    setActiveAuthuserState(authManager.getActiveAuthuser());
  }, [authManager]);

  // Derive the session list from `accounts`. Each `AuthManagerAccount`
  // becomes one `ClientSession` with `authuser` populated. The active slot
  // is flagged `isCurrent: true`.
  const sessions = useMemo<ClientSession[]>(() => {
    const now = new Date().toISOString();
    return accounts.map((account) => ({
      sessionId: account.sessionId,
      deviceId: '',
      expiresAt: account.expiresAt,
      lastActive: now,
      userId: account.user?.id ?? '',
      isCurrent: account.authuser === activeAuthuser,
      authuser: account.authuser,
    }));
  }, [accounts, activeAuthuser]);

  const isAuthenticated = !!user;

  // Mutex: prevents concurrent sign-in attempts (FedCM + redirect)
  const signingInRef = useRef(false);

  const handleAuthSuccess = useCallback(async (
    session: SessionLoginResponse,
    method: 'fedcm' | 'redirect' | 'credentials' = 'credentials'
  ) => {
    await authManager.handleAuthSuccess(session, method);

    if (session.sessionId) {
      setActiveSessionId(session.sessionId);
    }

    // Use the session user directly to avoid an extra API round-trip.
    // The session already contains user data from the auth exchange.
    setUser(session.user as User);
    setError(null);
    setIsLoading(false);

    // A fresh login appends a new device-local slot server-side (via
    // `Set-Cookie: oxy_rt_${n}`). Pull the canonical snapshot so the
    // multi-account state reflects the new slot AND any pre-existing
    // siblings whose cookies just rotated as part of the response.
    try {
      await authManager.restoreFromCookies();
    } catch {
      // The login itself succeeded — a follow-up restore failure must
      // not surface as an auth error. The single-session API still
      // works via the bearer token planted by `handleAuthSuccess`.
    }
    syncAccountsFromManager();
  }, [authManager, syncAccountsFromManager]);

  // `handleAuthSuccess` routed through a ref so the eager SSO-callback
  // interception effect (registered once with deps `[]`) can commit an `ok`
  // session without listing `handleAuthSuccess` as a dependency — which would
  // re-fire the effect on every callback-identity change. Assigned synchronously
  // on every render so the ref is populated before any effect fires.
  const handleAuthSuccessRef = useRef(handleAuthSuccess);
  handleAuthSuccessRef.current = handleAuthSuccess;

  const handleAuthError = useCallback((err: unknown) => {
    const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
    setError(errorMessage);
    setIsLoading(false);
    onError?.(err instanceof Error ? err : new Error(errorMessage));
  }, [onError]);

  /**
   * SSO return (cold-boot step 1).
   *
   * We may be back from a top-level bounce to the central IdP. Delegates the
   * entire security-critical CSRF/fragment-strip/state-check/exchange/dest-
   * restore/loop-breaker sequence to core's `consumeSsoReturn`, which is
   * byte-for-byte identical across `@oxyhq/auth` and `@oxyhq/services` (the
   * security-sensitive parts MUST NOT diverge). `consumeSsoReturn` is
   * COMMIT-FREE — it returns the exchanged session (or `null`) and never touches
   * UI/auth state — so this provider commits it AROUND the call: the cold-boot
   * post-runner switch (`'sso'` → `handleAuthSuccess`) and the bfcache
   * `pageshow` handler both consume the returned `SsoReturnSession | null`.
   *
   * Web-detection (`isWeb`) is wired to `isWebBrowser` so it matches the rest of
   * the provider exactly; storage / location / history default to the `window.*`
   * globals (the same surfaces the previous inline implementation used).
   *
   * CONCURRENCY: the eager SSO-callback interception effect and the cold-boot
   * `sso-return` step can both invoke this in the same tick (both fire on mount
   * when we land on the callback path). `consumeSsoReturn` strips the fragment
   * FIRST, so a naive second invocation would parse an already-stripped URL and
   * return `null` — leaving whichever caller lost the race with no session, which
   * on an `ok` outcome would let the cold-boot terminal bounce fire spuriously.
   * To make the two paths race-free, the FIRST call's promise is memoised in
   * `inFlightSsoReturnRef` and SHARED with every concurrent caller, so the single
   * `consumeSsoReturn` invocation's result (the exchanged session, or `null`) is
   * delivered identically to both the eager effect and the cold-boot step. The
   * shared promise is cleared once it settles so a later, genuinely-separate
   * return (e.g. a bfcache restore with a fresh fragment) runs a fresh pass.
   */
  const inFlightSsoReturnRef = useRef<Promise<SsoReturnSession | null> | null>(null);
  const runSsoReturn = useCallback((): Promise<SsoReturnSession | null> => {
    if (inFlightSsoReturnRef.current) {
      return inFlightSsoReturnRef.current;
    }
    const inFlight = consumeSsoReturn(oxyServices, {
      isWeb: isWebBrowser,
      onExchangeError: (err) =>
        logger.debug(
          'SSO code exchange failed (treating as no session)',
          { component: 'WebOxyProvider', method: 'runSsoReturn' },
          err,
        ),
    })
      .then((session): SsoReturnSession | null => (session ? { method: 'sso', session } : null))
      .finally(() => {
        inFlightSsoReturnRef.current = null;
      });
    inFlightSsoReturnRef.current = inFlight;
    return inFlight;
  }, [oxyServices]);

  // The cold-boot step references `runSsoReturn` through a ref because the
  // steps array is built inside the init effect, which must not list every
  // callback as a dependency (it would re-run the whole cold boot on each
  // callback identity change). Assigned synchronously on every render so the
  // ref is populated before the init effect (or the bfcache handler) fires.
  const runSsoReturnRef = useRef(runSsoReturn);
  runSsoReturnRef.current = runSsoReturn;

  /**
   * SSO bounce gate (cold-boot step 5 `enabled`).
   *
   * Only bounce when:
   *   - we are a top-level web document (never inside an iframe), AND
   *   - we are NOT sitting on the central IdP itself (never loop it), AND
   *   - the NO_SESSION flag is not set (a prior `none`/`error`/mismatch this
   *     page-session already proved there is no central session), AND
   *   - no fresh bounce guard is active (a bounce younger than the 30s TTL is
   *     in flight; a stale one self-heals).
   */
  const evaluateSsoBounce = useCallback((): boolean => {
    // Opt-out: when the consumer disabled auto-SSO, never bounce a
    // truly-anonymous visitor to the central IdP. All other restore steps
    // already ran, so a signed-in user is still recovered; only this
    // terminal force-bounce is suppressed.
    if (disableAutoSso) return false;
    if (!isWebBrowser() || window.top !== window.self) return false;
    const origin = window.location.origin;
    if (isCentralIdPOrigin(origin)) return false;
    if (window.sessionStorage.getItem(ssoNoSessionKey(origin)) === '1') return false;
    if (window.sessionStorage.getItem(ssoAttemptedKey(origin)) === '1') return false;
    if (guardActive(window.sessionStorage, origin)) return false;
    return true;
  }, [disableAutoSso]);

  /**
   * SSO bounce (cold-boot step 5 `run`). TERMINAL: navigates the top-level
   * document to the central IdP's `/sso` endpoint with `prompt=none`. The
   * document is torn down, so nothing after `window.location.assign` runs in
   * practice.
   */
  const runSsoBounce = useCallback((): void => {
    if (!isWebBrowser()) return;
    const origin = window.location.origin;

    const state = oxyServices.generateSsoState();
    window.sessionStorage.setItem(ssoStateKey(origin), state);
    window.sessionStorage.setItem(ssoGuardKey(origin), String(Date.now()));
    // Capture the real destination so it can be restored after the callback.
    window.sessionStorage.setItem(ssoDestKey(origin), window.location.href);
    // OUTCOME-INDEPENDENT once-guard: mark the probe attempted the instant we
    // commit to the bounce, so even if the callback never lands cleanly no
    // second bounce can ever fire this tab (the definitive loop breaker).
    window.sessionStorage.setItem(ssoAttemptedKey(origin), '1');

    // Honour an explicit `authWebUrl` override (e.g. a staging IdP) for the
    // SSO bounce exactly as it drives FedCM — mirroring the services
    // `OxyContext`, which builds from
    // `resolveCentralAuthUrl(oxyServices.config?.authWebUrl)`. The constructor
    // above already resolved `config.authWebUrl` to the central default when no
    // override was supplied, so reading it here is sufficient.
    window.location.assign(
      buildSsoBounceUrl(origin, state, oxyServices.config?.authWebUrl),
    );
  }, [oxyServices]);

  // Initialize
  useEffect(() => {
    if (skipAutoCheck) return;

    let mounted = true;

    const initAuth = async () => {
      // Cold boot — the single, ordered, short-circuit session-recovery
      // sequence, consuming the SAME `runColdBoot` core primitive as the
      // services `OxyContext`. The FIRST step that yields a session wins; every
      // later step is skipped. Step ids + guard logic mirror the services
      // provider EXACTLY (consistency mandate) even though `WebOxyProvider` is
      // web-only.
      //
      // Order (web):
      //   0. sso-return     — parse `window.location.hash`; on `ok` exchange the
      //                       opaque code via `oxyServices.exchangeSsoCode` and
      //                       commit; on `none`/`error` set the no-rebounce flag.
      //   1. fedcm-silent   — silent FedCM against the CENTRAL `auth.oxy.so`
      //                       (Chrome enhancement). Fires once per page load.
      //   2. cookie-restore — `authManager.initialize()` refresh-cookie restore;
      //                       first-party only on `*.oxy.so`, empty cross-domain.
      //                       Bounded by COOKIE_RESTORE_TIMEOUT (FIX D) so a
      //                       cross-domain stall cannot hang cold boot.
      //   3. sso-bounce     — TERMINAL top-level navigation to `auth.oxy.so/sso`.
      //
      // NOTE: the services `OxyContext` has an additional `stored-session`
      // bearer-restore step (native's ONLY restore path; in services it now also
      // runs BEFORE the slow web probes so a local reload wins fast — FIX A).
      // `WebOxyProvider` is web-only and cookie-only (it never persists a bearer
      // session to JS-accessible storage), so that step was a guaranteed no-op
      // here and has been dropped; the effective web restore is the cookie path
      // (step 3). The FIX-A reorder and FIX-B gating therefore do not apply here
      // (there is no stored-session step to move/gate); only the FIX-D
      // cookie-restore timeout is mirrored. The early `setIsLoading(false)` at
      // every commit site already gives WebOxyProvider FIX-C behaviour inherently
      // (each commit branch flips loading immediately; there is no
      // deferred-until-chain-completes gate to decouple).
      //
      // CRITICAL: `cookie-restore` MUST hydrate a REAL user before claiming a
      // session. A placeholder user (empty id) is never exposed (R4).
      const ssoKey = silentSignInKey(oxyServices);

      const steps: ReadonlyArray<ColdBootStep<ColdBootSession>> = [
        {
          // 0) SSO return: we are back from a top-level bounce to the central
          // IdP. Parse the fragment, validate state, exchange the opaque code.
          id: 'sso-return',
          enabled: () => isWebBrowser(),
          run: async () => {
            const session = await runSsoReturnRef.current();
            if (!session) return { kind: 'skip' };
            return { kind: 'session', session };
          },
        },
        {
          // 1) FedCM silent reauthn (Chrome) against the CENTRAL IdP
          // (`auth.oxy.so`). Fires `navigator.credentials.get` with
          // `mediation: 'silent'`, which must happen AT MOST ONCE per page
          // load — gate on the module-level run-once guard. This is the
          // FedCM-only silent path. Cross-domain restore on non-FedCM browsers is
          // owned by the `sso-bounce` step). Only runs where FedCM is supported.
          id: 'fedcm-silent',
          enabled: () =>
            isWebBrowser() &&
            oxyServices.isFedCMSupported() === true &&
            !fedcmSilentSignInAttempted.has(ssoKey),
          run: async () => {
            fedcmSilentSignInAttempted.add(ssoKey);
            const session = await oxyServices.silentSignInWithFedCM();
            if (!session?.user) return { kind: 'skip' };
            return {
              kind: 'session',
              session: { method: 'fedcm', session },
            };
          },
        },
        {
          // 2) Refresh-cookie restore. On `*.oxy.so` the httpOnly `oxy_rt_${n}`
          // cookies ride along and resurrect every device-local slot. On a
          // cross-domain RP (mention.earth, …) the cookie never reaches
          // `api.<apex>`, so `POST /auth/refresh-all` returns no accounts and
          // this skips. That is correct; the `sso-bounce` step handles it.
          id: 'cookie-restore',
          enabled: () => isWebBrowser(),
          run: async () => {
            // FIX-D: bound the cookie restore so a cross-domain/stalled
            // `refresh-all` cannot hang cold boot in front of the terminal
            // `/sso` bounce (see COOKIE_RESTORE_TIMEOUT).
            const restoredUser = await authManager.initialize({ timeout: COOKIE_RESTORE_TIMEOUT });
            if (!restoredUser) return { kind: 'skip' };
            try {
              const currentUser = await oxyServices.getCurrentUser();
              if (!currentUser) {
                // AuthManager claimed a restore but the bearer call returned
                // nothing — treat as a stale session.
                await authManager.signOutAllViaCookies();
                syncAccountsFromManager();
                return { kind: 'skip' };
              }
              const activeAccount = authManager.getActiveAccount();
              return {
                kind: 'session',
                session: {
                  method: 'cookie',
                  user: currentUser,
                  activeSessionId: activeAccount ? activeAccount.sessionId : null,
                },
              };
            } catch {
              // Bearer call failed even though AuthManager said it restored —
              // treat as a stale session and clear the cookie-backed slots.
              await authManager.signOutAllViaCookies();
              syncAccountsFromManager();
              return { kind: 'skip' };
            }
          },
        },
        {
          // 4) SSO bounce (TERMINAL, once). No local session was recovered by
          // any prior step. Navigate top-level to the central IdP's `/sso`
          // endpoint with `prompt=none`. The document is torn down, so `run`
          // returns `skip` only if `assign` no-ops (e.g. blocked navigation).
          id: 'sso-bounce',
          enabled: () => evaluateSsoBounce(),
          run: async () => {
            runSsoBounce();
            return { kind: 'skip' };
          },
        },
      ];

      const outcome: ColdBootOutcome<ColdBootSession> = await runColdBoot({
        steps,
        onStepError: (id, err) => {
          // Cold-boot step errors are the EXPECTED branch for logged-out
          // visitors and FedCM-less browsers — log at debug so they don't
          // spam the console every page load.
          logger.debug(
            'cold-boot step did not resolve a session',
            { component: 'WebOxyProvider', method: 'initAuth', step: id },
            err
          );
        },
      });

      if (!mounted) return;

      if (outcome.kind === 'unauthenticated') {
        setIsLoading(false);
        return;
      }

      // Reproduce today's exact per-branch commit.
      switch (outcome.session.method) {
        case 'redirect':
        case 'fedcm':
        case 'sso':
          await handleAuthSuccess(outcome.session.session, outcome.session.method === 'sso' ? 'credentials' : outcome.session.method);
          return;
        case 'cookie': {
          syncAccountsFromManager();
          if (outcome.session.activeSessionId) {
            setActiveSessionId(outcome.session.activeSessionId);
          }
          setUser(outcome.session.user);
          setIsLoading(false);
          return;
        }
      }
    };

    // Safety timeout: if all auth methods stall, stop loading
    const INIT_TIMEOUT_MS = 15_000;
    const timeoutId = setTimeout(() => {
      if (mounted) {
        setIsLoading(false);
      }
    }, INIT_TIMEOUT_MS);

    initAuth()
      .catch((err) => {
        // The post-runner commit (`handleAuthSuccess`) awaits a token plant
        // before it flips `setIsLoading(false)`. If anything throws BEFORE
        // that flip, the rejection would otherwise be unhandled and
        // `isLoading` would stay true until the 15s safety timeout. Route it
        // through the existing error handler so loading resets immediately.
        if (mounted) {
          handleAuthError(err);
        }
      })
      .finally(() => clearTimeout(timeoutId));

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [oxyServices, crossDomainAuth, authManager, skipAutoCheck, disableAutoSso, handleAuthSuccess, handleAuthError, syncAccountsFromManager, evaluateSsoBounce, runSsoBounce]);

  // bfcache restore handler — registered ONCE, OUTSIDE the cold boot.
  //
  // When the browser restores this page from the back/forward cache
  // (`pageshow` with `event.persisted === true`), React state is preserved but
  // the cold-boot effect does NOT re-run. If the user signed in on the central
  // IdP and hit "back", the restored page would otherwise miss the new session.
  // Re-run the `sso-return` parse so a pending `#oxy_sso=ok` fragment is
  // exchanged and committed, and re-evaluate the bounce gate so a now-stale
  // NO_SESSION/guard does not strand the page logged-out.
  useEffect(() => {
    if (!isWebBrowser()) return;

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;

      runSsoReturnRef.current()
        .then(async (session) => {
          if (session) {
            await handleAuthSuccess(session.session, 'credentials');
            return;
          }
          // No SSO return to commit. Re-evaluate the bounce gate: if a session
          // could now be recovered centrally (NO_SESSION cleared by a sign-in
          // elsewhere) and we have no local user, trigger one terminal bounce.
          if (!user && evaluateSsoBounce()) {
            runSsoBounce();
          }
        })
        .catch((err) => {
          logger.debug(
            'bfcache sso-return did not resolve a session',
            { component: 'WebOxyProvider', method: 'onPageShow' },
            err,
          );
        });
    };

    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [handleAuthSuccess, evaluateSsoBounce, runSsoBounce, user]);

  // EAGER, universal SSO-callback interception (web only, once on mount).
  //
  // When the central IdP redirects the RP back to the internal callback path
  // ({@link SSO_CALLBACK_PATH}), the app's own router would otherwise mount on
  // `/__oxy/sso-callback` — a route NO app declares — and briefly flash its
  // +not-found screen before the cold-boot `sso-return` step strips the fragment
  // and restores the real destination.
  //
  // This effect runs the SAME `runSsoReturn` kernel the instant we mount ON the
  // callback path, BEFORE the init effect's cold boot. The first render
  // intentionally matches the app/router's static HTML; the browser layout
  // effect then hides the internal route and consumes the callback before the
  // first visible paint. That keeps SSR/SSG hydration stable while still making
  // the SDK own `/__oxy/sso-callback` for every consumer.
  //
  // Purely ADDITIVE: the cold-boot `sso-return` step stays as defense-in-depth.
  // `consumeSsoReturn` strips the fragment first, so once this eager pass has run
  // the cold-boot step is a harmless idempotent no-op. The path guard scopes this
  // strictly to the callback path. Routed through `runSsoReturnRef` and
  // `handleAuthSuccessRef` so deps stay `[]` and it registers exactly once.
  useBrowserLayoutEffect(() => {
    if (!isOnSsoCallbackPath()) {
      setSsoCallbackIntercepting(false);
      return;
    }

    let mounted = true;
    setSsoCallbackIntercepting(true);
    runSsoReturnRef.current()
      .then(async (session) => {
        if (session) {
          await handleAuthSuccessRef.current(session.session, 'credentials');
        }
      })
      .catch((err) => {
        logger.debug(
          'Eager SSO callback interception failed (non-fatal)',
          { component: 'WebOxyProvider', method: 'eagerSsoCallbackIntercept' },
          err,
        );
      })
      .finally(() => {
        if (mounted) {
          setSsoCallbackIntercepting(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    onAuthStateChange?.(user);
  }, [user, onAuthStateChange]);

  const signIn = useCallback(async () => {
    if (signingInRef.current) {
      return;
    }

    signingInRef.current = true;
    setError(null);
    setIsLoading(true);

    let selectedMethod: 'fedcm' | 'redirect' = 'redirect';

    try {
      const session = await crossDomainAuth.signIn({
        method: preferredAuthMethod,
        onMethodSelected: (method) => {
          selectedMethod = method;
        },
      });

      if (session) {
        await handleAuthSuccess(session, selectedMethod);
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      signingInRef.current = false;
    }
  }, [crossDomainAuth, preferredAuthMethod, handleAuthSuccess, handleAuthError]);

  const signInWithFedCM = useCallback(async () => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setError(null);
    setIsLoading(true);
    try {
      const session = await crossDomainAuth.signInWithFedCM();
      await handleAuthSuccess(session, 'fedcm');
    } catch (err) {
      handleAuthError(err);
    } finally {
      signingInRef.current = false;
    }
  }, [crossDomainAuth, handleAuthSuccess, handleAuthError]);

  const signInWithRedirect = useCallback(() => {
    setError(null);
    crossDomainAuth.signInWithRedirect({
      redirectUri: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  }, [crossDomainAuth]);

  const isFedCMSupported = useCallback(() => {
    return crossDomainAuth.isFedCMSupported();
  }, [crossDomainAuth]);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      // Web is cookie-only: "sign out" clears every device-local slot.
      // The cookie endpoint clears every `oxy_rt_${n}` cookie via
      // `Set-Cookie` server-side AND revokes every refresh-token family.
      await authManager.signOutAllViaCookies();
      setUser(null);
      setActiveSessionId(null);
      syncAccountsFromManager();
      // EXPLICIT full sign-out (no slot remains): wipe the React Query cache —
      // BOTH the in-memory store AND the persisted `oxy_auth_query_cache_v2`
      // localStorage blob — so a prior user's cached profile/sessions/accounts
      // cannot flash on a shared browser before the network reconfirms. Runs
      // AFTER session teardown; no-ops safely off-web / when storage is blocked.
      clearQueryCache(queryClient);
      // EXPLICIT user sign-out: clear the per-origin SSO bounce state so a fresh
      // deliberate sign-in can re-probe the central IdP. Never done on a
      // cold-boot failure path (that would reintroduce the redirect loop).
      clearSsoBounceStateWeb();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sign out failed';
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }
  }, [authManager, onError, syncAccountsFromManager, queryClient]);

  const switchAccount = useCallback(async (authuser: number) => {
    setError(null);
    try {
      await authManager.switchAuthuser(authuser);
      const active = authManager.getActiveAccount();
      if (active) {
        setActiveSessionId(active.sessionId);
        // Fetch the canonical User shape with the freshly planted token —
        // the refresh-all projection is minimal (id/username/avatar/...)
        // and consumers expect the full User document.
        const currentUser = await oxyServices.getCurrentUser();
        if (currentUser) setUser(currentUser);
      }
      syncAccountsFromManager();
    } catch (err) {
      // `switchAuthuser` already dropped the dead slot from the registry;
      // re-sync so the chooser doesn't keep offering it.
      syncAccountsFromManager();
      handleAuthError(err);
    }
  }, [authManager, oxyServices, syncAccountsFromManager, handleAuthError]);

  const switchSession = useCallback(async (sessionId: string) => {
    // Resolve the `authuser` slot from the session id via the AuthManager
    // registry. If the requested session isn't one of ours (e.g. a stale
    // id from before a refresh), surface a clear error rather than
    // silently no-oping.
    const target = authManager.getAccounts().find((a) => a.sessionId === sessionId);
    if (!target) {
      handleAuthError(new Error(`Unknown session id: ${sessionId}`));
      return;
    }
    await switchAccount(target.authuser);
  }, [authManager, handleAuthError, switchAccount]);

  const signOutAccount = useCallback(async (authuser: number) => {
    setError(null);
    try {
      await authManager.signOutAuthuser(authuser);
      const active = authManager.getActiveAccount();
      if (active) {
        // Active slot may have changed (promoted lowest remaining) —
        // refresh the user / session state to match.
        setActiveSessionId(active.sessionId);
        try {
          const currentUser = await oxyServices.getCurrentUser();
          if (currentUser) setUser(currentUser);
        } catch {
          // Promoted slot's access token might be expired; the
          // AuthManager's auto-refresh will kick in shortly.
        }
      } else {
        // No slots left — fully signed out. This is the only `signOutAccount`
        // branch that wipes the React Query cache (in-memory + persisted blob):
        // when another slot is promoted active above, the remaining accounts'
        // cached data MUST be preserved, so the clear is scoped strictly to the
        // true full-sign-out case.
        setUser(null);
        setActiveSessionId(null);
        clearQueryCache(queryClient);
      }
      syncAccountsFromManager();
    } catch (err) {
      syncAccountsFromManager();
      handleAuthError(err);
    }
  }, [authManager, oxyServices, syncAccountsFromManager, handleAuthError, queryClient]);

  const signOutAll = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const clearSessionState = useCallback(async () => {
    await authManager.signOutAllViaCookies();
    setUser(null);
    setActiveSessionId(null);
    syncAccountsFromManager();
    // EXPLICIT full sign-out: wipe the React Query cache (in-memory + persisted
    // blob) so no prior identity data survives. Same rationale as `signOut`.
    clearQueryCache(queryClient);
    // EXPLICIT user sign-out (this provider has no cold-boot path that calls
    // this): clear the per-origin SSO bounce state so a fresh deliberate
    // sign-in can re-probe the central IdP.
    clearSsoBounceStateWeb();
  }, [authManager, syncAccountsFromManager, queryClient]);

  useEffect(() => {
    return () => { authManager.destroy(); };
  }, [authManager]);

  const contextValue = useMemo<WebOxyContextValue>(() => ({
    user,
    isAuthenticated,
    isLoading,
    error,
    clientId,
    activeSessionId,
    sessions,
    accounts,
    activeAuthuser,
    oxyServices,
    crossDomainAuth,
    authManager,
    signIn,
    signInWithFedCM,
    signInWithRedirect,
    signOut,
    isFedCMSupported,
    switchSession,
    switchAccount,
    signOutAccount,
    signOutAll,
    clearSessionState,
  }), [
    user, isAuthenticated, isLoading, error, clientId, activeSessionId, sessions,
    accounts, activeAuthuser,
    oxyServices, crossDomainAuth, authManager,
    signIn, signInWithFedCM, signInWithRedirect,
    signOut, isFedCMSupported, switchSession,
    switchAccount, signOutAccount, signOutAll, clearSessionState,
  ]);

  // Mirror the RN OxyProvider pattern: don't expose the QueryClient (or
  // mount children) until the persisted cache has been restored. On the
  // web this prevents the first paint from observing an empty
  // localStorage-backed cache, which would otherwise force every
  // identity/session/auth query to refetch from the network even when a
  // fresh blob was available on disk.
  //
  // The restored promise is wired with `.finally(...)` upstream, so this
  // unblocks on both success and failure within typically <50ms (sync
  // localStorage read + JSON.parse). A safety net is unnecessary: the
  // restore promise always settles synchronously after one microtask.
  if (isRestoring) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WebOxyContext.Provider value={contextValue}>
        {ssoCallbackIntercepting ? null : children}
      </WebOxyContext.Provider>
    </QueryClientProvider>
  );
}

/**
 * Hook to access the full Web Oxy context.
 */
export function useWebOxy(): WebOxyContextValue {
  const context = useContext(WebOxyContext);
  if (!context) {
    throw new Error('useWebOxy must be used within WebOxyProvider');
  }
  return context;
}

/**
 * Hook for authentication in web apps.
 *
 * @example
 * ```tsx
 * function LoginPage() {
 *   const { user, isAuthenticated, signIn, signOut } = useAuth();
 *   if (!isAuthenticated) return <button onClick={signIn}>Sign in</button>;
 *   return <button onClick={signOut}>Sign out</button>;
 * }
 * ```
 */
export function useAuth() {
  const ctx = useWebOxy();
  return {
    user: ctx.user,
    isAuthenticated: ctx.isAuthenticated,
    isLoading: ctx.isLoading,
    isReady: !ctx.isLoading,
    error: ctx.error,
    clientId: ctx.clientId,
    activeSessionId: ctx.activeSessionId,
    sessions: ctx.sessions,
    accounts: ctx.accounts,
    activeAuthuser: ctx.activeAuthuser,
    signIn: ctx.signIn,
    signInWithFedCM: ctx.signInWithFedCM,
    signInWithRedirect: ctx.signInWithRedirect,
    signOut: ctx.signOut,
    isFedCMSupported: ctx.isFedCMSupported,
    switchSession: ctx.switchSession,
    switchAccount: ctx.switchAccount,
    signOutAccount: ctx.signOutAccount,
    signOutAll: ctx.signOutAll,
    oxyServices: ctx.oxyServices,
    authManager: ctx.authManager,
  };
}

export default WebOxyProvider;
