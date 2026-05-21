/**
 * Utility functions for error handling in identity operations
 */

/**
 * Type guard for errors that expose a numeric `status` field
 * (e.g. fetch-style errors, ApiError instances from @oxyhq/core).
 */
function hasNumericStatus(e: unknown): e is { status: number } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'status' in e &&
    typeof (e as { status: unknown }).status === 'number'
  );
}

/**
 * Check if an error indicates the user is already registered.
 * The backend should always return HTTP 409 for duplicate registrations.
 */
export const isAlreadyRegisteredError = (error: unknown): boolean => {
  if (!error) return false;
  return hasNumericStatus(error) && error.status === 409;
};
