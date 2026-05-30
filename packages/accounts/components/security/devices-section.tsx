import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { ThemedText } from '@/components/themed-text';
import { LinkButton, AccountCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
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
  const colors = useColors();
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
        <AccountCard>
          <View style={styles.emptyStateContainer}>
            <MaterialCommunityIcons
              name="devices"
              size={40}
              color={colors.text}
              style={styles.emptyStateIcon}
            />
            <ThemedText style={[styles.emptyStateTitle, { color: colors.text }]}>
              {t('security.devices.noDevices')}
            </ThemedText>
            <ThemedText style={[styles.emptyStateSubtitle, { color: colors.text }]}>
              {t('security.devices.noDevicesSubtitle')}
            </ThemedText>
          </View>
        </AccountCard>
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
