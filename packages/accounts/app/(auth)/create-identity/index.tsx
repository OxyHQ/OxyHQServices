import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useOxy, useAuthStore } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { CreatingStep } from '@/components/auth/CreatingStep';
import { checkIfOffline } from '@/utils/auth/networkUtils';
import { extractAuthErrorMessage, isNetworkOrTimeoutError } from '@/utils/auth/errorUtils';
import { CREATING_PROGRESS_INTERVAL_MS, CREATING_FINAL_DELAY_MS } from '@/constants/auth';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { Colors } from '@/constants/theme';

/**
 * Create Identity - Creating Screen (Index)
 * 
 * Shows progress while generating identity, syncs with server, signs in, then navigates to username step
 */
export default function CreateIdentityScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const { createIdentity, syncIdentity } = useOxy();
  const { status, hasIdentity } = useOnboardingStatus();
  const { setAuthError } = useAuthFlowContext();

  const backgroundColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.background : Colors.light.background),
    [colorScheme]
  );
  const textColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.text : Colors.light.text),
    [colorScheme]
  );

  const [creatingProgress, setCreatingProgress] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const creatingProgressRef = useRef<NodeJS.Timeout | null>(null);
  const finalDelayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup function for all timers
  const cleanupTimers = useCallback(() => {
    if (creatingProgressRef.current) {
      clearInterval(creatingProgressRef.current);
      creatingProgressRef.current = null;
    }
    if (finalDelayTimeoutRef.current) {
      clearTimeout(finalDelayTimeoutRef.current);
      finalDelayTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      cleanupTimers();
    };
  }, [cleanupTimers]);

  useEffect(() => {
    // Wait for status to be determined
    if (status === 'checking') return;

    // If identity already exists, try to sync and sign in, then navigate accordingly
    if (status === 'in_progress' && hasIdentity) {
      const checkAndNavigate = async () => {
        const offline = await checkIfOffline();
        if (!isMountedRef.current) return;

        if (!offline && syncIdentity) {
          try {
            setIsSyncing(true);
            // syncIdentity already calls performSignIn internally, creating session and activating it
            await syncIdentity();

            if (!isMountedRef.current) return;

            setIsSyncing(false);
            router.replace('/(auth)/create-identity/username');
          } catch (syncErr: unknown) {
            setIsSyncing(false);

            if (!isMountedRef.current) return;

            const errorMessage = extractAuthErrorMessage(syncErr);
            // If network error, still navigate to username step (user can set username later when online)
            if (isNetworkOrTimeoutError(syncErr)) {
              router.replace('/(auth)/create-identity/username');
            } else {
              setAuthError(errorMessage);
            }
          }
        } else {
          router.replace('/(auth)/create-identity/username');
        }
      };
      checkAndNavigate();
      return;
    }

    // No identity - create one (works offline-first)
    if (status === 'none') {
      const create = async () => {
        try {
          // Check offline status early to determine flow
          const isOffline = await checkIfOffline();

          // Start progress animation
          setCreatingProgress(0);
          let progressStep = 0;

          const progressInterval = setInterval(() => {
            if (!isMountedRef.current) {
              clearInterval(progressInterval);
              return;
            }
            progressStep++;
            if (progressStep <= 2) {
              setCreatingProgress(progressStep);
            } else {
              clearInterval(progressInterval);
            }
          }, CREATING_PROGRESS_INTERVAL_MS);

          creatingProgressRef.current = progressInterval as unknown as NodeJS.Timeout;

          await createIdentity();

          cleanupTimers();

          await new Promise(resolve => setTimeout(resolve, CREATING_FINAL_DELAY_MS));

          if (!isMountedRef.current) return;

          if (!isOffline && syncIdentity) {
            try {
              setIsSyncing(true);
              setCreatingProgress(2);

              // syncIdentity already calls performSignIn internally, creating session and activating it
              await syncIdentity();

              if (!isMountedRef.current) return;

              setIsSyncing(false);
              setCreatingProgress(0);
              router.replace('/(auth)/create-identity/username');
            } catch (syncErr: unknown) {
              setIsSyncing(false);

              if (!isMountedRef.current) return;

              const errorMessage = extractAuthErrorMessage(syncErr);

              // If network error, still navigate to username step (user can set username later when online)
              if (isNetworkOrTimeoutError(syncErr)) {
                setCreatingProgress(0);
                router.replace('/(auth)/create-identity/username');
              } else {
                setAuthError(errorMessage);
                setCreatingProgress(0);
              }
            }
          } else {
            setCreatingProgress(0);
            router.replace('/(auth)/create-identity/username');
          }
        } catch (err: unknown) {
          cleanupTimers();

          if (!isMountedRef.current) return;

          const errorMessage = extractAuthErrorMessage(err);
          if (errorMessage.includes('already exists') || errorMessage.includes('Identity already')) {
            const offline = await checkIfOffline();
            if (!isMountedRef.current) return;

            if (!offline && syncIdentity) {
              try {
                setIsSyncing(true);
                // syncIdentity already calls performSignIn internally, creating session and activating it
                await syncIdentity();
                if (!isMountedRef.current) return;
                setIsSyncing(false);
                router.replace('/(auth)/create-identity/username');
              } catch (syncErr: unknown) {
                setIsSyncing(false);
                if (!isMountedRef.current) return;

                // If network error, still navigate to username step
                if (isNetworkOrTimeoutError(syncErr)) {
                  router.replace('/(auth)/create-identity/username');
                } else {
                  const errorMessage = extractAuthErrorMessage(syncErr);
                  setAuthError(errorMessage);
                  router.replace('/(auth)/create-identity/username');
                }
              }
            } else {
              router.replace('/(auth)/create-identity/username');
            }
            setCreatingProgress(0);
          } else {
            setAuthError(errorMessage);
            setCreatingProgress(0);
          }
        }
      };
      create();
    }

    return cleanupTimers;
  }, [status, hasIdentity, createIdentity, syncIdentity, router, setAuthError, cleanupTimers]);

  return (
    <CreatingStep
      progress={creatingProgress}
      backgroundColor={backgroundColor}
      textColor={textColor}
      isSyncing={isSyncing}
    />
  );
}

