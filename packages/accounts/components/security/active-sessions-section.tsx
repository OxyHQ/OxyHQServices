import React from 'react';
import { StyleSheet } from 'react-native';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { ThemedText } from '@/components/themed-text';
import { AccountCard } from '@/components/ui';
import { useTranslation } from '@/lib/i18n';
import type { GroupedItem } from '@/components/sections/types';

interface ActiveSessionsSectionProps {
  items: GroupedItem[];
}

/**
 * "Active sessions" section: a subtitle plus the (optional) "log out all"
 * action row. Returns `null` when there are no items, matching the screen's
 * original conditional rendering.
 */
export function ActiveSessionsSection({ items }: ActiveSessionsSectionProps) {
  const { t } = useTranslation();

  if (items.length === 0) {
    return null;
  }

  return (
    <Section title={t('security.sections.activeSessions')}>
      <ThemedText style={styles.sectionSubtitle}>
        {t('security.sections.activeSessionsSubtitle')}
      </ThemedText>
      <AccountCard>
        <GroupedSection items={items} />
      </AccountCard>
    </Section>
  );
}

const styles = StyleSheet.create({
  sectionSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
});
