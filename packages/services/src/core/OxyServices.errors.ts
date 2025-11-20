/**
 * Custom error types for better error handling
 */
export class OxyAuthenticationError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code = 'AUTH_ERROR', status = 401) {
    super(message);
    this.name = 'OxyAuthenticationError';
    this.code = code;
    this.status = status;
  }
}

export class OxyAuthenticationTimeoutError extends OxyAuthenticationError {
  constructor(operationName: string, timeoutMs: number) {
    super(
      `Authentication timeout (${timeoutMs}ms): ${operationName} requires user authentication. Please ensure the user is logged in before calling this method.`,
      'AUTH_TIMEOUT',
      408
    );
    this.name = 'OxyAuthenticationTimeoutError';
  }
}

