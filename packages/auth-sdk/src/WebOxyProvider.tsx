/**
 * @oxyhq/auth — Web Authentication Provider
 *
 * Clean implementation with ZERO React Native dependencies.
 * Provides FedCM, popup, and redirect authentication methods.
 * Uses centralized AuthManager for token and session management.
 */

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
import {
  OxyServices,
  CrossDomainAuth,
  AuthManager,
  createAuthManager,
} from '@oxyhq/core';
import type {
  User,
  SessionLoginResponse,
  ClientSession,
  AuthManagerAccount,
} from '@oxyhq/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { attachQueryPersistence, createQueryClient } from './hooks/queryClient';
import { autoDetectAuthWebUrl } from './utils/fapiAutoDetect';

export interface WebAuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  activeSessionId: string | null;
  /**
   * Legacy multi-session shape kept for API compatibility with downstream
   * consumers. Derived from `accounts` — every `AuthManagerAccount` is
   * projected into a `ClientSession` with `authuser` populated. New
   * consumers should prefer `accounts` directly.
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
   * Sign in via the preferred method (auto / fedcm / popup / redirect).
   *
   * @param preOpenedPopup - A popup the caller opened SYNCHRONOUSLY on the
   *   raw click via `oxyServices.openBlankPopup()` (or
   *   `crossDomainAuth.openBlankPopup()`). Required to defeat Chrome's
   *   popup blocker when any prior `await` (FedCM / silent SSO) has consumed
   *   the transient user activation.
   */
  signIn: (preOpenedPopup?: Window | null) => Promise<void>;
  signInWithFedCM: () => Promise<void>;
  /**
   * @param preOpenedPopup - See `signIn`. Required for cross-domain reliability.
   */
  signInWithPopup: (preOpenedPopup?: Window | null) => Promise<void>;
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
 * Module-level run-once guard for FedCM silent sign-in.
 *
 * The init effect runs again whenever the provider remounts (route change,
 * StrictMode double-invoke, error-boundary recovery). The redirect-callback
 * and local-session-restore steps are cheap and idempotent, but the FedCM
 * `silentSignIn()` step triggers `navigator.credentials.get`, which must fire
 * AT MOST ONCE per page load — otherwise a remount storm becomes a credential
 * request storm. Keyed by origin so the guard survives instance churn; never
 * cleared because only a fresh page load can change the IdP session state.
 */
const fedcmSilentSignInAttempted = new Set<string>();

function silentSignInKey(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'no-origin';
}

export interface WebOxyProviderProps {
  children: ReactNode;
  baseURL: string;
  /**
   * The FAPI (Federated Auth API / IdP) origin. When omitted, the provider
   * auto-detects `https://auth.<rp-domain>` from `window.location.hostname`
   * so an RP only needs to CNAME `auth.<rp-domain>` → the central IdP and
   * everything else (FedCM config URL, popup target, redirect URL) follows.
   * Pass explicitly to override (e.g. point at a staging IdP).
   */
  authWebUrl?: string;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: Error) => void;
  preferredAuthMethod?: 'auto' | 'fedcm' | 'popup' | 'redirect';
  skipAutoCheck?: boolean;
}

