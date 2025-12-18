import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { CreatingStep } from '@/components/auth/CreatingStep';
import { checkIfOffline } from '@/utils/auth/networkUtils';
import { extractAuthErrorMessage } from '@/utils/auth/errorUtils';
import { CREATING_PROGRESS_INTERVAL_MS, CREATING_FINAL_DELAY_MS } from '@/constants/auth';
import { useAuthFlowContext } from '../_authFlowContext';

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

  const backgroundColor = colorScheme === 'dark' ? '#000000' : '#FFFFFF';
  const textColor = colorScheme === 'dark' ? '#FFFFFF' : '#000000';

  const [creatingProgress, setCreatingProgress] = useState(0);
  const creatingProgressRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Wait for status to be determined
    if (status === 'checking') return;

    // If identity already exists, go to username step
    if (status === 'in_progress' && hasIdentity) {
      router.replace('/(auth)/create-identity/username');
      return;
    }

    // No identity - create one
    if (status === 'none') {
      const create = async () => {
        try {
          // Start progress animation
          setCreatingProgress(0);
          let progressStep = 0;

          const progressInterval = setInterval(() => {
            progressStep++;
            if (progressStep <= 2) {
              setCreatingProgress(progressStep);
            } else {
              clearInterval(progressInterval);
            }
          }, CREATING_PROGRESS_INTERVAL_MS);

          creatingProgressRef.current = progressInterval as unknown as NodeJS.Timeout;

          await createIdentity();

          // Clear progress interval
          if (creatingProgressRef.current) {
            clearInterval(creatingProgressRef.current);
            creatingProgressRef.current = null;
          }

          // Small delay to show final progress message
          setTimeout(async () => {
            // Check if offline - if so, skip username step
            const offline = await checkIfOffline();
            if (offline) {
              router.replace('/(auth)/create-identity/notifications');
            } else {
              router.replace('/(auth)/create-identity/username');
            }
            setCreatingProgress(0);
          }, CREATING_FINAL_DELAY_MS);
        } catch (err: unknown) {
          // Clear progress interval on error
          if (creatingProgressRef.current) {
            clearInterval(creatingProgressRef.current);
            creatingProgressRef.current = null;
          }

          const errorMessage = extractAuthErrorMessage(err);
          // If identity already exists (race condition), go to username step
          if (errorMessage.includes('already exists') || errorMessage.includes('Identity already')) {
            router.replace('/(auth)/create-identity/username');
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

    return () => {
      if (creatingProgressRef.current) {
        clearInterval(creatingProgressRef.current);
      }
    };
  }, [status, hasIdentity, createIdentity, router, setAuthError]);

  return (
    <CreatingStep
      progress={creatingProgress}
      backgroundColor={backgroundColor}
      textColor={textColor}
    />
  );
}

