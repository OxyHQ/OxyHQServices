import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OxyServices } from '../../../core';
import { handleHttpError, ErrorCodes } from '../../../utils/errorUtils';
import { useDebounce } from '../../../utils/hookUtils';

/**
 * Username validation constants
 */
export const USERNAME_MIN_LENGTH = 4;
export const USERNAME_REGEX = /^[a-z0-9]+$/i;
export const USERNAME_FORMAT_ERROR = 'You can use a-z, 0-9. Minimum length is 4 characters.';
export const USERNAME_DEBOUNCE_MS = 500;

/**
 * Username validation result interface
 */
export interface UsernameValidationResult {
  isValid: boolean;
  isAvailable: boolean | null; // null = not checked yet
  error: string | null;
  isChecking: boolean;
}

/**
 * Validate username format using services validation utilities
 */
function validateUsernameFormat(username: string): boolean {
  // Use stricter validation: lowercase alphanumeric only, min 4 chars
  return username.length >= USERNAME_MIN_LENGTH && USERNAME_REGEX.test(username);
}

/**
 * Check if an error is a network or timeout error
 */
function isNetworkOrTimeoutError(error: unknown): boolean {
  const apiError = handleHttpError(error);
  return (
    apiError.code === ErrorCodes.NETWORK_ERROR ||
    apiError.code === ErrorCodes.TIMEOUT ||
    apiError.code === ErrorCodes.CONNECTION_FAILED
  );
}

/**
 * Extract error message from an unknown error shape
 */
function extractAuthErrorMessage(error: unknown, fallbackMessage = 'An error occurred'): string {
  const apiError = handleHttpError(error);
  return apiError.message || fallbackMessage;
}

/**
 * Hook for username validation with debouncing and availability checking
 * 
 * Uses TanStack Query for efficient API calls with:
 * - Automatic request cancellation when username changes
 * - Built-in caching (same username checked multiple times = cached result)
 * - Request deduplication (multiple components checking same username = single request)
 * - Proper error handling
 * 
 * @param username - The username to validate
 * @param oxyServices - OxyServices instance for API calls
 * @returns Username validation state and result
 */
export function useUsernameValidation(
  username: string,
  oxyServices: OxyServices | null
): UsernameValidationResult {
  // Debounce the username input to avoid excessive API calls
  const debouncedUsername = useDebounce(username.trim().toLowerCase(), USERNAME_DEBOUNCE_MS);
  
  // Validate format synchronously (no API call needed)
  const isValid = useMemo(() => validateUsernameFormat(username), [username]);
  
  // Determine if we should check availability
  const shouldCheckAvailability = useMemo(() => {
    if (!debouncedUsername || debouncedUsername.length < USERNAME_MIN_LENGTH) {
      return false;
    }
    return validateUsernameFormat(debouncedUsername);
  }, [debouncedUsername]);
  
  // Use TanStack Query for the API call
  // This provides automatic caching, request cancellation, and deduplication
  const {
    data: availabilityResult,
    isLoading: isChecking,
    error: queryError,
    isFetching,
  } = useQuery({
    queryKey: ['username', 'availability', debouncedUsername],
    queryFn: async () => {
      if (!oxyServices) {
        throw new Error('OxyServices not available');
      }
      return await oxyServices.checkUsernameAvailability(debouncedUsername);
    },
    enabled: shouldCheckAvailability && !!oxyServices,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes (usernames don't change often)
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    retry: (failureCount, error) => {
      // Don't retry on network/timeout errors (user might be offline)
      if (isNetworkOrTimeoutError(error)) {
        return false;
      }
      // Retry up to 2 times for other errors
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 3000),
  });
  
  // Compute the result based on validation and query state
  return useMemo(() => {
    // If username is too short or invalid format, return early validation
    if (!username || username.length < USERNAME_MIN_LENGTH) {
      return {
        isValid: false,
        isAvailable: null,
        error: null,
        isChecking: false,
      };
    }
    
    if (!isValid) {
      return {
        isValid: false,
        isAvailable: false,
        error: USERNAME_FORMAT_ERROR,
        isChecking: false,
      };
    }
    
    // If we're not checking yet (debounce period), show checking state only if user is typing
    const isCurrentlyChecking = isChecking || isFetching;
    
    // Handle network/timeout errors gracefully
    if (queryError && isNetworkOrTimeoutError(queryError)) {
      // Allow proceeding if offline/network issue (optimistic)
      return {
        isValid: true,
        isAvailable: true, // Optimistic: allow proceeding
        error: null,
        isChecking: false,
      };
    }
    
    // Handle other errors
    if (queryError) {
      return {
        isValid: true,
        isAvailable: false,
        error: extractAuthErrorMessage(queryError, 'Failed to check username availability'),
        isChecking: false,
      };
    }
    
    // If we have a result, use it
    if (availabilityResult) {
      return {
        isValid: true,
        isAvailable: availabilityResult.available,
        error: availabilityResult.available ? null : (availabilityResult.message || 'Username is already taken'),
        isChecking: false,
      };
    }
    
    // Still checking (or waiting for debounce)
    return {
      isValid: true,
      isAvailable: null,
      error: null,
      isChecking: isCurrentlyChecking,
    };
  }, [username, isValid, availabilityResult, isChecking, isFetching, queryError]);
}

