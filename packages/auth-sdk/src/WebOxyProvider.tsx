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
} from '@oxyhq/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { attachQueryPersistence, createQueryClient } from './hooks/queryClient';

export interface WebAuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  activeSessionId: string | null;
  sessions: ClientSession[];
}

export interface WebAuthActions {
  signIn: () => Promise<void>;
  signInWithFedCM: () => Promise<void>;
  signInWithPopup: () => Promise<void>;
  signInWithRedirect: () => void;
  signOut: () => Promise<void>;
  isFedCMSupported: () => boolean;
  switchSession: (sessionId: string) => Promise<void>;
  clearSessionState: () => Promise<void>;
}

export interface WebOxyContextValue extends WebAuthState, WebAuthActions {
  oxyServices: OxyServices;
  crossDomainAuth: CrossDomainAuth;
  authManager: AuthManager;
}

const WebOxyContext = createContext<WebOxyContextValue | null>(null);

/**
 * Module-level run-once guard for the provider's silent sign-in step.
 *
 * The init effect runs again whenever the provider remounts (route change,
 * StrictMode double-invoke, error-boundary recovery). The redirect-callback
 * and local-session-restore steps are cheap and idempotent, but
 * `crossDomainAuth.silentSignIn()` is NOT: it first tries FedCM silent
 * mediation (`navigator.credentials.get`) and, if that yields nothing, falls
 * back to an iframe-based silent auth against `/auth/silent`.
 *
 * The FedCM leg is now centrally memoized inside `@oxyhq/core`'s
 * `silentSignInWithFedCM` (at-most-once `navigator.credentials.get` per page
 * load). The iframe fallback, however, is a SEPARATE mechanism the core guard
 * does not cover — without this guard a remount storm would create a hidden
 * iframe per remount. So this guard is intentionally retained to keep the
 * provider's WHOLE silent step run-once. Keyed on `origin + baseURL` to match
 * the core guard's keying (so the two stay in lockstep) and to survive
 * instance churn; never cleared because only a fresh page load can change the
 * IdP/iframe session state.
 */
const silentSignInAttempted = new Set<string>();

function silentSignInKey(oxyServices: OxyServices): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'no-origin';
  let baseURL = '';
  try {
    baseURL = oxyServices.getBaseURL();
  } catch {
    baseURL = '';
  }
  return `${origin}|${baseURL}`;
}

export interface WebOxyProviderProps {
  children: ReactNode;
  baseURL: string;
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
  const [oxyServices] = useState(() => new OxyServices({ baseURL, authWebUrl }));
  const [crossDomainAuth] = useState(() => new CrossDomainAuth(oxyServices));
  const [authManager] = useState(() => createAuthManager(oxyServices, { autoRefresh: true }));
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

  // Sessions array kept as constant empty for API compatibility.
  // Multi-session management is handled by @oxyhq/services (OxyContext) for RN apps.
  const sessions: ClientSession[] = [];

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
  }, [authManager]);

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
        const callbackSession = crossDomainAuth.handleRedirectCallback();
        if (callbackSession && mounted) {
          await handleAuthSuccess(callbackSession, 'redirect');
          return;
        }

        const restoredUser = await authManager.initialize();
        if (restoredUser && mounted) {
          try {
            const currentUser = await oxyServices.getCurrentUser();
            if (mounted && currentUser) {
              setUser(currentUser);
              setIsLoading(false);
              return;
            }
          } catch {
            await authManager.signOut();
          }
        }

        // Silent sign-in: run AT MOST ONCE per page load. A remount (route
        // change / StrictMode / error recovery) must not re-trigger the
        // browser credential request OR the iframe fallback. The FedCM leg is
        // additionally memoized in core; this guard also covers the iframe
        // fallback that core does not.
        const ssoKey = silentSignInKey(oxyServices);
        if (!silentSignInAttempted.has(ssoKey)) {
          silentSignInAttempted.add(ssoKey);
          try {
            const session = await crossDomainAuth.silentSignIn();
            if (mounted && session?.user) {
              await handleAuthSuccess(session, 'fedcm');
              return;
            }
          } catch {
            // Silent sign-in failed — resolve to unauthenticated below.
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

  const signIn = useCallback(async () => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setError(null);
    setIsLoading(true);

    let selectedMethod: 'fedcm' | 'popup' | 'redirect' = 'popup';

    try {
      const session = await crossDomainAuth.signIn({
        method: preferredAuthMethod,
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

  const signInWithPopup = useCallback(async () => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setError(null);
    setIsLoading(true);
    try {
      const session = await crossDomainAuth.signInWithPopup();
      await handleAuthSuccess(session, 'popup');
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
      await authManager.signOut();
      setUser(null);
      setActiveSessionId(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sign out failed';
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }
  }, [authManager, onError]);

  const switchSession = useCallback(async (sessionId: string) => {
    try {
      const result = await oxyServices.getTokenBySession(sessionId);
      if (result) {
        setActiveSessionId(sessionId);
        const currentUser = await oxyServices.getCurrentUser();
        if (currentUser) setUser(currentUser);
      }
    } catch (err) {
      handleAuthError(err);
    }
  }, [oxyServices, handleAuthError]);

  const clearSessionState = useCallback(async () => {
    await authManager.signOut();
    setUser(null);
    setActiveSessionId(null);
  }, [authManager]);

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
    clearSessionState,
  }), [
    user, isAuthenticated, isLoading, error, activeSessionId, sessions,
    oxyServices, crossDomainAuth, authManager,
    signIn, signInWithFedCM, signInWithPopup, signInWithRedirect,
    signOut, isFedCMSupported, switchSession, clearSessionState,
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
    signIn: ctx.signIn,
    signInWithFedCM: ctx.signInWithFedCM,
    signInWithPopup: ctx.signInWithPopup,
    signInWithRedirect: ctx.signInWithRedirect,
    signOut: ctx.signOut,
    isFedCMSupported: ctx.isFedCMSupported,
    switchSession: ctx.switchSession,
    oxyServices: ctx.oxyServices,
    authManager: ctx.authManager,
  };
}

export default WebOxyProvider;
