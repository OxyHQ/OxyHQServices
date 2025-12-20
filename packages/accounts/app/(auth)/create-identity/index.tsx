import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { CreatingStep } from '@/components/auth/CreatingStep';
import { checkIfOffline } from '@/utils/auth/networkUtils';
import { extractAuthErrorMessage } from '@/utils/auth/errorUtils';
import { CREATING_PROGRESS_INTERVAL_MS, CREATING_FINAL_DELAY_MS } from '@/constants/auth';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { Colors } from '@/constants/theme';

/**
 * Create Identity - Creating Screen (Index)
 * 
 * Shows progress while generating identity, then navigates to username or notifications step
 */
export default function CreateIdentityScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const { createIdentity } = useOxy();
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

    // If identity already exists, check offline status and navigate accordingly
    if (status === 'in_progress' && hasIdentity) {
      const checkAndNavigate = async () => {
        const offline = await checkIfOffline();
        if (!isMountedRef.current) return;
        
        // Skip username step if offline, go directly to notifications
        if (offline) {
          router.replace('/(auth)/create-identity/notifications');
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

          // Create identity (works offline)
          await createIdentity();

          // Clear progress interval
          cleanupTimers();

          // Small delay to show final progress message
          finalDelayTimeoutRef.current = setTimeout(async () => {
            if (!isMountedRef.current) return;
            
            // Use the offline status we checked earlier
            // If offline, skip username step and go directly to notifications
            if (isOffline) {
              router.replace('/(auth)/create-identity/notifications');
            } else {
              // Double-check offline status in case it changed
              const offline = await checkIfOffline();
              if (!isMountedRef.current) return;
              
              if (offline) {
                router.replace('/(auth)/create-identity/notifications');
              } else {
                router.replace('/(auth)/create-identity/username');
              }
            }
            setCreatingProgress(0);
          }, CREATING_FINAL_DELAY_MS) as unknown as NodeJS.Timeout;
        } catch (err: unknown) {
          // Clear all timers on error
          cleanupTimers();

          if (!isMountedRef.current) return;

          const errorMessage = extractAuthErrorMessage(err);
          // If identity already exists (race condition), check offline and navigate
          if (errorMessage.includes('already exists') || errorMessage.includes('Identity already')) {
            const offline = await checkIfOffline();
            if (!isMountedRef.current) return;
            
            if (offline) {
              router.replace('/(auth)/create-identity/notifications');
            } else {
              router.replace('/(auth)/create-identity/username');
            }
            setCreatingProgress(0);
          } else {
            // Show error
            setAuthError(errorMessage);
            setCreatingProgress(0);
          }
        }
      };
      create();
    }

    return cleanupTimers;
  }, [status, hasIdentity, createIdentity, router, setAuthError, cleanupTimers]);

  return (
    <CreatingStep
      progress={creatingProgress}
      backgroundColor={backgroundColor}
      textColor={textColor}
    />
  );
}

