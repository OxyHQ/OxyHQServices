/**
 * Validation utilities for common data validation patterns
 */

/**
 * Email validation regex
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Username validation regex (alphanumeric, underscore, dash, 3-30 chars)
 */
export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;

/**
 * Password validation regex (at least 8 chars, 1 uppercase, 1 lowercase, 1 number)
 */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;

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
  return input.trim().replace(/[<>]/g, '');
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

/**
 * Check if value is not null or undefined
 */
export function isNotNullOrUndefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Safe property access - returns null if object is null/undefined
 */
export function safeGet<T, K extends keyof T>(obj: T | null | undefined, key: K): T[K] | null {
  return isNotNullOrUndefined(obj) ? obj[key] : null;
}

/**
 * Safe method call - only calls if object and method exist
 */
export function safeCall<T, K extends keyof T>(
  obj: T | null | undefined, 
  method: K, 
  ...args: T[K] extends (...args: any[]) => any ? Parameters<T[K]> : never[]
): T[K] extends (...args: any[]) => any ? ReturnType<T[K]> | null : null {
  if (isNotNullOrUndefined(obj) && typeof obj[method] === 'function') {
    return (obj[method] as any)(...args);
  }
  return null;
}

/**
 * Validate service instance is ready for use
 */
export function validateServiceInstance(service: unknown, serviceName = 'Service'): void {
  if (!isNotNullOrUndefined(service)) {
    throw new Error(`${serviceName} instance is not initialized or has been cleared`);
  }
  
  if (typeof service !== 'object') {
    throw new Error(`${serviceName} instance is not a valid object`);
  }
}

/**
 * Safe async method call with error handling
 */
export async function safeAsyncCall<T>(
  asyncFn: () => Promise<T>,
  fallbackValue: T,
  errorMessage?: string
): Promise<T> {
  try {
    return await asyncFn();
  } catch (error) {
    console.error(errorMessage || 'Async operation failed:', error);
    return fallbackValue;
  }
} 