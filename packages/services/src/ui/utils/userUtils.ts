/**
 * User display name and date formatting utilities.
 *
 * Display-name helpers follow the API contract: prefer `name.displayName` when
 * present, otherwise fall back to the normalized handle. The legacy
 * `getAccountDisplayName` chain is only used as a last resort for local
 * account-switcher surfaces without a handle.
 */

import {
  getAccountDisplayName as coreGetAccountDisplayName,
  getNormalizedUserHandle,
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

function readDisplayName(user: DisplayNameUserShape | null | undefined): string {
  const name = user?.name;
  if (!name || typeof name !== 'object') return '';
  return typeof name.displayName === 'string' ? name.displayName.trim() : '';
}

/**
 * Gets a display name from user data.
 *
 * Prefers API `name.displayName`, then the normalized handle, then the local
 * account-switcher fallback chain.
 */
export const getDisplayName = (
  user: DisplayNameUserShape | null | undefined,
  locale?: string,
): string => {
  const displayName = readDisplayName(user);
  if (displayName) return displayName;

  const handle = getNormalizedUserHandle(user);
  if (handle) return handle;

  return coreGetAccountDisplayName(user, locale);
};

/**
 * Gets a short display name (first token) for compact UI.
 */
export const getShortDisplayName = (
  user: DisplayNameUserShape | null | undefined,
  locale?: string,
): string => {
  const displayName = readDisplayName(user);
  if (displayName) {
    const firstToken = displayName.split(/\s+/).find(Boolean);
    if (firstToken) return firstToken;
  }

  const name = user?.name;
  if (name && typeof name === 'object') {
    const first = typeof name.first === 'string' ? name.first.trim() : '';
    if (first) return first.split(/\s+/)[0] ?? first;
    const full = typeof name.full === 'string' ? name.full.trim() : '';
    if (full) return full.split(/\s+/)[0] ?? full;
  } else if (typeof name === 'string' && name.trim()) {
    return name.trim().split(/\s+/)[0] ?? name.trim();
  }

  const handle = getNormalizedUserHandle(user);
  if (handle) return handle;

  return coreGetAccountDisplayName(user, locale);
};
