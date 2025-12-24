import { useState, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { useOxy } from '@oxyhq/services';

// Constants for delays
const TOKEN_READY_WAIT_MS = 2000;
const TOKEN_READY_CHECK_INTERVAL_MS = 100;

export type OnboardingStatus = 'checking' | 'none' | 'in_progress' | 'complete';

export interface OnboardingState {
  status: OnboardingStatus;
  needsAuth: boolean;
  isLoading: boolean;
  hasIdentity: boolean;
  hasUsername: boolean;
}

/**
 * Centralized hook for managing onboarding state
 * 
 * Provides a single source of truth for onboarding status.
 * This hook:
 * - Checks if identity exists
 * - Checks if user has completed onboarding (has username)
 * - Determines routing decisions
 * - Handles all edge cases efficiently
 * 
 * Used by:
 * - _layout.tsx for routing decisions
 * - create-identity.tsx for flow initialization
 * 
 * @returns OnboardingState with status, needsAuth flag, and loading state
 */
export function useOnboardingStatus(): OnboardingState {
  const { hasIdentity: checkIdentity, user, isAuthenticated, isLoading: oxyLoading, isStorageReady, isTokenReady } = useOxy();
  const [identityExists, setIdentityExists] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const checkInProgressRef = useRef(false);

  // Simplified identity check - no complex retry logic
  // Wait for storage and token to be ready to ensure accurate state
  useEffect(() => {
    // Wait for storage to be ready and OxyContext to finish loading
    if (oxyLoading || !isStorageReady) return;
    
    // Prevent concurrent checks
    if (checkInProgressRef.current) return;

    let mounted = true;
    const check = async () => {
      checkInProgressRef.current = true;
      try {
        setIsChecking(true);
        
        // Wait a bit for token to be ready (sessions might still be restoring)
        // This ensures we check identity after sessions are restored
        if (!isTokenReady) {
          let waited = 0;
          while (!isTokenReady && waited < TOKEN_READY_WAIT_MS && mounted) {
            await new Promise(resolve => setTimeout(resolve, TOKEN_READY_CHECK_INTERVAL_MS));
            waited += TOKEN_READY_CHECK_INTERVAL_MS;
          }
        }
        
        if (!mounted) return;
        
        // Single identity check - no retries needed as KeyManager is now reliable
        try {
          const exists = await checkIdentity();
          if (mounted) {
            setIdentityExists(exists);
          }
        } catch (error) {
          // On error, assume no identity (safer default)
          if (mounted) {
            setIdentityExists(false);
          }
        }
      } finally {
        if (mounted) {
          setIsChecking(false);
          checkInProgressRef.current = false;
        }
      }
    };

    check();
    return () => {
      mounted = false;
    };
  }, [checkIdentity, oxyLoading, isStorageReady, isTokenReady]);

  // Compute onboarding status
  const status = useMemo<OnboardingStatus>(() => {
    if (isChecking || identityExists === null || oxyLoading) {
      return 'checking';
    }

    if (!identityExists) {
      return 'none';
    }

    // Identity exists - check if onboarding is complete
    if (isAuthenticated && user?.username) {
      return 'complete';
    }

    // Identity exists but no username - onboarding in progress
    return 'in_progress';
  }, [identityExists, isChecking, isAuthenticated, user, oxyLoading]);

  // Determine if auth flow is needed
  const needsAuth = useMemo(() => {
    // On web, always redirect away from auth
    if (Platform.OS === 'web') {
      return false;
    }

    // If authenticated with username, we don't need auth flow
    // This prevents welcome screen flash on app reopen when sessions are restored
    if (isAuthenticated && user?.username) {
      return false;
    }

    // While checking, show auth to prevent blank screen
    // But make the check fast and reliable
    if (status === 'checking') {
      return true;
    }

    // Show auth if no identity or onboarding in progress
    return status === 'none' || status === 'in_progress';
  }, [status, isAuthenticated, user?.username]);

  return {
    status,
    needsAuth,
    isLoading: isChecking || oxyLoading,
    hasIdentity: identityExists ?? false,
    hasUsername: !!(isAuthenticated && user?.username),
  };
}
