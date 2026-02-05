/**
 * Input Sanitization Utilities
 *
 * Provides HTML entity escaping for user-provided text to prevent XSS attacks.
 * Apply to fields that will be rendered as HTML in client applications.
 * Do NOT apply to passwords, hashes, or binary data.
 */

/**
 * Escape HTML special characters to prevent XSS.
 *
 * Replaces: & < > " '
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitize a string if it's a string, otherwise return as-is.
 */
export function sanitizeString(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeHtml(value);
  }
  return value;
}

/**
 * Sanitize all string values in an object (shallow — one level deep).
 *
 * Skips fields listed in `skipFields` (e.g. passwords, tokens).
 */
export function sanitizeObject<T extends Record<string, unknown>>(
  obj: T,
  skipFields: string[] = []
): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (skipFields.includes(key)) continue;
    const value = result[key];
    if (typeof value === 'string') {
      (result as any)[key] = sanitizeHtml(value);
    }
  }
  return result;
}

/**
 * Sanitize user profile update fields.
 *
 * Applies HTML escaping to text fields that could be rendered in UI.
 * Skips: avatar (file ID), links (URLs), email, password.
 */
export function sanitizeProfileUpdate(updates: Record<string, unknown>): Record<string, unknown> {
  const skipFields = ['avatar', 'email', 'password', 'links', 'linksMetadata', 'locations'];
  const result = { ...updates };

  for (const key of Object.keys(result)) {
    if (skipFields.includes(key)) continue;
    const value = result[key];
    if (typeof value === 'string') {
      (result as any)[key] = sanitizeHtml(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Handle nested objects like `name: { first, last }`
      (result as any)[key] = sanitizeObject(value as Record<string, unknown>);
    }
  }

  return result;
}

/**
 * Escape regex metacharacters to prevent ReDoS and injection
 * when using user input in MongoDB $regex queries.
 */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize a search query string.
 *
 * Trims, limits length, escapes HTML, and escapes regex metacharacters
 * so the result is safe for use in MongoDB $regex queries.
 */
export function sanitizeSearchQuery(query: string, maxLength = 100): string {
  const trimmed = query.trim().slice(0, maxLength);
  const htmlSafe = sanitizeHtml(trimmed);
  return escapeRegex(htmlSafe);
}
