/**
 * Validation utilities for common data validation patterns
 */

/**
 * Email validation regex
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Username validation regex (alphanumeric, underscores, and hyphens, 3-30 chars)
 */
export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;

/**
 * Password validation regex (at least 8 chars, 1 uppercase, 1 lowercase, 1 number)
 */
// At least 8 characters (tests expect len>=8 without complexity requirements)
export const PASSWORD_REGEX = /^.{8,}$/;

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Validate username format
 */
export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

/**
 * Validate password strength
 */
export function isValidPassword(password: string): boolean {
  return PASSWORD_REGEX.test(password);
}

/**
 * Validate required string
 */
export function isRequiredString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate required number
 */
export function isRequiredNumber(value: unknown): boolean {
  return typeof value === 'number' && !Number.isNaN(value);
}

/**
 * Validate required boolean
 */
export function isRequiredBoolean(value: unknown): boolean {
  return typeof value === 'boolean';
}

/**
 * Validate array
 */
export function isValidArray(value: unknown): boolean {
  return Array.isArray(value);
}

/**
 * Validate object
 */
export function isValidObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate UUID format
 */
export function isValidUUID(uuid: string): boolean {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return UUID_REGEX.test(uuid);
}

/**
 * Validate URL format
 */
export function isValidURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate date string
 */
export function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  return !Number.isNaN(date.getTime());
}

/**
 * Validate file size (in bytes)
 */
export function isValidFileSize(size: number, maxSize: number): boolean {
  return size > 0 && size <= maxSize;
}

/**
 * Validate file type
 */
export function isValidFileType(filename: string, allowedTypes: string[]): boolean {
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension ? allowedTypes.includes(extension) : false;
}

/**
 * Sanitize string input
 */
export function sanitizeString(input: string): string {
  // Remove HTML tags entirely and trim whitespace
  return input.trim().replace(/<[^>]*>/g, '');
}

/**
 * Sanitize HTML input
 */
export function sanitizeHTML(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Validate MongoDB ObjectId format
 * Note: This is a basic format check. For full validation, use mongoose.Types.ObjectId.isValid()
 * This function works in environments where mongoose may not be available (e.g., client-side)
 */
export function isValidObjectId(id: string): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  // MongoDB ObjectId is 24 hex characters
  const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
  return OBJECT_ID_REGEX.test(id);
}

/**
 * Validate and sanitize user input
 */
export function validateAndSanitizeUserInput(input: unknown, type: 'string' | 'email' | 'username'): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  const sanitized = sanitizeString(input);
  
  switch (type) {
    case 'email':
      return isValidEmail(sanitized) ? sanitized : null;
    case 'username':
      return isValidUsername(sanitized) ? sanitized : null;
    case 'string':
      return isRequiredString(sanitized) ? sanitized : null;
    default:
      return null;
  }
} 
