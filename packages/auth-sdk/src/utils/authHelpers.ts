/**
 * Authentication helper utilities to reduce code duplication across hooks and utilities.
 * These functions handle common token validation and authentication error patterns.
 */

import type { OxyServices } from '@oxyhq/core';

/**
 * Error thrown when session sync is required
 */
export class SessionSyncRequiredError extends Error {
  constructor(message = 'Session needs to be synced. Please try again.') {
    super(message);
    this.name = 'SessionSyncRequiredError';
  }
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationFailedError extends Error {
  constructor(message = 'Authentication failed. Please sign in again.') {
    super(message);
    this.name = 'AuthenticationFailedError';
  }
}

/**
 * Ensures a valid token exists before making authenticated API calls.
 * If no valid token exists and an active session ID is available,
 * attempts to refresh the token using the session.
 *
 * @param oxyServices - The OxyServices instance
 * @param activeSessionId - The active session ID (if available)
 * @throws {SessionSyncRequiredError} If the session needs to be synced (offline session)
 * @throws {Error} If token refresh fails for other reasons
 *
 * @example
 * ```ts
 * // In a mutation or query function:
 * await ensureValidToken(oxyServices, activeSessionId);
 * return await oxyServices.updateProfile(updates);
 * ```
 */
export async function ensureValidToken(
  oxyServices: OxyServices,
  activeSessionId: string | null | undefined
): Promise<void> {
  if (oxyServices.hasValidToken() || !activeSessionId) {
    return;
  }

  try {
    await oxyServices.getTokenBySession(activeSessionId);
  } catch (tokenError) {
    const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);

    if (errorMessage.includes('AUTH_REQUIRED_OFFLINE_SESSION') || errorMessage.includes('offline')) {
      throw new SessionSyncRequiredError();
    }

    throw tokenError;
  }
}

/**
 * Options for handling API authentication errors
 */
export interface HandleApiErrorOptions {
  /** Optional callback to attempt session sync and retry */
  syncSession?: () => Promise<unknown>;
  /** The active session ID for retry attempts */
  activeSessionId?: string | null;
  /** The OxyServices instance for retry attempts */
  oxyServices?: OxyServices;
}

/**
 * Checks if an error is an authentication error (401 or auth-related message)
 *
 * @param error - The error to check
 * @returns True if the error is an authentication error
 */
export function isAuthenticationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errorObj = error as { message?: string; status?: number; response?: { status?: number } };
  const errorMessage = errorObj.message || '';
  const status = errorObj.status || errorObj.response?.status;

  return (
    status === 401 ||
    errorMessage.includes('Authentication required') ||
    errorMessage.includes('Invalid or missing authorization header')
  );
}

/**
 * Wraps an API call with authentication error handling.
 * If an authentication error occurs, it can optionally attempt to sync the session and retry.
 *
 * @param apiCall - The API call function to execute
 * @param options - Optional error handling configuration
 * @returns The result of the API call
 * @throws {AuthenticationFailedError} If authentication fails and cannot be recovered
 * @throws {Error} If the API call fails for non-auth reasons
 *
 * @example
 * ```ts
 * // Simple usage:
 * const result = await withAuthErrorHandling(
 *   () => oxyServices.updateProfile(updates)
 * );
 *
 * // With retry on auth failure:
 * const result = await withAuthErrorHandling(
 *   () => oxyServices.updateProfile(updates),
 *   { syncSession, activeSessionId, oxyServices }
 * );
 * ```
 */
export async function withAuthErrorHandling<T>(
  apiCall: () => Promise<T>,
  options?: HandleApiErrorOptions
): Promise<T> {
  try {
    return await apiCall();
  } catch (error) {
    if (!isAuthenticationError(error)) {
      throw error;
    }

    // If we have sync capabilities, try to recover
    if (options?.syncSession && options?.activeSessionId && options?.oxyServices) {
      try {
        await options.syncSession();
        await options.oxyServices.getTokenBySession(options.activeSessionId);
        // Retry the API call after refreshing token
        return await apiCall();
      } catch {
        throw new AuthenticationFailedError();
      }
    }

    throw new AuthenticationFailedError();
  }
}

/**
 * Combines token validation and auth error handling for a complete authenticated API call.
 * This is the recommended helper for most authenticated API operations.
 *
 * @param oxyServices - The OxyServices instance
 * @param activeSessionId - The active session ID
 * @param apiCall - The API call function to execute
 * @param syncSession - Optional callback to sync session on auth failure
 * @returns The result of the API call
 *
 * @example
 * ```ts
 * return await authenticatedApiCall(
 *   oxyServices,
 *   activeSessionId,
 *   () => oxyServices.updateProfile(updates)
 * );
 * ```
 */
export async function authenticatedApiCall<T>(
  oxyServices: OxyServices,
  activeSessionId: string | null | undefined,
  apiCall: () => Promise<T>,
  syncSession?: () => Promise<unknown>
): Promise<T> {
  await ensureValidToken(oxyServices, activeSessionId);

  return withAuthErrorHandling(apiCall, {
    syncSession,
    activeSessionId,
    oxyServices,
  });
}
