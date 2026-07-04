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
 * - Web: Automatic via the per-apex `/auth/silent` iframe + terminal `/sso` bounce (SDK cold boot)
 * - Native: Automatic via shared Keychain/Account Manager
 * - Manual sign-in: signIn() redirects to the IdP (web) or opens the auth sheet (native)
 */

import { useCallback, useState } from 'react';
import { useOxy } from '../context/OxyContext';
import type { User } from '@oxyhq/core';
import { isWebBrowser } from '../utils/isWebBrowser';
import { showSignInModal } from '../components/SignInModal';

export interface AuthState {
  /** Current authenticated user, null if not authenticated */
  user: User | null;

  /** Whether user is authenticated */
  isAuthenticated: boolean;

  /** Whether auth state is being determined (initial load) */
  isLoading: boolean;

  /** Whether the auth token is ready for API calls */
  isReady: boolean;

  /** Whether the current OxyServices instance currently holds an access token */
  hasAccessToken: boolean;

  /**
   * True only when auth cold-boot is resolved, the user is authenticated, and a
   * bearer token is available for private backend requests.
   */
  canUsePrivateApi: boolean;

  /**
   * True while the SDK is still resolving auth or an authenticated session is
   * waiting for its bearer token. Use this to hold private API screens in a
   * loading state instead of firing unauthenticated requests.
   */
  isPrivateApiPending: boolean;

  /**
   * Whether the initial auth determination has concluded.
   *
   * `false` from mount until the first cold-boot session restore finishes;
   * while `false`, `isAuthenticated: false` is UNDETERMINED (not a definitive
   * "logged out"). Flips to `true` once — when a session is committed or none
   * is found — and never reverts. Defer the first auth-dependent fetch until
   * this is `true` so a cold-boot reload with an existing session does not load
   * anonymous data.
   */
  isAuthResolved: boolean;

  /** Current error message, if any */
  error: string | null;
}

export interface AuthActions {
  /**
   * Sign in
   * - Web: Redirects to auth.oxy.so (no public key needed)
   * - Native: Uses cryptographic identity from keychain
   *
   * @param publicKey - Native: identity public key. Ignored on web.
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
  /** Open a bottom sheet screen (e.g. 'ManageAccount', 'FileManagement') */
  showBottomSheet: ReturnType<typeof useOxy>['showBottomSheet'];
  /** Open the avatar picker bottom sheet */
  openAvatarPicker: ReturnType<typeof useOxy>['openAvatarPicker'];
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
    hasAccessToken,
    canUsePrivateApi,
    isPrivateApiPending,
    isAuthResolved,
    error,
    signIn: oxySignIn,
    logout,
    logoutAll,
    refreshSessions,
    oxyServices,
    hasIdentity,
    getPublicKey,
    showBottomSheet,
    openAvatarPicker,
  } = useOxy();

  const signIn = useCallback(async (publicKey?: string): Promise<User> => {
    // Web (no key): open the in-app "Sign in with Oxy" modal. There is NO
    // automatic navigation to any login page — the device-first cold boot
    // already restored a session if one existed; an explicit click presents the
    // SDK sign-in surface (password / QR device flow / add account).
    if (isWebBrowser() && !publicKey) {
      showSignInModal();
      // Resolves when the modal commits a session; the caller typically reacts
      // to `isAuthenticated` rather than this promise.
      return new Promise<User>(() => undefined);
    }

    // Native: use the cryptographic identity directly when a public key is given.
    if (publicKey) {
      return oxySignIn(publicKey);
    }

    // Native with an existing keychain identity: sign in with it.
    const hasExisting = await hasIdentity();
    if (hasExisting) {
      const existingKey = await getPublicKey();
      if (existingKey) {
        return oxySignIn(existingKey);
      }
    }

    // Native with no identity: open the auth sheet (password / QR device flow).
    if (showBottomSheet) {
      showBottomSheet('OxyAuth');
      return new Promise((_, reject) => {
        reject(new Error('Please complete sign-in in the auth sheet'));
      });
    }

    throw new Error('No authentication method available');
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
    isLoading: isLoading || !isAuthResolved,
    isReady: isTokenReady,
    hasAccessToken,
    canUsePrivateApi,
    isPrivateApiPending,
    isAuthResolved,
    error,

    // Actions
    signIn,
    signOut,
    signOutAll,
    refresh,

    // Advanced
    oxyServices,
    showBottomSheet,
    openAvatarPicker,
  };
}
