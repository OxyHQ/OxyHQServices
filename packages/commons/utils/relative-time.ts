/**
 * Shared, i18n-aware relative-time formatting for the accounts app.
 *
 * Replaces the eight ad-hoc `formatRelativeTime` copies that previously lived
 * in the home, security, storage, sessions, about-identity, and device
 * screens — several of which hardcoded English strings. Everything now flows
 * through the app's translation layer so Spanish-first (and every other
 * supported locale's) users see localized output.
 *
 * Buckets (matching the prior behaviour):
 *   < 1 minute   → "Just now"
 *   < 60 minutes → "{n}m ago"
 *   < 24 hours   → "{n}h ago"
 *   < 7 days     → "{n}d ago"
 *   otherwise    → absolute date via `formatDate`
 */

import type { TranslateFn } from '@/lib/i18n';
import { formatDate } from './date-utils';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

/**
 * Format an ISO date string as a localized relative-time label.
 *
 * @param dateString - ISO date string (or `undefined`/`null` for unknown).
 * @param t - The translation function from `useTranslation`.
 * @param emptyFallback - What to return when `dateString` is missing. Defaults
 *   to an empty string (the behaviour the activity/security screens relied on);
 *   the device screens pass `t('common.unknown')` for a visible placeholder.
 */
export function formatRelativeTime(
  dateString: string | undefined | null,
  t: TranslateFn,
  emptyFallback = '',
): string {
  if (!dateString) return emptyFallback;

  const date = new Date(dateString);
  const time = date.getTime();
  if (Number.isNaN(time)) return emptyFallback;

  const diffMs = Date.now() - time;
  const minutes = Math.floor(diffMs / MS_PER_MINUTE);

  if (minutes < 1) return t('common.relativeTime.justNow');
  if (minutes < MINUTES_PER_HOUR) {
    return t('common.relativeTime.minutesAgo', { count: minutes });
  }

  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) {
    return t('common.relativeTime.hoursAgo', { count: hours });
  }

  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days < DAYS_PER_WEEK) {
    return t('common.relativeTime.daysAgo', { count: days });
  }

  return formatDate(dateString);
}
