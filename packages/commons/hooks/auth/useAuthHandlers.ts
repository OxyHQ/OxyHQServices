import { useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import type { OxyServices, User } from '@oxyhq/core';
import { KeyManager } from '@oxyhq/core';
import { useAuthStore, useUpdateProfile } from '@oxyhq/services';
import { checkIfOffline } from '@/utils/auth/networkUtils';
import { isNetworkOrTimeoutError, extractAuthErrorMessage, handleAuthError } from '@/utils/auth/errorUtils';
import { STORE_UPDATE_DELAY_MS } from '@/constants/auth';
import { useTranslation } from '@/lib/i18n';

/**
 * Check if running in Expo Go
 * 
 * Push notifications are not available in Expo Go (SDK 53+),
 * so we skip notification permission requests in this environment
 */
const isExpoGo = (): boolean => {
  try {
    return Constants.executionEnvironment === 'storeClient';
  } catch {
    return false;
  }
};

interface UseAuthHandlersOptions {
  /** The session sign-in function from `useOxy()`. */
  signIn: (publicKey: string, deviceName?: string) => Promise<User>;
  oxyServices: OxyServices | null;
  usernameRef: React.MutableRefObject<string>;
  setAuthError: (error: string | null) => void;
  setSigningIn: (signingIn: boolean) => void;
  isAuthenticated: boolean;
}

/**
 * Hook for shared authentication handlers (sign in, notifications)
 * 
 * Provides reusable handlers for sign-in and notification permission requests
 * that are shared between create-identity and import-identity flows
 * 
 * @param options - Configuration options
 * @returns Handlers and state for authentication flow
 */
export function useAuthHandlers({
  signIn,
  oxyServices,
  usernameRef,
  setAuthError,
  setSigningIn,
  isAuthenticated,
}: UseAuthHandlersOptions) {
  const router = useRouter();
  const { t } = useTranslation();
  const updateProfile = useUpdateProfile();
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false);
  
  // Constants for retry logic
  const SIGN_IN_RETRY_DELAY_MS = 500;
  const MAX_SIGN_IN_RETRIES = 1;
  const AUTH_STATE_CHECK_INTERVAL_MS = 100;
  const MAX_AUTH_STATE_WAIT_MS = 3000;

  /**
   * Wait for authentication state to be confirmed
   * 
   * Polls the auth store to ensure isAuthenticated is true before proceeding
   * This ensures the auth state is fully propagated before navigation
   * 
   * Note: Always polls the store directly to get the latest state, even if
   * the prop suggests authentication status
   */
  const waitForAuthState = useCallback(async (): Promise<boolean> => {
    // Check initial state from store
    const initialAuthState = useAuthStore.getState();
    if (initialAuthState.isAuthenticated) {
      return true;
    }

    // Poll auth store for authentication state
    const startTime = Date.now();
    return new Promise<boolean>((resolve) => {
      const checkAuth = () => {
        const authState = useAuthStore.getState();
        if (authState.isAuthenticated) {
          resolve(true);
          return;
        }

        // Timeout after max wait time
        if (Date.now() - startTime >= MAX_AUTH_STATE_WAIT_MS) {
          // Even if timeout, resolve true to allow navigation
          // Offline sign-in might not immediately update isAuthenticated
          // but sign-in was successful, so we proceed
          resolve(true);
          return;
        }

        // Check again after interval
        setTimeout(checkAuth, AUTH_STATE_CHECK_INTERVAL_MS);
      };

      checkAuth();
    });
  }, []);

  /**
   * Handle sign-in with retry logic and username update
   * 
   * Signs in the user with retry logic for network errors:
   * - Retries once if network error occurs
   * - Updates profile with username if online
   * - Waits for auth state to be confirmed before navigation
   * 
   * Updates the auth store and navigates to home screen on success
   */
  const completeSignIn = useCallback(async (options?: { navigateOnSuccess?: boolean }): Promise<boolean> => {
    setSigningIn(true);
    setAuthError(null);

    let lastError: unknown = null;
    let signInSuccess = false;

    // The session sign-in requires the device's public key as the identity
    // credential; resolve it from the local KeyManager before authenticating.
    // `getPublicKey()` now THROWS `IdentityUnavailableError` when storage is
    // locked/unreadable (as opposed to returning `null` for a genuine absence) —
    // catch it so a momentarily-locked keystore surfaces a retriable error
    // rather than the misleading "No identity found on this device".
    let publicKey: string | null;
    try {
      publicKey = await KeyManager.getPublicKey();
    } catch (error: unknown) {
      setAuthError(extractAuthErrorMessage(error, t('auth.errors.couldNotReadIdentity')));
      setSigningIn(false);
      return false;
    }
    if (!publicKey) {
      setAuthError(t('auth.errors.noIdentityFound'));
      setSigningIn(false);
      return false;
    }

    // Retry logic for sign-in
    for (let attempt = 0; attempt <= MAX_SIGN_IN_RETRIES; attempt++) {
      try {
        await signIn(publicKey);
        signInSuccess = true;
        break;
      } catch (err: unknown) {
        lastError = err;
        const isNetworkError = isNetworkOrTimeoutError(err);

        // If network error and we have retries left, wait and retry
        if (isNetworkError && attempt < MAX_SIGN_IN_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, SIGN_IN_RETRY_DELAY_MS));
          continue;
        }

        // If not a network error or no retries left, throw
        if (!isNetworkError) {
          throw err;
        }
      }
    }

    // If connecting the identity failed after retries, show error
    if (!signInSuccess) {
      setAuthError(extractAuthErrorMessage(lastError, "Couldn't connect your identity. Please try again."));
      setSigningIn(false);
      return false;
    }

    // Wait for auth state to be confirmed
    await waitForAuthState();

    // Now that we're authenticated, update profile with username if online
    const usernameToSave = usernameRef.current;
    if (usernameToSave && oxyServices) {
      try {
        const offline = await checkIfOffline();
        if (!offline) {
          await updateProfile.mutateAsync({ username: usernameToSave });
        }
      } catch (err: unknown) {
        // Log but don't block - username can be set later
        if (!isNetworkOrTimeoutError(err)) {
          handleAuthError(err, 'updateProfile');
        }
      }
    }

    // Small delay to ensure auth state is fully propagated
    await new Promise(resolve => setTimeout(resolve, STORE_UPDATE_DELAY_MS));

    // Clear all auth flow state BEFORE navigation to prevent overlay/opacity issues
    setAuthError(null);
    setSigningIn(false);
    
    // Use requestAnimationFrame to ensure state updates are applied before navigation
    await new Promise(resolve => requestAnimationFrame(resolve));

    if (options?.navigateOnSuccess !== false) {
      // Navigate to the post-auth tab shell - use push as per Expo Router standard
      router.push('/(tabs)/(id)');
    }

    return true;
  }, [router, signIn, oxyServices, usernameRef, setAuthError, setSigningIn, waitForAuthState, updateProfile, t]);

  const handleSignIn = useCallback(async () => {
    await completeSignIn({ navigateOnSuccess: true });
  }, [completeSignIn]);

  /**
   * Handle notification permission request and complete onboarding
   * User should already be authenticated at this point
   */
  const handleRequestNotifications = useCallback(async () => {
    if (!isAuthenticated) {
      const signedIn = await completeSignIn({ navigateOnSuccess: false });
      if (!signedIn || !useAuthStore.getState().isAuthenticated) {
        return;
      }
    }

    if (isExpoGo()) {
      router.push('/(tabs)/(id)');
      return;
    }

    try {
      setIsRequestingNotifications(true);
      setAuthError(null);

      const Notifications: typeof import('expo-notifications') = await import('expo-notifications');
      const { status: existingStatus } = await Notifications.getPermissionsAsync();

      if (existingStatus === 'granted') {
        router.push('/(tabs)/(id)');
        return;
      }

      await Notifications.requestPermissionsAsync();
      router.push('/(tabs)/(id)');
    } catch (err: unknown) {
      handleAuthError(err, 'requestNotifications');
      router.push('/(tabs)/(id)');
    } finally {
      setIsRequestingNotifications(false);
    }
  }, [isAuthenticated, router, setAuthError, completeSignIn]);

  return {
    handleSignIn,
    handleRequestNotifications,
    isRequestingNotifications,
  };
}

