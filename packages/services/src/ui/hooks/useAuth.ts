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
 */

import { useCallback } from 'react';
import { useOxy } from '../context/OxyContext';
import type { User } from '../../models/interfaces';

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
   * Sign in with cryptographic identity
   * On native: Uses device keychain
   * On web: Opens auth popup/redirect
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
    // On native: shows bottom sheet for identity creation
    // On web: could trigger popup auth
    showBottomSheet?.('OxyAuth');

    // Return a promise that resolves when auth completes
    // This is a simplified version - real implementation would
    // wait for the auth flow to complete
    return new Promise((resolve, reject) => {
      // For now, just reject - the bottom sheet handles the flow
      reject(new Error('Please complete sign-in in the auth sheet'));
    });
  }, [oxySignIn, hasIdentity, getPublicKey, showBottomSheet]);

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
