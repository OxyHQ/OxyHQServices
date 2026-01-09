import { useState, useCallback, useEffect, useMemo } from 'react';
import { useOxy } from '@oxyhq/services';
import { useIdentity } from './useIdentity';
import { useOnboardingStatus, type OnboardingStatus } from './useOnboardingStatus';

export type OnboardingStep = 'creating' | 'username' | 'notifications';

/**
 * Hook for managing the onboarding flow within create-identity screen
 * 
 * Handles:
 * - Resuming from appropriate step if onboarding was interrupted
 * - Creating identity if needed
 * - Determining current step based on onboarding status
 */
export function useOnboardingFlow() {
  const { user, isAuthenticated } = useOxy();
  const { createIdentity, hasIdentity } = useIdentity();
  const { status, hasIdentity: identityExists } = useOnboardingStatus();
  
  const [step, setStep] = useState<OnboardingStep>('creating');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Initialize flow based on onboarding status
  useEffect(() => {
    const initialize = async () => {
      // If checking, wait
      if (status === 'checking') {
        return;
      }

      // If onboarding complete, shouldn't be here (handled by routing)
      if (status === 'complete') {
        return;
      }

      // If identity exists but onboarding in progress, resume from username
      if (status === 'in_progress' && identityExists) {
        setStep('username');
        return;
      }

      // No identity - create one
      if (status === 'none' && !isCreating) {
        setIsCreating(true);
        try {
          await createIdentity();
          // Small delay to show creating animation
          setTimeout(() => {
            setStep('username');
            setIsCreating(false);
          }, 1500);
        } catch (err: any) {
          setIsCreating(false);
          // If identity already exists (race condition), go to username step
          if (err?.message?.includes('already exists') || err?.message?.includes('Identity already')) {
            setStep('username');
          } else {
            setError(err.message || 'Failed to create identity');
          }
        }
      }
    };

    initialize();
  }, [status, identityExists, createIdentity, isCreating]);

  const goToStep = useCallback((newStep: OnboardingStep) => {
    setStep(newStep);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    step,
    error,
    isCreating,
    goToStep,
    clearError,
    setError,
  };
}

