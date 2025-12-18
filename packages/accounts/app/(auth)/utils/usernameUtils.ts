import {
  USERNAME_ADJECTIVES,
  USERNAME_NOUNS,
  USERNAME_MIN_LENGTH,
  USERNAME_REGEX,
  USERNAME_NUM_SUFFIX_MIN,
  USERNAME_NUM_SUFFIX_MAX,
  USERNAME_FALLBACK_MIN,
  USERNAME_FALLBACK_MAX,
} from '../constants';

/**
 * Generate a deterministic username based on public key
 * Same public key always generates the same username
 * 
 * @param publicKey - The public key to generate username from
 * @returns A deterministic username suggestion
 */
export function generateSuggestedUsername(publicKey: string | null): string {
  if (!publicKey) {
    // Fallback to random if no public key available
    return Math.floor(USERNAME_FALLBACK_MIN + Math.random() * (USERNAME_FALLBACK_MAX - USERNAME_FALLBACK_MIN)).toString();
  }

  // Simple hash function to convert public key to numbers
  let hash = 0;
  for (let i = 0; i < publicKey.length; i++) {
    const char = publicKey.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  // Use absolute value and ensure positive
  const seed = Math.abs(hash);

  // Select adjective and noun based on hash
  const adjIndex = seed % USERNAME_ADJECTIVES.length;
  const nounIndex = ((seed >> 8) % USERNAME_NOUNS.length);

  // Generate a 2-3 digit number suffix based on hash
  const numSuffix = (seed % (USERNAME_NUM_SUFFIX_MAX - USERNAME_NUM_SUFFIX_MIN + 1)) + USERNAME_NUM_SUFFIX_MIN;

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

