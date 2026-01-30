import { handleHttpError, ErrorCodes, type ApiError } from '@oxyhq/core';

/**
 * Check if an error is a network or timeout error using Oxy core utilities
 * 
 * @param error - The error to check
 * @returns True if the error is a network or timeout error
 */
export function isNetworkOrTimeoutError(error: unknown): boolean {
  const apiError = handleHttpError(error);
  return (
    apiError.code === ErrorCodes.NETWORK_ERROR ||
    apiError.code === ErrorCodes.TIMEOUT ||
    apiError.code === ErrorCodes.CONNECTION_FAILED
  );
}

/**
 * Extract error message from an unknown error shape
 * Uses Oxy core error handling to standardize error messages
 * 
 * @param error - The error to extract message from
 * @param fallbackMessage - Fallback message if extraction fails
 * @returns The error message
 */
export function extractAuthErrorMessage(error: unknown, fallbackMessage = 'An error occurred'): string {
  const apiError = handleHttpError(error);
  return apiError.message || fallbackMessage;
}

/**
 * Handle authentication errors with context
 * 
 * @param error - The error to handle
 * @param context - Context where the error occurred
 * @returns The error message
 */
export function handleAuthError(error: unknown, context: string): string {
  const apiError = handleHttpError(error);
  
  // Log error details for debugging (in development)
  if (__DEV__) {
    console.warn(`[${context}] Auth error:`, {
      message: apiError.message,
      code: apiError.code,
      status: apiError.status,
    });
  }
  
  return apiError.message || `An error occurred in ${context}`;
}

