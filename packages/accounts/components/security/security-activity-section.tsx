import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { alert } from '@oxyhq/bloom';
import type { SecurityActivity } from '@oxyhq/core';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { ThemedText } from '@/components/themed-text';
import { LinkButton, AccountCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { getEventSeverity, formatEventDescription } from '@/utils/security-utils';
import type { GroupedItem } from '@/components/sections/types';

/** Recent activity rows shown before the "review all" link kicks in. */
const RECENT_ACTIVITY_VISIBLE_COUNT = 5;

interface SecurityActivitySectionProps {
  items: GroupedItem[];
  securityActivities: SecurityActivity[];
  isLoading: boolean;
}

/**
 * Recent security activity section: a loading state, the activity rows with a
 * "review all" link (which opens a full activity-list alert), or an empty
 * state when there is no activity.
 *
 * Extracted from the security screen's `renderContent`; visual output and the
 * conditional branches are unchanged.
 */
export function SecurityActivitySection({
  items,
  securityActivities,
  isLoading,
}: SecurityActivitySectionProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const formatRelativeTime = useRelativeTime();

  return (
    <Section title={t('security.sections.recentActivity')}>
      {isLoading ? (
        <AccountCard>
          <View style={styles.emptyStateContainer}>
            <ActivityIndicator size="small" color={colors.tint} />
            <ThemedText style={[styles.emptyStateSubtitle, styles.loadingSubtitle, { color: colors.text }]}>
              {t('security.activity.loading')}
            </ThemedText>
          </View>
        </AccountCard>
      ) : items.length > 0 ? (
        <>
          <AccountCard>
            <GroupedSection items={items} />
          </AccountCard>
          <View style={styles.linkButtonWrapper}>
            <LinkButton
              text={t('security.activity.reviewCta')}
              count={securityActivities.length > RECENT_ACTIVITY_VISIBLE_COUNT ? t('security.activity.moreCount', { count: securityActivities.length - RECENT_ACTIVITY_VISIBLE_COUNT }) : undefined}
              onPress={() => {
                // Show all activities in an alert with details
                const allActivities = securityActivities.map((activity: SecurityActivity) => {
                  const severity = activity.severity || getEventSeverity(activity.eventType);
                  return `• ${formatEventDescription(activity)} (${severity}) - ${formatRelativeTime(activity.timestamp)}`;
                }).join('\n\n');

                alert(
                  t('security.activity.allTitle'),
                  allActivities || t('security.activity.allEmpty'),
                  [{ text: t('common.ok'), style: 'default' }]
                );
              }}
            />
          </View>
        </>
      ) : (
        <AccountCard>
          <View style={styles.emptyStateContainer}>
            <MaterialCommunityIcons
              name="shield-check-outline"
              size={40}
              color={colors.text}
              style={styles.emptyStateIcon}
            />
            <ThemedText style={[styles.emptyStateTitle, { color: colors.text }]}>
              {t('security.activity.noActivity')}
            </ThemedText>
            <ThemedText style={[styles.emptyStateSubtitle, { color: colors.text }]}>
              {t('security.activity.noActivitySubtitle')}
            </ThemedText>
          </View>
        </AccountCard>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  linkButtonWrapper: {
    marginTop: -8,
  },
  loadingSubtitle: {
    marginTop: 12,
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  emptyStateIcon: {
    opacity: 0.4,
    marginBottom: 12,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
    opacity: 0.8,
  },
  emptyStateSubtitle: {
    fontSize: 13,
    opacity: 0.6,
    textAlign: 'center',
    lineHeight: 18,
  },
});
