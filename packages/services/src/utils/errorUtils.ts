import type { ApiError } from '../models/interfaces';

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
  // If it's already an ApiError, return it
  if (error && typeof error === 'object' && 'code' in error && 'status' in error) {
    return error as ApiError;
  }

  // Handle axios errors
  if (error?.response) {
    const { status, data } = error.response;
    
    return createApiError(
      data?.message || `HTTP ${status} error`,
      data?.code || getErrorCodeFromStatus(status),
      status,
      data
    );
  }

  // Handle network errors
  if (error?.request) {
    return createApiError(
      'Network error - no response received',
      ErrorCodes.NETWORK_ERROR,
      0
    );
  }

  // Handle other errors
  return createApiError(
    error?.message || 'Unknown error occurred',
    ErrorCodes.INTERNAL_ERROR,
    500
  );
}

/**
 * Get error code from HTTP status
 */
function getErrorCodeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return ErrorCodes.VALIDATION_ERROR;
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
  const prefix = context ? `[${context}]` : '[Error]';
  
  if (error instanceof Error) {
    console.error(`${prefix} ${error.message}`, error.stack);
  } else {
    console.error(`${prefix}`, error);
  }
}

/**
 * Retry function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        break;
      }
      
      const delay = baseDelay * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
} 