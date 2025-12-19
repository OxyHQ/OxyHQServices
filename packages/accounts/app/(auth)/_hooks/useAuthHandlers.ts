import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import type { OxyServices } from '@oxyhq/services';
import { useAuthStore } from '@oxyhq/services';
import { checkIfOffline } from '../_utils/networkUtils';
import { isNetworkOrTimeoutError, extractAuthErrorMessage, handleAuthError } from '../_utils/errorUtils';
import { STORE_UPDATE_DELAY_MS } from '../_constants';

interface UseAuthHandlersOptions {
  signIn: () => Promise<unknown>;
  oxyServices: OxyServices | null;
  usernameRef: React.MutableRefObject<string>;
  setAuthError: (error: string | null) => void;
  setSigningIn: (signingIn: boolean) => void;
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
}: UseAuthHandlersOptions) {
  const router = useRouter();
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false);

  /**
   * Handle sign-in with username update if available
   * 
   * Signs in the user and updates their profile with the username if:
   * - Username was provided
   * - Device is online
   * 
   * Updates the auth store and navigates to home screen on success
   */
  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    setAuthError(null);

    try {
      await signIn();

      // Now that we're authenticated, update profile with username if online
      const usernameToSave = usernameRef.current;
      if (usernameToSave && oxyServices) {
        try {
          // Check if online before trying to save username
          const offline = await checkIfOffline();
          if (!offline) {
            const updatedUser = await oxyServices.updateProfile({ username: usernameToSave });
            // Update authStore so home screen shows username immediately
            if (updatedUser) {
              useAuthStore.getState().setUser(updatedUser);
              // Small delay to ensure store update propagates before navigation
              await new Promise(resolve => setTimeout(resolve, STORE_UPDATE_DELAY_MS));
            }
          }
        } catch (err: unknown) {
          // Log but don't block - username can be set later
          if (!isNetworkOrTimeoutError(err)) {
            handleAuthError(err, 'updateProfile');
          }
        }
      }

      router.replace('/(tabs)');
    } catch (err: unknown) {
      setAuthError(extractAuthErrorMessage(err, 'Failed to sign in. Please try again.'));
    } finally {
      setSigningIn(false);
    }
  }, [router, signIn, oxyServices, usernameRef, setAuthError, setSigningIn]);

  /**
   * Handle notification permission request
   * 
   * Checks existing permissions first (fast path), then requests if needed.
   * Proceeds with sign-in regardless of permission result.
   */
  const handleRequestNotifications = useCallback(async () => {
    try {
      // Check permissions first (this is usually fast)
      const { status: existingStatus } = await Notifications.getPermissionsAsync();

      if (existingStatus === 'granted') {
        // Already granted, proceed directly to sign in
        await handleSignIn();
        return;
      }

      // Only show spinner when actually requesting permissions
      setIsRequestingNotifications(true);
      try {
        await Notifications.requestPermissionsAsync();
        await handleSignIn();
      } catch (err: unknown) {
        // Still proceed with sign in even if permission request fails
        handleAuthError(err, 'requestNotifications');
        await handleSignIn();
      } finally {
        setIsRequestingNotifications(false);
      }
    } catch (err: unknown) {
      // If permission check fails, proceed with sign in anyway
      handleAuthError(err, 'checkNotificationPermissions');
      setIsRequestingNotifications(true);
      try {
        await handleSignIn();
      } finally {
        setIsRequestingNotifications(false);
      }
    }
  }, [handleSignIn]);

  return {
    handleSignIn,
    handleRequestNotifications,
    isRequestingNotifications,
  };
}

