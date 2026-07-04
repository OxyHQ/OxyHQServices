import React from 'react';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { ThemedText } from '@/components/themed-text';
import { AccountCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import { useConnectedApps } from '@/hooks/useConnectedApps';

/**
 * "Connected apps" entry on the security screen: a count-aware subtitle plus a
 * single navigation row into the third-party connections screen (`family`
 * route) where the user reviews and revokes the third-party apps they've
 * authorized.
 *
 * The count is read from the shared {@link useConnectedApps} query (cached and
 * reused by the destination screen), so this adds no extra steady-state fetch.
 */
export function ConnectedAppsSection() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useTranslation();
  const { data } = useConnectedApps();

  // Until the first read resolves we show a neutral description rather than a
  // count, so the row never flashes "0 apps" before the data lands.
  const subtitle = data
    ? t('connectedApps.summary', { count: data.length })
    : t('connectedApps.summaryPending');

  return (
    <Section title={t('security.sections.connectedApps')}>
      <ThemedText style={styles.sectionSubtitle}>{subtitle}</ThemedText>
      <AccountCard>
        <GroupedSection
          items={[
            {
              id: 'connected-apps',
              icon: 'apps',
              iconColor: colors.sidebarIconFamily,
              title: t('connectedApps.manageRow'),
              subtitle: t('connectedApps.manageRowSubtitle'),
              onPress: () => router.push('/(tabs)/family'),
              showChevron: true,
            },
          ]}
        />
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
