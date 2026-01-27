/**
 * Web-Only Oxy Context
 *
 * Clean implementation with ZERO React Native dependencies.
 * Provides FedCM, popup, and redirect authentication methods.
 *
 * @module web/WebOxyContext
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { OxyServices } from '../core/OxyServices';
import { CrossDomainAuth } from '../core/CrossDomainAuth';
import type { User } from '../models/interfaces';
import type { SessionLoginResponse, MinimalUserData } from '../models/session';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../ui/hooks/queryClient';

// Storage keys
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'oxy_access_token',
  SESSION: 'oxy_session',
  USER: 'oxy_user',
} as const;

export interface WebAuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface WebAuthActions {
  /**
   * Sign in using the best available method (FedCM → Popup → Redirect)
   */
  signIn: () => Promise<void>;

  /**
   * Sign in using FedCM (browser-native, Google-style)
   * Falls back to popup if FedCM is not supported
   */
  signInWithFedCM: () => Promise<void>;

  /**
   * Sign in using popup window
   */
  signInWithPopup: () => Promise<void>;

  /**
   * Sign in using redirect (full page redirect to auth.oxy.so)
   */
  signInWithRedirect: () => void;

  /**
   * Sign out and clear session
   */
  signOut: () => Promise<void>;

  /**
   * Check if FedCM is supported in the current browser
   */
  isFedCMSupported: () => boolean;
}

export interface WebOxyContextValue extends WebAuthState, WebAuthActions {
  oxyServices: OxyServices;
  crossDomainAuth: CrossDomainAuth;
}

const WebOxyContext = createContext<WebOxyContextValue | null>(null);

