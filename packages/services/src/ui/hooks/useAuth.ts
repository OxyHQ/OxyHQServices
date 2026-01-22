/**
 * Unified Auth Hook
 *
 * Provides a clean, standard interface for authentication across all platforms.
 * This is the recommended way to access auth state in Oxy apps.
 *
 * Usage:
 * ```tsx
 * import { useAuth } from '@oxyhq/services';
 *
 * function MyComponent() {
 *   const { user, isAuthenticated, isLoading, signIn, signOut } = useAuth();
 *
 *   if (isLoading) return <Loading />;
 *   if (!isAuthenticated) return <SignInButton onClick={() => signIn()} />;
 *   return <Welcome user={user} />;
 * }
 * ```
 *
 * Cross-domain SSO:
 * - Web: Automatic via FedCM (Chrome 108+, Safari 16.4+)
 * - Native: Automatic via shared Keychain/Account Manager
 * - Manual sign-in: signIn() opens popup (web) or auth sheet (native)
 */

import { useCallback, useState } from 'react';
import { useOxy } from '../context/OxyContext';
import type { User } from '../../models/interfaces';
import { isWebBrowser } from './useWebSSO';

export interface AuthState {
  /** Current authenticated user, null if not authenticated */
  user: User | null;

  /** Whether user is authenticated */
  isAuthenticated: boolean;

  /** Whether auth state is being determined (initial load) */
  isLoading: boolean;

  /** Whether the auth token is ready for API calls */
  isReady: boolean;

  /** Current error message, if any */
  error: string | null;
}

export interface AuthActions {
  /**
   * Sign in
   * - Web: Opens popup to auth.oxy.so (no public key needed)
   * - Native: Uses cryptographic identity from keychain
   */
  signIn: (publicKey?: string) => Promise<User>;

  /**
   * Sign out current session
   */
  signOut: () => Promise<void>;

  /**
   * Sign out all sessions across all devices
   */
  signOutAll: () => Promise<void>;

  /**
   * Refresh auth state (re-check session validity)
   */
  refresh: () => Promise<void>;
}

export interface UseAuthReturn extends AuthState, AuthActions {
  /** Access to full OxyServices instance for advanced usage */
  oxyServices: ReturnType<typeof useOxy>['oxyServices'];
}

/**
 * Unified auth hook for all Oxy apps
 *
 * Features:
 * - Zero config: Just wrap with OxyProvider and use
 * - Cross-platform: Same API on native and web
 * - Auto SSO: Web apps automatically check for cross-domain sessions
 * - Type-safe: Full TypeScript support
 */
export function useAuth(): UseAuthReturn {
  const {
    user,
    isAuthenticated,
    isLoading,
    isTokenReady,
    error,
    signIn: oxySignIn,
    logout,
    logoutAll,
    refreshSessions,
    oxyServices,
    hasIdentity,
    getPublicKey,
    showBottomSheet,
  } = useOxy();

  const signIn = useCallback(async (publicKey?: string): Promise<User> => {
    // Check if we're on the identity provider itself (auth.oxy.so)
    // Only auth.oxy.so has local login forms - accounts.oxy.so is a client app
    const isIdentityProvider = isWebBrowser() &&
      window.location.hostname === 'auth.oxy.so';

    // Web (not on IdP): Use FedCM or popup-based authentication
    if (isWebBrowser() && !publicKey && !isIdentityProvider) {
      try {
        // Try FedCM first (instant if user already signed in)
        if ((oxyServices as any).isFedCMSupported?.()) {
          const fedcmSession = await (oxyServices as any).signInWithFedCM?.();
          if (fedcmSession?.user) {
            return fedcmSession.user;
          }
        }

        // Fallback to popup (opens auth.oxy.so in popup window)
        const popupSession = await (oxyServices as any).signInWithPopup?.();
        if (popupSession?.user) {
          return popupSession.user;
        }

        throw new Error('Sign-in failed');
      } catch (error) {
        // If popup blocked or FedCM failed, suggest redirect
        throw new Error(
          error instanceof Error && error.message.includes('blocked')
            ? 'Popup blocked. Please allow popups or try again.'
            : 'Sign-in failed. Please try again.'
        );
      }
    }

    // Native: Use cryptographic identity
    // If public key provided, use it directly
    if (publicKey) {
      return oxySignIn(publicKey);
    }

    // Try to get existing identity
    const hasExisting = await hasIdentity();

    if (hasExisting) {
      const existingKey = await getPublicKey();
      if (existingKey) {
        return oxySignIn(existingKey);
      }
    }

    // No identity - show auth UI
    if (showBottomSheet) {
      showBottomSheet('OxyAuth');
      // Return a promise that resolves when auth completes
      return new Promise((_, reject) => {
        reject(new Error('Please complete sign-in in the auth sheet'));
      });
    }

    // Web fallback: navigate to login page on auth domain
    if (isWebBrowser()) {
      const loginUrl = window.location.hostname.includes('oxy.so')
        ? '/login'
        : 'https://accounts.oxy.so/login';
      window.location.href = loginUrl;
      return new Promise(() => {}); // Never resolves, page will redirect
    }

    throw new Error('No authentication method available');
  }, [oxySignIn, hasIdentity, getPublicKey, showBottomSheet, oxyServices]);

  const signOut = useCallback(async (): Promise<void> => {
    await logout();
  }, [logout]);

  const signOutAll = useCallback(async (): Promise<void> => {
    await logoutAll();
  }, [logoutAll]);

  const refresh = useCallback(async (): Promise<void> => {
    await refreshSessions();
  }, [refreshSessions]);

  return {
    // State
    user,
    isAuthenticated,
    isLoading,
    isReady: isTokenReady,
    error,

    // Actions
    signIn,
    signOut,
    signOutAll,
    refresh,

    // Advanced
    oxyServices,
  };
}

// Re-export useOxy for backward compatibility and advanced usage
export { useOxy } from '../context/OxyContext';
