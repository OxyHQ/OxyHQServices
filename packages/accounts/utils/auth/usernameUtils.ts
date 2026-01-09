import {
  USERNAME_ADJECTIVES,
  USERNAME_NOUNS,
  USERNAME_MIN_LENGTH,
  USERNAME_REGEX,
  USERNAME_NUM_SUFFIX_MIN,
  USERNAME_NUM_SUFFIX_MAX,
} from '@/constants/auth';

/**
 * Generate a random username suggestion
 * 
 * @param publicKey - Optional public key (currently unused, kept for backward compatibility)
 * @returns A random username suggestion
 */
export function generateSuggestedUsername(publicKey: string | null): string {
  // Select random adjective and noun
  const adjIndex = Math.floor(Math.random() * USERNAME_ADJECTIVES.length);
  const nounIndex = Math.floor(Math.random() * USERNAME_NOUNS.length);

  // Generate a random number suffix
  const numSuffix = Math.floor(Math.random() * (USERNAME_NUM_SUFFIX_MAX - USERNAME_NUM_SUFFIX_MIN + 1)) + USERNAME_NUM_SUFFIX_MIN;

  const adjective = USERNAME_ADJECTIVES[adjIndex];
  const noun = USERNAME_NOUNS[nounIndex];

  return `${adjective}${noun}${numSuffix}`;
}

/**
 * Validate username format
 * 
 * @param username - The username to validate
 * @returns True if the username format is valid
 */
export function validateUsernameFormat(username: string): boolean {
  return username.length >= USERNAME_MIN_LENGTH && USERNAME_REGEX.test(username);
}

/**
 * Check if username is valid (format and length)
 * 
 * @param username - The username to validate
 * @returns True if the username is valid
 */
export function isValidUsername(username: string): boolean {
  return validateUsernameFormat(username);
}

/**
 * Sanitize username input (remove invalid characters, convert to lowercase)
 * 
 * @param input - The raw input string
 * @returns Sanitized username
 */
export function sanitizeUsernameInput(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

