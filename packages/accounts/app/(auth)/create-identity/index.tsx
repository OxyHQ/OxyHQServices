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
  const { createIdentity, syncIdentity, signIn, oxyServices } = useOxy();
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
  const [isSigningIn, setIsSigningIn] = useState(false);
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

        if (!offline && syncIdentity && signIn) {
          try {
            setIsSyncing(true);
            await syncIdentity();

            if (!isMountedRef.current) return;

            setIsSyncing(false);

            const authStore = useAuthStore.getState();
            if (!authStore.isAuthenticated) {
              setIsSigningIn(true);
              await signIn();
              if (!isMountedRef.current) return;

              if (oxyServices) {
                let attempts = 0;
                while (!oxyServices.hasValidToken() && attempts < 20) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                  attempts++;
                }
              }

              setIsSigningIn(false);
            }

            router.replace('/(auth)/create-identity/username');
          } catch {
            setIsSyncing(false);
            setIsSigningIn(false);

            if (!isMountedRef.current) return;

            router.replace('/(auth)/create-identity/username');
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

          if (!isOffline && syncIdentity && signIn) {
            try {
              setIsSyncing(true);
              setCreatingProgress(2);

              await syncIdentity();

              if (!isMountedRef.current) return;

              setIsSyncing(false);
              setIsSigningIn(true);
              setCreatingProgress(2);

              await signIn();

              if (!isMountedRef.current) return;

              if (oxyServices) {
                let attempts = 0;
                while (!oxyServices.hasValidToken() && attempts < 20) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                  attempts++;
                }
              }

              setIsSigningIn(false);
              setCreatingProgress(0);

              router.replace('/(auth)/create-identity/username');
            } catch (syncErr: unknown) {
              setIsSyncing(false);
              setIsSigningIn(false);

              if (!isMountedRef.current) return;

              const errorMessage = extractAuthErrorMessage(syncErr);

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

            if (!offline && syncIdentity && signIn) {
              try {
                setIsSyncing(true);
                await syncIdentity();
                if (!isMountedRef.current) return;
                setIsSyncing(false);
                setIsSigningIn(true);
                await signIn();
                if (!isMountedRef.current) return;

                if (oxyServices) {
                  let attempts = 0;
                  while (!oxyServices.hasValidToken() && attempts < 20) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                  }
                }

                setIsSigningIn(false);
                router.replace('/(auth)/create-identity/username');
              } catch {
                setIsSyncing(false);
                setIsSigningIn(false);
                router.replace('/(auth)/create-identity/username');
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
  }, [status, hasIdentity, createIdentity, syncIdentity, signIn, oxyServices, router, setAuthError, cleanupTimers]);

  return (
    <CreatingStep
      progress={creatingProgress}
      backgroundColor={backgroundColor}
      textColor={textColor}
      isSyncing={isSyncing}
      isSigningIn={isSigningIn}
    />
  );
}

