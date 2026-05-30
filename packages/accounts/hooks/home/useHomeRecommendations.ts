import { useMemo } from 'react';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import type { PrioritizedGroupedItem } from '@/components/sections/types';
import type { HomeHandlers } from './useHomeHandlers';

interface UseHomeRecommendationsArgs {
  username: string | undefined;
  handleSetUsername: HomeHandlers['handleSetUsername'];
}

/**
 * Builds the home screen's recommendation rows (sorted by ascending priority).
 * Currently surfaces a single "set a username" recommendation when the user
 * has not chosen one. Extracted verbatim from the screen's inline `useMemo`.
 */
export function useHomeRecommendations({
  username,
  handleSetUsername,
}: UseHomeRecommendationsArgs): PrioritizedGroupedItem[] {
  const colors = useColors();
  const { t } = useTranslation();

  return useMemo(() => {
    const recs: PrioritizedGroupedItem[] = [];

    // Check if username is missing
    if (!username) {
      recs.push({
        id: 'set-username',
        priority: 1,
        icon: 'account-outline',
        iconColor: colors.warning,
        title: t('home.recommendations.setUsername'),
        subtitle: t('home.recommendations.setUsernameSubtitle'),
        onPress: handleSetUsername,
        showChevron: true,
      });
    }

    // Sort by priority (lower number = higher priority)
    return recs.sort((a, b) => a.priority - b.priority);
  }, [username, colors.warning, handleSetUsername, t]);
}
