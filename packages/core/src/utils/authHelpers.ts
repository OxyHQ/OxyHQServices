/**
 * Authentication helper utilities for common token validation
 * and authentication error handling patterns.
 */

import type { OxyServices } from '../OxyServices';

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
 * @throws {SessionSyncRequiredError} If the session needs to be synced (offline session)
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
  syncSession?: () => Promise<unknown>;
  activeSessionId?: string | null;
  oxyServices?: OxyServices;
}

/**
 * Checks if an error is an authentication error (401 or auth-related message)
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
 * On auth failure, optionally attempts to sync the session and retry.
 *
 * @throws {AuthenticationFailedError} If authentication fails and cannot be recovered
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

    if (options?.syncSession && options?.activeSessionId && options?.oxyServices) {
      try {
        await options.syncSession();
        await options.oxyServices.getTokenBySession(options.activeSessionId);
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
