import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { ThemedText } from '@/components/themed-text';
import { LinkButton, AccountCard, EmptyStateCard } from '@/components/ui';
import { useTranslation } from '@/lib/i18n';
import type { GroupedItem } from '@/components/sections/types';

interface DevicesSectionProps {
  items: GroupedItem[];
  deviceCount: number;
}

/**
 * "Your devices" section: a subtitle with the device count, the grouped device
 * rows with a "manage all" link, or an empty state when there are no devices.
 *
 * Extracted from the security screen's `renderContent`.
 */
export function DevicesSection({ items, deviceCount }: DevicesSectionProps) {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <Section title={t('security.sections.yourDevices')}>
      <ThemedText style={styles.sectionSubtitle}>
        {t('security.sections.yourDevicesSubtitle', { count: deviceCount })}
      </ThemedText>
      {items.length > 0 ? (
        <>
          <AccountCard>
            <GroupedSection items={items} />
          </AccountCard>
          <View style={styles.linkButtonWrapper}>
            <LinkButton
              text={t('security.devices.manageAll')}
              count={deviceCount.toString()}
              onPress={() => router.push('/(tabs)/devices')}
            />
          </View>
        </>
      ) : (
        <EmptyStateCard
          icon="devices"
          title={t('security.devices.noDevices')}
          subtitle={t('security.devices.noDevicesSubtitle')}
        />
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  sectionSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  linkButtonWrapper: {
    marginTop: -8,
  },
});
