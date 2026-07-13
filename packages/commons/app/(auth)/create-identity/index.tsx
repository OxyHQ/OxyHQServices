import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { IdentityAlreadyExistsError } from '@oxyhq/core';
import { useColors } from '@/hooks/useColors';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { CreatingStep } from '@/components/auth/CreatingStep';
import { checkIfOffline } from '@/utils/auth/networkUtils';
import { extractAuthErrorMessage, isNetworkOrTimeoutError } from '@/utils/auth/errorUtils';
import { CREATING_PROGRESS_INTERVAL_MS, CREATING_FINAL_DELAY_MS } from '@/constants/auth';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { useIdentity } from '@/hooks/useIdentity';

/**
 * Create Identity - Creating Screen (Index)
 *
 * Shows progress while generating identity, then routes to the recovery
 * phrase reveal screen (when a fresh identity was just generated) or
 * directly to the username step (when resuming an in-progress flow with
 * an existing identity).
 *
 * The recovery phrase is stashed in `useAuthFlowContext().recoveryPhraseRef`
 * for the next screen to read. It is never persisted to storage.
 */
export default function CreateIdentityScreen() {
  const router = useRouter();
  const colors = useColors();
  const { isAuthenticated } = useOxy();
  const { createIdentity, syncIdentity } = useIdentity();
  const { status, hasIdentity } = useOnboardingStatus();
  const { setAuthError, recoveryPhraseRef } = useAuthFlowContext();

  const backgroundColor = colors.background;
  const textColor = colors.text;

  const [creatingProgress, setCreatingProgress] = useState(0);
  const creatingProgressRef = useRef<NodeJS.Timeout | null>(null);
  const finalDelayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  // Guards against the effect re-firing — without it, React strict-mode's
  // intentional double-invocation in development would call createIdentity
  // twice. The module-level lock in useIdentity also protects us, but a
  // local guard here keeps the UI consistent (no double-progress bar).
  const hasStartedCreateRef = useRef(false);
  // Guards against issuing the resume-redirect twice within the same mount.
  // The status-change effect can re-run for unrelated dependency changes
  // (router/setAuthError references), and we only want exactly one
  // `replace('/username')` per resume. Note: this does NOT survive remounts;
  // protection against a remount-induced bounce relies on the SDK-side
  // cache invalidation in `updateProfile` keeping `hasUsername` stable.
  const hasNavigatedResumeRef = useRef(false);

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

    // If identity already exists (e.g., user resumed after closing the
    // app mid-onboarding), sync and route to username. We DO NOT route
    // through the recovery-phrase screen because we no longer have the
    // mnemonic in memory — the user must view it from settings instead.
    if (status === 'in_progress' && hasIdentity) {
      if (hasNavigatedResumeRef.current) return;
      hasNavigatedResumeRef.current = true;

      const checkAndNavigate = async () => {
        const offline = await checkIfOffline();
        if (!isMountedRef.current) return;

        if (!isAuthenticated && !offline && syncIdentity) {
          try {
            await syncIdentity();
          } catch (syncErr: unknown) {
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

    // No identity — create one. The module-level lock in useIdentity
    // serializes concurrent calls, but we still guard locally to avoid
    // double-rendering the progress animation.
    if (status === 'none' && !hasStartedCreateRef.current) {
      hasStartedCreateRef.current = true;
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

          const result = await createIdentity();

          cleanupTimers();

          // Stash the phrase in memory only — the next screen will read it
          // from this ref and clear it after acknowledgement.
          recoveryPhraseRef.current = result.recoveryPhrase;

          await new Promise(resolve => setTimeout(resolve, CREATING_FINAL_DELAY_MS));

          if (!isMountedRef.current) return;

          setCreatingProgress(0);
          // CRITICAL: route to the recovery phrase screen BEFORE username.
          // If we skip this and the user later loses the device, their
          // account is unrecoverable.
          router.replace('/(auth)/create-identity/recovery-phrase');
        } catch (err: unknown) {
          cleanupTimers();
          hasStartedCreateRef.current = false;

          if (!isMountedRef.current) return;

          // IdentityAlreadyExistsError is the expected outcome when a
          // user lands here with a half-completed onboarding (identity
          // exists but no username yet). Convert it into "resume" UX
          // instead of treating it as a hard error.
          if (err instanceof IdentityAlreadyExistsError) {
            const offline = await checkIfOffline();
            if (!isMountedRef.current) return;

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
            return;
          }

          // Any other failure: log it and surface to the user. The
          // identity may or may not exist locally; the `useEffect` integrity
          // check in `useIdentity` will catch it on the next mount.
          console.error('[CreateIdentityScreen] createIdentity failed', err);
          const errorMessage = extractAuthErrorMessage(err);
          setAuthError(errorMessage);
          setCreatingProgress(0);
        }
      };
      create();
    }

    return cleanupTimers;
  }, [
    status,
    hasIdentity,
    createIdentity,
    syncIdentity,
    isAuthenticated,
    router,
    setAuthError,
    cleanupTimers,
    recoveryPhraseRef,
  ]);

  // While onboarding status is still resolving on this screen's own mount,
  // render a neutral backdrop instead of the "generating keys" copy.
  if (status === 'checking') {
    return <View style={{ flex: 1, backgroundColor }} />;
  }

  // Resume path (identity already exists) is a SYNC, not key generation —
  // show the accurate copy so we never claim to be "generating" existing keys.
  const isResuming = hasIdentity && status === 'in_progress';

  return (
    <CreatingStep
      progress={creatingProgress}
      isSyncing={isResuming}
      backgroundColor={backgroundColor}
      textColor={textColor}
    />
  );
}

