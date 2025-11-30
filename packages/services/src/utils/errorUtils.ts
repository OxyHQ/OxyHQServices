import type { ApiError } from '../models/interfaces';
import { logger } from './loggerUtils';

/**
 * Error handling utilities for consistent error processing
 */

/**
 * Common error codes
 */
export const ErrorCodes = {
  // Authentication errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_TOKEN: 'INVALID_TOKEN',
  MISSING_TOKEN: 'MISSING_TOKEN',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  INVALID_FORMAT: 'INVALID_FORMAT',
  
  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  
  // Server errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  
  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  CONNECTION_FAILED: 'CONNECTION_FAILED'
} as const;

/**
 * Create a standardized API error
 */
export function createApiError(
  message: string,
  code: string = ErrorCodes.INTERNAL_ERROR,
  status = 500,
  details?: Record<string, unknown>
): ApiError {
  return {
    message,
    code,
    status,
    details
  };
}

/**
 * Handle common HTTP errors and convert to ApiError
 */
export function handleHttpError(error: unknown): ApiError {
  // If it's already an ApiError, ensure it has a non-empty message
  if (error && typeof error === 'object' && 'code' in error && 'status' in error) {
    const apiError = error as ApiError;
    // Ensure message is not empty
    if (!apiError.message || !apiError.message.trim()) {
      return {
        ...apiError,
        message: apiError.message || 'An error occurred',
      };
    }
    return apiError;
  }

  // Handle AbortError (timeout or cancelled requests)
  if (error instanceof Error && error.name === 'AbortError') {
    return createApiError(
      'Request timeout or cancelled',
      ErrorCodes.TIMEOUT,
      0
    );
  }

  // Handle TypeError (network failures, CORS, etc.)
  if (error instanceof TypeError) {
    // Check if it's a network-related TypeError
    if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('Failed to fetch')) {
      return createApiError(
        'Network error - failed to connect to server',
        ErrorCodes.NETWORK_ERROR,
        0
      );
    }
    return createApiError(
      error.message || 'Network error occurred',
      ErrorCodes.NETWORK_ERROR,
      0
    );
  }

  // Handle fetch Response errors - check if it has response property with status
  if (error && typeof error === 'object' && 'response' in error) {
    const fetchError = error as { 
      response?: { 
        status: number; 
        statusText?: string;
      };
      status?: number;
      message?: string;
    };
    
    const status = fetchError.response?.status || fetchError.status;
    if (status) {
      return createApiError(
        fetchError.message || `HTTP ${status} error`,
        getErrorCodeFromStatus(status),
        status
      );
    }
  }

  // Handle standard errors
  if (error instanceof Error) {
    // Check for common error patterns
    if (error.message.includes('timeout') || error.message.includes('aborted')) {
      return createApiError(
        'Request timeout',
        ErrorCodes.TIMEOUT,
        0
      );
    }
    
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return createApiError(
        error.message || 'Network error occurred',
        ErrorCodes.NETWORK_ERROR,
        0
      );
    }

    return createApiError(
      error.message || 'Unknown error occurred',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }

  // Handle other errors - ensure we always return a non-empty message
  const errorString = error ? String(error) : '';
  const message = errorString.trim() || 'Unknown error occurred';
  return createApiError(
    message,
    ErrorCodes.INTERNAL_ERROR,
    500
  );
}

/**
 * Get error code from HTTP status
 * Exported for use in other modules
 */
export function getErrorCodeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return ErrorCodes.BAD_REQUEST;
    case 401:
      return ErrorCodes.UNAUTHORIZED;
    case 403:
      return ErrorCodes.FORBIDDEN;
    case 404:
      return ErrorCodes.NOT_FOUND;
    case 409:
      return ErrorCodes.CONFLICT;
    case 422:
      return ErrorCodes.VALIDATION_ERROR;
    case 500:
      return ErrorCodes.INTERNAL_ERROR;
    case 503:
      return ErrorCodes.SERVICE_UNAVAILABLE;
    default:
      return ErrorCodes.INTERNAL_ERROR;
  }
}

/**
 * Validate required fields and throw error if missing
 */
export function validateRequiredFields(data: Record<string, unknown>, fields: string[]): void {
  const missing = fields.filter(field => !data[field]);
  
  if (missing.length > 0) {
    throw createApiError(
      `Missing required fields: ${missing.join(', ')}`,
      ErrorCodes.MISSING_PARAMETER,
      400
    );
  }
}

/**
 * Safe error logging with context
 */
export function logError(error: unknown, context?: string): void {
  if (error instanceof Error) {
    logger.error(error.message, {
      component: context || 'errorUtils',
      method: 'logError',
      stack: error.stack,
    });
  } else {
    logger.error(String(error), {
      component: context || 'errorUtils',
      method: 'logError',
    });
  }
}

/**
 * Retry function with exponential backoff
 * Re-exports retryAsync for backward compatibility
 * @deprecated Use retryAsync from asyncUtils instead
 */
export { retryAsync as retryWithBackoff } from './asyncUtils'; 