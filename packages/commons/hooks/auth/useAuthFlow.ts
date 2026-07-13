import { useState, useCallback } from 'react';
import type { AuthStep } from '@/types/auth';

/**
 * Hook for managing authentication flow state
 *
 * @param initialStep - The initial step
 * @returns Auth flow state and handlers
 */
export function useAuthFlow(initialStep: AuthStep = 'creating') {
  const [step, setStep] = useState<AuthStep>(initialStep);
  const [error, setError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const goToStep = useCallback((newStep: AuthStep) => {
    setStep(newStep);
  }, []);

  const setAuthError = useCallback((errorMessage: string | null) => {
    setError(errorMessage);
  }, []);

  const setSigningIn = useCallback((signingIn: boolean) => {
    setIsSigningIn(signingIn);
  }, []);

  return {
    step,
    error,
    isSigningIn,
    goToStep,
    setAuthError,
    setSigningIn,
  };
}

