import type { ApiError } from '../../../models/interfaces';

type ErrorWithMessage = {
  message?: string;
};

type ErrorWithResponse = {
  response?: {
    status?: number;
    data?: {
      message?: string;
      error?: string;
    };
  };
};

export interface HandleAuthErrorOptions {
  defaultMessage: string;
  code: string;
  status?: number;
  onError?: (error: ApiError) => void;
  setAuthError?: (message: string) => void;
  logger?: (message: string, error?: unknown) => void;
}

const DEFAULT_INVALID_SESSION_MESSAGES = [
  'Invalid or expired session',
  'Session is invalid',
  'Session not found',
  'Session expired',
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getResponseStatus = (error: unknown): number | undefined => {
  if (!isObject(error)) return undefined;
  const response = (error as ErrorWithResponse).response;
  return response?.status;
};

/**
 * Determine whether the error represents an invalid session condition.
 * This centralizes 401 detection across different fetch clients.
 */
export const isInvalidSessionError = (error: unknown): boolean => {
  const status = getResponseStatus(error);
  if (status === 401) {
    return true;
  }

  if (!isObject(error)) {
    return false;
  }

  // Check error.status directly (HttpService sets this)
  if ((error as any).status === 401) {
    return true;
  }

  const normalizedMessage = extractErrorMessage(error)?.toLowerCase();
  if (!normalizedMessage) {
    return false;
  }

  // Check for HTTP 401 in message (HttpService creates errors with "HTTP 401:" format)
  if (normalizedMessage.includes('http 401') || normalizedMessage.includes('401')) {
    return true;
  }

  return DEFAULT_INVALID_SESSION_MESSAGES.some((msg) =>
    normalizedMessage.includes(msg.toLowerCase()),
  );
};

/**
 * Extract a consistent error message from unknown error shapes.
 *
 * @param error - The unknown error payload
 * @param fallbackMessage - Message to return when no concrete message is available
 */
export const extractErrorMessage = (
  error: unknown,
  fallbackMessage = 'Unexpected error',
): string => {
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (!isObject(error)) {
    return fallbackMessage;
  }

  const withMessage = error as ErrorWithMessage;
  if (withMessage.message && withMessage.message.trim().length > 0) {
    return withMessage.message;
  }

  const withResponse = error as ErrorWithResponse;
  const responseMessage =
    withResponse.response?.data?.message ?? withResponse.response?.data?.error;

  if (typeof responseMessage === 'string' && responseMessage.trim().length > 0) {
    return responseMessage;
  }

  return fallbackMessage;
};

/**
 * Centralized error handler for auth-related operations.
 *
 * @param error - Unknown error object
 * @param options - Error handling configuration
 * @returns Resolved error message
 */
export const handleAuthError = (
  error: unknown,
  {
    defaultMessage,
    code,
    status,
    onError,
    setAuthError,
    logger,
  }: HandleAuthErrorOptions,
): string => {
  const resolvedStatus = status ?? getResponseStatus(error) ?? (isInvalidSessionError(error) ? 401 : 500);
  const message = extractErrorMessage(error, defaultMessage);

  if (logger) {
    logger(message, error);
  }

  setAuthError?.(message);

  onError?.({
    message,
    code,
    status: resolvedStatus,
  });

  return message;
};


