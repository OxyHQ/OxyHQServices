/**
 * Username Validation Utilities
 * 
 * Centralized username validation logic to ensure consistency across
 * registration, profile updates, and all service functions.
 */

// Username validation constants
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_REGEX = /^[a-zA-Z0-9]{3,30}$/;

/**
 * Validation result with detailed information
 */
export interface UsernameValidationResult {
  valid: boolean;
  trimmedUsername?: string;
  error?: string;
}

/**
 * Validate username format
 * 
 * Rules:
 * - 3-30 characters long
 * - Only alphanumeric characters (a-z, A-Z, 0-9)
 * - No spaces or special characters
 * 
 * @param username - The username to validate
 * @returns Validation result with trimmed username if valid
 */
export function validateUsername(username: unknown): UsernameValidationResult {
  // Check if username is a string
  if (typeof username !== 'string') {
    return {
      valid: false,
      error: 'Username must be a string',
    };
  }

  // Trim whitespace once
  const trimmedUsername = username.trim();

  // Check if empty after trimming
  if (!trimmedUsername) {
    return {
      valid: false,
      error: 'Username cannot be empty',
    };
  }

  // Check length
  if (trimmedUsername.length < USERNAME_MIN_LENGTH) {
    return {
      valid: false,
      error: `Username must be at least ${USERNAME_MIN_LENGTH} characters long`,
    };
  }

  if (trimmedUsername.length > USERNAME_MAX_LENGTH) {
    return {
      valid: false,
      error: `Username cannot exceed ${USERNAME_MAX_LENGTH} characters`,
    };
  }

  // Check format (alphanumeric only)
  if (!USERNAME_REGEX.test(trimmedUsername)) {
    return {
      valid: false,
      error: 'Username must contain only letters and numbers',
    };
  }

  return {
    valid: true,
    trimmedUsername,
  };
}

/**
 * Validate and sanitize username input
 * Throws an error if validation fails
 * 
 * @param username - The username to validate
 * @returns The trimmed, validated username
 * @throws Error if validation fails
 */
export function validateAndSanitizeUsername(username: unknown): string {
  const result = validateUsername(username);
  
  if (!result.valid) {
    throw new Error(result.error || 'Invalid username');
  }
  
  return result.trimmedUsername!;
}

/**
 * Check if a value is a valid username (convenience function)
 * 
 * @param username - The username to check
 * @returns True if valid, false otherwise
 */
export function isValidUsername(username: unknown): boolean {
  return validateUsername(username).valid;
}
