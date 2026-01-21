import crypto from 'crypto';
import { hash as argon2Hash, verify as argon2Verify, Options } from '@node-rs/argon2';

export const PASSWORD_MIN_LENGTH = 12;

// Argon2id configuration (OWASP recommended parameters)
const ARGON2_OPTIONS: Options = {
  memoryCost: 19456, // 19 MiB (OWASP minimum for Argon2id)
  timeCost: 2, // 2 iterations
  parallelism: 1, // Single thread
  outputLen: 32, // 32-byte output
};

/**
 * Hash password using Argon2id
 * Format: $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 */
export async function hashPassword(password: string): Promise<string> {
  return await argon2Hash(password, ARGON2_OPTIONS);
}

/**
 * Verify password against Argon2 hash
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    return await argon2Verify(storedHash, password);
  } catch (error) {
    return false;
  }
}

export function generateNumericCode(length: number = 6): string {
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, '0');
}

/**
 * Generates a cryptographically secure alphanumeric code
 * Uses uppercase letters and digits, excluding ambiguous characters (0, O, 1, I, L)
 * for better readability and user experience
 */
export function generateAlphanumericCode(length: number = 8): string {
  // Character set: digits 2-9 and uppercase A-Z excluding O, I, L
  // This gives us 31 characters and avoids confusion between 0/O, 1/I/L
  const charset = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const charsetLength = charset.length;

  let code = '';
  const randomValues = crypto.randomBytes(length);

  for (let i = 0; i < length; i++) {
    const randomIndex = randomValues[i] % charsetLength;
    code += charset[randomIndex];
  }

  return code;
}

/**
 * Validates password strength according to security requirements
 * @param password - The password to validate
 * @returns Object with validation result and specific error messages
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Check for common patterns that make passwords weak
  if (/^(.)\1+$/.test(password)) {
    errors.push('Password cannot consist of repeated characters');
  }

  if (/^(012|123|234|345|456|567|678|789|890|abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)/i.test(password)) {
    errors.push('Password cannot contain common sequential patterns');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
