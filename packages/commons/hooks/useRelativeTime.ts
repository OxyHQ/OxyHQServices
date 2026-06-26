import { useCallback } from 'react';
import { useTranslation } from '@/lib/i18n';
import { formatRelativeTime } from '@/utils/relative-time';

/**
 * Returns a stable, i18n-aware `formatRelativeTime(dateString, emptyFallback?)`
 * function bound to the current locale.
 *
 * Consolidates the eight duplicated relative-time formatters that previously
 * lived in individual screens. The returned callback only changes identity
 * when the active translation function does, so it is safe to list in
 * `useMemo`/`useCallback` dependency arrays.
 */
export function useRelativeTime(): (
  dateString: string | undefined | null,
  emptyFallback?: string,
) => string {
  const { t } = useTranslation();

  return useCallback(
    (dateString: string | undefined | null, emptyFallback?: string) =>
      formatRelativeTime(dateString, t, emptyFallback),
    [t],
  );
}
