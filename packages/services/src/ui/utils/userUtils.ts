/**
 * User display name and date formatting utilities.
 *
 * The display-name helpers are thin wrappers around the canonical
 * `getAccountDisplayName` in `@oxyhq/core`, which handles all the edge cases
 * (missing username, missing name, fallback to truncated `publicKey`, i18n).
 */

import {
  getAccountDisplayName as coreGetAccountDisplayName,
  type DisplayNameUserShape,
} from '@oxyhq/core';

/**
 * Formats a date string to a readable format (e.g., "Feb 21, 2025")
 */
export const formatDate = (dateString: string | undefined | null | Date): string => {
  if (!dateString) return '';

  try {
    const date = dateString instanceof Date ? dateString : new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
};

/**
 * Gets a display name from user data.
 *
 * Prefers full name → composed first+last → username → `Account 0x12345678…`
 * (derived from publicKey) → translated "Unnamed".
 *
 * @param user - User-like object with optional name/username/publicKey
 * @param locale - Optional locale for the final fallback label
 */
export const getDisplayName = (
  user: DisplayNameUserShape | null | undefined,
  locale?: string,
): string => coreGetAccountDisplayName(user, locale);

/**
 * Gets a short display name (first name or username).
 *
 * Used for compact UI (e.g. greetings). Falls back to the full display name
 * helper, which also handles publicKey-only accounts.
 */
export const getShortDisplayName = (
  user: DisplayNameUserShape | null | undefined,
  locale?: string,
): string => {
  if (!user) return coreGetAccountDisplayName(user, locale);

  const name = user.name;
  if (name && typeof name === 'object') {
    const first = typeof name.first === 'string' ? name.first.trim() : '';
    if (first) return first;
    const full = typeof name.full === 'string' ? name.full.trim() : '';
    if (full) return full.split(' ')[0];
  } else if (typeof name === 'string' && name.trim()) {
    return name.trim().split(' ')[0];
  }

  if (typeof user.username === 'string' && user.username.trim()) return user.username.trim();

  // Defer to the canonical helper for publicKey/unnamed fallbacks.
  return coreGetAccountDisplayName(user, locale);
};
