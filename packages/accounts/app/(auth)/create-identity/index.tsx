import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { CreatingStep } from '@/components/auth/CreatingStep';
import { checkIfOffline } from '@/utils/auth/networkUtils';
import { extractAuthErrorMessage, isNetworkOrTimeoutError } from '@/utils/auth/errorUtils';
import { CREATING_PROGRESS_INTERVAL_MS, CREATING_FINAL_DELAY_MS } from '@/constants/auth';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { Colors } from '@/constants/theme';
import { useIdentity } from '@/hooks/useIdentity';

/**
 * Create Identity - Creating Screen (Index)
 * 
 * Shows progress while generating identity, syncs with server, signs in, then navigates to username step
 */
export default function CreateIdentityScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const { isAuthenticated } = useOxy();
  const { createIdentity, syncIdentity } = useIdentity();
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

    // If identity already exists, sync and sign in if needed
    if (status === 'in_progress' && hasIdentity) {
      const checkAndNavigate = async () => {
        const offline = await checkIfOffline();
        if (!isMountedRef.current) return;

        // If not authenticated and online, sync to sign in
        if (!isAuthenticated && !offline && syncIdentity) {
          try {
            await syncIdentity();
          } catch (syncErr: unknown) {
            // If network error, still navigate - user can set username later
            if (!isNetworkOrTimeoutError(syncErr)) {
              const errorMessage = extractAuthErrorMessage(syncErr);
              setAuthError(errorMessage);
            }
          }
        }

        if (!isMountedRef.current) return;
        router.replace('/(auth)/create-identity/username');
      };
      checkAndNavigate();
      return;
    }

    // No identity - create one (works offline-first, auto signs in if online)
    if (status === 'none') {
      const create = async () => {
        try {
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

          // createIdentity automatically registers and signs in if online
          const result = await createIdentity();

          cleanupTimers();

          await new Promise(resolve => setTimeout(resolve, CREATING_FINAL_DELAY_MS));

          if (!isMountedRef.current) return;

          // If user is already authenticated (from createIdentity), navigate to username step
          // If not authenticated (offline), also navigate - user can sync later
          setCreatingProgress(0);
          router.replace('/(auth)/create-identity/username');
        } catch (err: unknown) {
          cleanupTimers();

          if (!isMountedRef.current) return;

          const errorMessage = extractAuthErrorMessage(err);
          // If identity already exists, try to sync and sign in
          if (errorMessage.includes('already exists') || errorMessage.includes('Identity already')) {
            const offline = await checkIfOffline();
            if (!isMountedRef.current) return;

            // Try to sync if online
            if (!offline && syncIdentity) {
              try {
                await syncIdentity();
              } catch (syncErr: unknown) {
                if (!isNetworkOrTimeoutError(syncErr)) {
                  const syncErrorMessage = extractAuthErrorMessage(syncErr);
                  setAuthError(syncErrorMessage);
                }
              }
            }
            router.replace('/(auth)/create-identity/username');
          } else {
            setAuthError(errorMessage);
          }
          setCreatingProgress(0);
        }
      };
      create();
    }

    return cleanupTimers;
  }, [status, hasIdentity, createIdentity, syncIdentity, isAuthenticated, router, setAuthError, cleanupTimers]);

  return (
    <CreatingStep
      progress={creatingProgress}
      backgroundColor={backgroundColor}
      textColor={textColor}
    />
  );
}