/**
 * Web-only Oxy Provider
 *
 * Provides authentication context for pure web applications (React, Next.js, Vite).
 * Supports FedCM, popup, and redirect authentication methods.
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
  onAuthStateChange,
  onError,
  preferredAuthMethod = 'auto',
  skipAutoCheck = false,
}: WebOxyProviderProps) {
  const [oxyServices] = useState(
    () => new OxyServices({ baseURL, authWebUrl: authWebUrl ?? autoDetectAuthWebUrl() })
  );
  const [crossDomainAuth] = useState(() => new CrossDomainAuth(oxyServices));
  // Web is cookie-only by design: refresh tokens live in httpOnly
  // `oxy_rt_${authuser}` cookies and access tokens live in-memory inside
  // the AuthManager registry. The legacy localStorage path
  // (`oxy_access_token` / `oxy_refresh_token` / `oxy_session`) is OFF on
  // the web — we never persist token material to JS-accessible storage.
  const [authManager] = useState(() => createAuthManager(oxyServices, {
    autoRefresh: true,
    cookieOnly: true,
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

  // Multi-account state — populated by the AuthManager cookie path
  // (`restoreFromCookies` / `switchAuthuser` / `signOutAuthuser`). `sessions`
  // is derived from `accounts` for backwards compatibility with the
  // pre-multi-account API.
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

  // Derive the legacy `sessions: ClientSession[]` shape from `accounts` so
  // existing consumers reading `useAuth().sessions` keep working. Each
  // `AuthManagerAccount` becomes one `ClientSession` with `authuser`
  // populated. The active slot is flagged `isCurrent: true`.
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

  // Mutex: prevents concurrent sign-in attempts (FedCM + popup + redirect)
  const signingInRef = useRef(false);

  const handleAuthSuccess = useCallback(async (
    session: SessionLoginResponse,
    method: 'fedcm' | 'popup' | 'redirect' | 'credentials' = 'credentials'
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

  const handleAuthError = useCallback((err: unknown) => {
    const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
    setError(errorMessage);
    setIsLoading(false);
    onError?.(err instanceof Error ? err : new Error(errorMessage));
  }, [onError]);

  // Initialize
  useEffect(() => {
    if (skipAutoCheck) return;

    let mounted = true;

    const initAuth = async () => {
      try {
        // 1) Redirect callback wins: an in-flight popup/redirect flow just
        // landed back on this page with a session payload. Honour it
        // unconditionally before touching FedCM or cookies.
        const callbackSession = crossDomainAuth.handleRedirectCallback();
        if (callbackSession && mounted) {
          await handleAuthSuccess(callbackSession, 'redirect');
          return;
        }

        // 2) FedCM-first cold boot. The IdP at auth.oxy.so owns the
        // canonical session for the entire Oxy ecosystem; consumer RPs
        // (mention.earth, alia.onl, homiio.com, …) deliberately hold NO
        // long-lived session state. On every cold boot we ask the
        // browser's FedCM API (`mediation: 'silent'`) to reauthenticate
        // the user from the IdP. This is the SAME pattern Clerk uses with
        // its per-app FAPI domain and the W3C FedCM 2026 spec endorses.
        //
        // Why FedCM-first (not cookie-first):
        //   - Cookies are scoped to a single eTLD+1 — they never restore
        //     a cross-domain session. FedCM does.
        //   - The cookie path runs `POST /auth/refresh-all` and silently
        //     returns `{accounts: []}` whenever the cookie didn't ride
        //     along (cross-domain, third-party-cookie blocking, fresh
        //     browser), wasting the one shot we have at FedCM silent
        //     reauthn for that page load.
        //   - The legacy `Set-Cookie: oxy_rt_*` flow is being retired
        //     (Phase 2 marks it `Deprecation:` + `Sunset:`; Phase 3
        //     deletes it). FedCM-first is the forward-compatible default.
        //
        // The guard `fedcmSilentSignInAttempted` is keyed on
        // `origin+baseURL` and lives at module scope so React StrictMode
        // double-invokes, navigations within the same SPA, and HMR all
        // share the same one-shot budget.
        const ssoKey = silentSignInKey();
        if (!fedcmSilentSignInAttempted.has(ssoKey)) {
          fedcmSilentSignInAttempted.add(ssoKey);
          try {
            const session = await crossDomainAuth.silentSignIn();
            if (mounted && session?.user) {
              await handleAuthSuccess(session, 'fedcm');
              return;
            }
          } catch {
            // Silent sign-in didn't resolve — fall through to the
            // (transitional) cookie path. A FedCM rejection is the
            // expected branch for first-time visitors and for browsers
            // that don't implement FedCM yet.
          }
        }

        // 3) Cookie-path restore (transitional — will be removed in
        // Phase 3 once FedCM silent reauthn has soaked in prod). When
        // the IdP cookie is present in *this* origin's cookie jar
        // (i.e. the user is on `auth.oxy.so` itself, or an RP that
        // still shares the `oxy.so` cookie domain), `POST
        // /auth/refresh-all` resurrects every device-local slot.
        const restoredUser = await authManager.initialize();
        if (restoredUser && mounted) {
          syncAccountsFromManager();
          const activeAccount = authManager.getActiveAccount();
          if (activeAccount) {
            setActiveSessionId(activeAccount.sessionId);
          }
          try {
            const currentUser = await oxyServices.getCurrentUser();
            if (mounted && currentUser) {
              setUser(currentUser);
              setIsLoading(false);
              return;
            }
          } catch {
            // The bearer call failed even though the AuthManager said it
            // had restored — treat as a stale session and fall through to
            // unauthenticated. Use the cookie-path sign-out so we don't
            // touch the legacy localStorage keys.
            await authManager.signOutAllViaCookies();
            syncAccountsFromManager();
          }
        }

        if (mounted) setIsLoading(false);
      } catch {
        if (mounted) setIsLoading(false);
      }
    };

    // Safety timeout: if all auth methods stall, stop loading
    const INIT_TIMEOUT_MS = 15_000;
    const timeoutId = setTimeout(() => {
      if (mounted) {
        setIsLoading(false);
      }
    }, INIT_TIMEOUT_MS);

    initAuth().finally(() => clearTimeout(timeoutId));

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [oxyServices, crossDomainAuth, authManager, skipAutoCheck, handleAuthSuccess]);

  useEffect(() => {
    onAuthStateChange?.(user);
  }, [user, onAuthStateChange]);

  const signIn = useCallback(async (preOpenedPopup?: Window | null) => {
    if (signingInRef.current) {
      // Already signing in — the popup the caller just opened is now orphaned.
      // Close it to avoid leaving a blank window on screen.
      if (preOpenedPopup && !preOpenedPopup.closed) {
        preOpenedPopup.close();
      }
      return;
    }

    // Open the popup SYNCHRONOUSLY in the user-gesture event handler BEFORE
    // any `await` runs. `signIn` is async and the auto-method path awaits
    // FedCM first — without this, the transient user-activation is consumed
    // by FedCM's `navigator.credentials.get` and Chrome blocks the popup. If
    // the caller already pre-opened one (e.g. their own click handler did so
    // for safety), reuse it. Method-specific entry points (`fedcm`,
    // `redirect`) don't need a popup, so we skip the open in those cases.
    let popup: Window | null = preOpenedPopup ?? null;
    if (
      !popup &&
      typeof window !== 'undefined' &&
      preferredAuthMethod !== 'fedcm' &&
      preferredAuthMethod !== 'redirect'
    ) {
      popup = oxyServices.openBlankPopup();
    }

    signingInRef.current = true;
    setError(null);
    setIsLoading(true);

    let selectedMethod: 'fedcm' | 'popup' | 'redirect' = 'popup';

    try {
      const session = await crossDomainAuth.signIn({
        method: preferredAuthMethod,
        popup,
        onMethodSelected: (method) => {
          selectedMethod = method as 'fedcm' | 'popup' | 'redirect';
        },
      });

      if (session) {
        await handleAuthSuccess(session, selectedMethod);
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      if (popup && !popup.closed) {
        popup.close();
      }
      handleAuthError(err);
    } finally {
      signingInRef.current = false;
    }
  }, [oxyServices, crossDomainAuth, preferredAuthMethod, handleAuthSuccess, handleAuthError]);

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

  const signInWithPopup = useCallback(async (preOpenedPopup?: Window | null) => {
    if (signingInRef.current) {
      if (preOpenedPopup && !preOpenedPopup.closed) {
        preOpenedPopup.close();
      }
      return;
    }

    // Open the popup SYNCHRONOUSLY before any `await` (see `signIn` for the
    // rationale). The mixin's own `window.open` runs AFTER React state
    // updates and the await chain, which in some browsers is already enough
    // to lose the transient user-activation.
    let popup: Window | null = preOpenedPopup ?? null;
    if (!popup && typeof window !== 'undefined') {
      popup = oxyServices.openBlankPopup();
    }

    signingInRef.current = true;
    setError(null);
    setIsLoading(true);
    try {
      const session = await crossDomainAuth.signInWithPopup({
        popup,
      });
      await handleAuthSuccess(session, 'popup');
    } catch (err) {
      if (popup && !popup.closed) {
        popup.close();
      }
      handleAuthError(err);
    } finally {
      signingInRef.current = false;
    }
  }, [oxyServices, crossDomainAuth, handleAuthSuccess, handleAuthError]);

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
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sign out failed';
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }
  }, [authManager, onError, syncAccountsFromManager]);

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
        // No slots left — fully signed out.
        setUser(null);
        setActiveSessionId(null);
      }
      syncAccountsFromManager();
    } catch (err) {
      syncAccountsFromManager();
      handleAuthError(err);
    }
  }, [authManager, oxyServices, syncAccountsFromManager, handleAuthError]);

  const signOutAll = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const clearSessionState = useCallback(async () => {
    await authManager.signOutAllViaCookies();
    setUser(null);
    setActiveSessionId(null);
    syncAccountsFromManager();
  }, [authManager, syncAccountsFromManager]);

  useEffect(() => {
    return () => { authManager.destroy(); };
  }, [authManager]);

  const contextValue = useMemo<WebOxyContextValue>(() => ({
    user,
    isAuthenticated,
    isLoading,
    error,
    activeSessionId,
    sessions,
    accounts,
    activeAuthuser,
    oxyServices,
    crossDomainAuth,
    authManager,
    signIn,
    signInWithFedCM,
    signInWithPopup,
    signInWithRedirect,
    signOut,
    isFedCMSupported,
    switchSession,
    switchAccount,
    signOutAccount,
    signOutAll,
    clearSessionState,
  }), [
    user, isAuthenticated, isLoading, error, activeSessionId, sessions,
    accounts, activeAuthuser,
    oxyServices, crossDomainAuth, authManager,
    signIn, signInWithFedCM, signInWithPopup, signInWithRedirect,
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
        {children}
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
    activeSessionId: ctx.activeSessionId,
    sessions: ctx.sessions,
    accounts: ctx.accounts,
    activeAuthuser: ctx.activeAuthuser,
    signIn: ctx.signIn,
    signInWithFedCM: ctx.signInWithFedCM,
    signInWithPopup: ctx.signInWithPopup,
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
