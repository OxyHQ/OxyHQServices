import { useState, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { useOxy, KeyManager } from '@oxyhq/services';

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
  const { user, isAuthenticated, isLoading: oxyLoading } = useOxy();
  const [identityExists, setIdentityExists] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  // Check identity existence (only once, cached)
  useEffect(() => {
    if (oxyLoading) return;

    let mounted = true;
    const check = async () => {
      try {
        setIsChecking(true);
        const exists = await KeyManager.hasIdentity();
        if (mounted) {
          setIdentityExists(exists);
        }
      } catch (error) {
        console.error('Error checking identity:', error);
        if (mounted) {
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
  }, [oxyLoading]);

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

    // If checking, default to showing auth (safer)
    if (status === 'checking') {
      return true;
    }

    // Show auth if no identity or onboarding in progress
    return status === 'none' || status === 'in_progress';
  }, [status]);

  return {
    status,
    needsAuth,
    isLoading: isChecking || oxyLoading,
    hasIdentity: identityExists ?? false,
    hasUsername: !!(isAuthenticated && user?.username),
  };
}
