/**
 * Date formatting and display-name utilities for the accounts app.
 *
 * The display-name helpers are thin wrappers around the canonical
 * `getAccountDisplayName` in `@oxyhq/core`, so every UI surface in the Oxy
 * ecosystem resolves names through the same fallback chain
 * (name → composed first+last → username → `Account 0x12345678…` → translated
 * "Unnamed").
 */

import {
  getAccountDisplayName as coreGetAccountDisplayName,
  type DisplayNameUserShape,
} from '@oxyhq/core';

/**
 * Formats a date string to a readable format (e.g., "Feb 21, 2025")
 */
export const formatDate = (dateString: string | undefined | null): string => {
  if (!dateString) return '';

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

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
 */
export const getDisplayName = (
  user: DisplayNameUserShape | null | undefined,
  locale?: string,
): string => coreGetAccountDisplayName(user, locale);

/**
 * Gets a short display name (first name or username).
 *
 * Falls back to the canonical helper for publicKey/unnamed cases.
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

  return coreGetAccountDisplayName(user, locale);
};