export interface WebOxyProviderProps {
  children: ReactNode;
  /** Base URL for the Oxy API (e.g., 'https://api.oxy.so') */
  baseURL: string;
  /** Optional auth web URL for popup/redirect (defaults to 'https://auth.oxy.so') */
  authWebUrl?: string;
  /** Callback when auth state changes */
  onAuthStateChange?: (user: User | null) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Preferred auth method: 'auto' (default), 'fedcm', 'popup', or 'redirect' */
  preferredAuthMethod?: 'auto' | 'fedcm' | 'popup' | 'redirect';
  /** Skip automatic session check on mount */
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
 * import { WebOxyProvider, useAuth } from '@oxyhq/services/web';
 *
 * function App() {
 *   return (
 *     <WebOxyProvider baseURL="https://api.oxy.so">
 *       <YourApp />
 *     </WebOxyProvider>
 *   );
 * }
 *
 * function LoginButton() {
 *   const { signIn, isLoading, isFedCMSupported } = useAuth();
 *   return (
 *     <button onClick={signIn} disabled={isLoading}>
 *       {isFedCMSupported() ? 'Sign in with Oxy' : 'Sign in'}
 *     </button>
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
  // Initialize services
  const [oxyServices] = useState(() => new OxyServices({ baseURL, authWebUrl }));
  const [crossDomainAuth] = useState(() => new CrossDomainAuth(oxyServices));
  const [queryClient] = useState(() => createQueryClient());

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(!skipAutoCheck);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = !!user;

  /**
   * Stores session data in localStorage
   */
  const storeSession = useCallback((session: SessionLoginResponse) => {
    if (typeof window === 'undefined') return;

    try {
      if ((session as any).accessToken) {
        localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, (session as any).accessToken);
      }
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify({
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        expiresAt: session.expiresAt,
      }));
      if (session.user) {
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(session.user));
      }
    } catch (e) {
      // Storage might be full or blocked
    }
  }, []);

  /**
   * Clears session data from localStorage
   */
  const clearSession = useCallback(() => {
    if (typeof window === 'undefined') return;

    try {
      localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.SESSION);
      localStorage.removeItem(STORAGE_KEYS.USER);
    } catch (e) {
      // Ignore storage errors
    }
  }, []);

  /**
   * Handles successful authentication
   */
  const handleAuthSuccess = useCallback((session: SessionLoginResponse) => {
    storeSession(session);
    // Session user may be minimal data from auth, treat as User for state
    setUser(session.user as User);
    setError(null);
    setIsLoading(false);
  }, [storeSession]);

  /**
   * Handles authentication errors
   */
  const handleAuthError = useCallback((err: unknown) => {
    const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
    setError(errorMessage);
    setIsLoading(false);
    onError?.(err instanceof Error ? err : new Error(errorMessage));
  }, [onError]);

  // Initialize - check for existing session or redirect callback
  useEffect(() => {
    if (skipAutoCheck) return;

    let mounted = true;

    const initAuth = async () => {
      try {
        // 1. Check for redirect callback (user returning from auth.oxy.so)
        const callbackSession = crossDomainAuth.handleRedirectCallback();
        if (callbackSession && mounted) {
          handleAuthSuccess(callbackSession);
          return;
        }

        // 2. Try to restore session from localStorage
        const storedToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
        const storedUser = localStorage.getItem(STORAGE_KEYS.USER);

        if (storedToken && storedUser) {
          try {
            // Verify token is still valid by fetching current user
            const currentUser = await oxyServices.getCurrentUser();
            if (mounted && currentUser) {
              setUser(currentUser);
              setIsLoading(false);
              return;
            }
          } catch {
            // Token invalid, clear and continue
            clearSession();
          }
        }

        // 3. Try silent sign-in (FedCM or iframe-based SSO)
        try {
          const session = await crossDomainAuth.silentSignIn();
          if (mounted && session?.user) {
            handleAuthSuccess(session);
            return;
          }
        } catch {
          // Silent sign-in failed, that's fine
        }

        // No session found
        if (mounted) {
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      mounted = false;
    };
  }, [oxyServices, crossDomainAuth, skipAutoCheck, handleAuthSuccess, clearSession]);

  // Notify parent of auth state changes
  useEffect(() => {
    onAuthStateChange?.(user);
  }, [user, onAuthStateChange]);

  /**
   * Sign in with automatic method selection
   */
  const signIn = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      const session = await crossDomainAuth.signIn({
        method: preferredAuthMethod,
        onMethodSelected: (method) => {
          // Could emit an event here for analytics
        },
      });

      if (session) {
        handleAuthSuccess(session);
      } else {
        // Redirect method - page will reload
        setIsLoading(false);
      }
    } catch (err) {
      handleAuthError(err);
    }
  }, [crossDomainAuth, preferredAuthMethod, handleAuthSuccess, handleAuthError]);

  /**
   * Sign in with FedCM specifically
   */
  const signInWithFedCM = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      const session = await crossDomainAuth.signInWithFedCM();
      handleAuthSuccess(session);
    } catch (err) {
      handleAuthError(err);
    }
  }, [crossDomainAuth, handleAuthSuccess, handleAuthError]);

  /**
   * Sign in with popup specifically
   */
  const signInWithPopup = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      const session = await crossDomainAuth.signInWithPopup();
      handleAuthSuccess(session);
    } catch (err) {
      handleAuthError(err);
    }
  }, [crossDomainAuth, handleAuthSuccess, handleAuthError]);

  /**
   * Sign in with redirect specifically
   */
  const signInWithRedirect = useCallback(() => {
    setError(null);
    crossDomainAuth.signInWithRedirect({
      redirectUri: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  }, [crossDomainAuth]);

  /**
   * Check if FedCM is supported
   */
  const isFedCMSupported = useCallback(() => {
    return crossDomainAuth.isFedCMSupported();
  }, [crossDomainAuth]);

  /**
   * Sign out
   */
  const signOut = useCallback(async () => {
    setError(null);

    try {
      // Revoke FedCM credential if applicable
      if (isFedCMSupported()) {
        await (oxyServices as any).revokeFedCMCredential?.();
      }

      // Clear local storage
      clearSession();

      // Clear user state
      setUser(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sign out failed';
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }
  }, [oxyServices, clearSession, isFedCMSupported, onError]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<WebOxyContextValue>(() => ({
    // State
    user,
    isAuthenticated,
    isLoading,
    error,
    // Services
    oxyServices,
    crossDomainAuth,
    // Actions
    signIn,
    signInWithFedCM,
    signInWithPopup,
    signInWithRedirect,
    signOut,
    isFedCMSupported,
  }), [
    user,
    isAuthenticated,
    isLoading,
    error,
    oxyServices,
    crossDomainAuth,
    signIn,
    signInWithFedCM,
    signInWithPopup,
    signInWithRedirect,
    signOut,
    isFedCMSupported,
  ]);

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
 *
 * @returns Full context value including oxyServices and crossDomainAuth
 * @throws Error if used outside WebOxyProvider
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
 * Provides a simplified interface for common auth operations.
 *
 * @returns Auth state and actions
 * @throws Error if used outside WebOxyProvider
 *
 * @example
 * ```tsx
 * function LoginPage() {
 *   const { user, isAuthenticated, isLoading, signIn, signOut, isFedCMSupported } = useAuth();
 *
 *   if (isLoading) return <Spinner />;
 *
 *   if (isAuthenticated) {
 *     return (
 *       <div>
 *         <p>Welcome, {user.username}!</p>
 *         <button onClick={signOut}>Sign Out</button>
 *       </div>
 *     );
 *   }
 *
 *   return (
 *     <button onClick={signIn}>
 *       {isFedCMSupported() ? 'Sign in with Oxy' : 'Sign in'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useAuth() {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    signIn,
    signInWithFedCM,
    signInWithPopup,
    signInWithRedirect,
    signOut,
    isFedCMSupported,
    oxyServices,
  } = useWebOxy();

  return {
    // State
    user,
    isAuthenticated,
    isLoading,
    isReady: !isLoading,
    error,
    // Actions
    signIn,
    signInWithFedCM,
    signInWithPopup,
    signInWithRedirect,
    signOut,
    // Utilities
    isFedCMSupported,
    oxyServices,
  };
}

// Default export for convenience
export default WebOxyProvider;
