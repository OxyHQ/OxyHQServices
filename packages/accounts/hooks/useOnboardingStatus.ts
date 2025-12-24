import { useState, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { useOxy } from '@oxyhq/services';

// Constants for delays and retries
const TOKEN_READY_WAIT_MS = 2000;
const TOKEN_READY_CHECK_INTERVAL_MS = 100;
const IDENTITY_CHECK_RETRY_DELAY_MS = 200;
const IDENTITY_CHECK_MAX_ATTEMPTS = 3;
const IDENTITY_RECHECK_DELAY_MS = 1000;

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
  const { hasIdentity: checkIdentity, user, isAuthenticated, isLoading: oxyLoading, isStorageReady, isTokenReady, sessions, activeSessionId } = useOxy();
  const [identityExists, setIdentityExists] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const previousIdentityStateRef = useRef<boolean | null>(null);

  // Check identity existence - re-check if previously found but now appears missing
  // Wait for storage and token to be ready to ensure accurate state
  useEffect(() => {
    // Wait for storage to be ready and OxyContext to finish loading
    if (oxyLoading || !isStorageReady) return;

    let mounted = true;
    const check = async () => {
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
        
        // Check identity with retry logic for reliability
        let exists = false;
        
        for (let attempt = 0; attempt < IDENTITY_CHECK_MAX_ATTEMPTS && mounted; attempt++) {
          try {
            exists = await checkIdentity();
            if (exists) break; // Found identity, exit retry loop
          } catch {
            // Silently handle errors - will retry on next iteration
          }
          
          // Wait before next retry (except on last attempt)
          if (!exists && attempt < IDENTITY_CHECK_MAX_ATTEMPTS - 1) {
            await new Promise(resolve => setTimeout(resolve, IDENTITY_CHECK_RETRY_DELAY_MS));
          }
        }
        
        if (mounted) {
          // Only update state if we got a definitive result
          // If identity was previously found but now appears missing, be more cautious
          const wasPreviouslyFound = previousIdentityStateRef.current === true;
          if (wasPreviouslyFound && !exists) {
            // Identity was found before but now appears missing - this might be a transient issue
            // Re-check one more time after a longer delay
            setTimeout(async () => {
              if (mounted) {
                try {
                  const recheck = await checkIdentity();
                  if (mounted) {
                    previousIdentityStateRef.current = recheck;
                    setIdentityExists(recheck);
                    setIsChecking(false);
                  }
                } catch {
                  if (mounted) {
                    // Keep previous state if re-check fails (don't lose identity on transient errors)
                    setIsChecking(false);
                  }
                }
              }
            }, IDENTITY_RECHECK_DELAY_MS);
            return; // Don't update state yet, wait for re-check
          }
          
          previousIdentityStateRef.current = exists;
          setIdentityExists(exists);
        }
      } catch (error) {
        // Don't set to false if identity was previously found - might be transient error
        if (mounted && previousIdentityStateRef.current !== true) {
          previousIdentityStateRef.current = false;
          setIdentityExists(false);
        }
      } finally {
        if (mounted) {
          setIsChecking(false);
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

    // CRITICAL: If we have active sessions restored with valid user data,
    // don't show auth screen even while checking identity
    // This prevents welcome screen flash on app reopen
    // Note: Check both activeSessionId (definitive) and user (ensures session is valid)
    // The sessions array check is defensive to ensure we have session data loaded
    const hasActiveSession = !!(
      activeSessionId && 
      user && 
      sessions && 
      sessions.some(s => s.sessionId === activeSessionId)
    );
    if (hasActiveSession) {
      return false;
    }

    // If checking, be cautious - only show auth if we're sure there's no identity
    // If we previously found identity but are now checking, don't redirect yet
    if (status === 'checking') {
      // If identity was previously found, don't redirect while checking (might be transient)
      if (previousIdentityStateRef.current === true) {
        return false;
      }
      return true;
    }

    // Show auth if no identity or onboarding in progress
    return status === 'none' || status === 'in_progress';
  }, [status, activeSessionId, sessions, user]);

  return {
    status,
    needsAuth,
    isLoading: isChecking || oxyLoading,
    hasIdentity: identityExists ?? false,
    hasUsername: !!(isAuthenticated && user?.username),
  };
}
