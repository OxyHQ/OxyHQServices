import React, { useMemo } from 'react';
import { StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { ThemedText } from '@/components/themed-text';
import { AccountCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import type { GroupedItem } from '@/components/sections/types';

/**
 * "Account recovery" section (native only). Renders a single row linking to
 * the about-identity screen where the recovery phrase is managed. Returns
 * `null` on web, matching the screen's original `Platform.OS !== 'web'` gate.
 */
export function AccountRecoverySection() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();

  const items = useMemo<GroupedItem[]>(() => [{
    id: 'manage-recovery',
    icon: 'shield-key-outline',
    iconColor: colors.warning,
    title: t('security.recovery.title'),
    subtitle: t('security.recovery.subtitle'),
    onPress: () => router.push('/(tabs)/about-identity'),
    showChevron: true,
  }], [colors.warning, router, t]);

  if (Platform.OS === 'web') {
    return null;
  }

  return (
    <Section title={t('security.sections.accountRecovery')}>
      <ThemedText style={styles.sectionSubtitle}>{t('security.sections.accountRecoverySubtitle')}</ThemedText>
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
