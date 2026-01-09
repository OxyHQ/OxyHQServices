/**
 * Utility functions for error handling in identity operations
 */

/**
 * Check if an error indicates the user is already registered.
 * The backend should always return HTTP 409 for duplicate registrations.
 */
export const isAlreadyRegisteredError = (error: unknown): boolean => {
  if (!error) return false;
  
  const status = (error as any)?.status;
  return status === 409;
};
