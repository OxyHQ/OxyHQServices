import React, { useMemo } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import faircoinImage from '@/assets/images/faircoin.jpg';
import type { GroupedItem } from '@/components/sections/types';

/**
 * "About" section: explanatory cards covering FairCoin, Oxy Pay, FAIRWallet,
 * security, and supported payment methods.
 */
export function PaymentsInfoSection() {
  const colors = useColors();
  const { t } = useTranslation();

  const items = useMemo<GroupedItem[]>(() => [
    {
      id: 'faircoin',
      customIcon: (
        <View style={[styles.faircoinIcon, { backgroundColor: colors.sidebarIconPayments }]}>
          <Image
            source={faircoinImage}
            style={styles.faircoinIconImage}
            resizeMode="cover"
          />
        </View>
      ),
      title: t('payments.info.fairCoin'),
      subtitle: t('payments.info.fairCoinBody'),
    },
    {
      id: 'oxy-pay',
      icon: 'wallet-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: t('payments.info.oxyPay'),
      subtitle: t('payments.info.oxyPayBody'),
    },
    {
      id: 'fairwallet',
      icon: 'qrcode-scan',
      iconColor: colors.sidebarIconSharing,
      title: t('payments.info.fairwallet'),
      subtitle: t('payments.info.fairwalletBody'),
    },
    {
      id: 'security',
      icon: 'shield-check-outline',
      iconColor: colors.sidebarIconSecurity,
      title: t('payments.info.security'),
      subtitle: t('payments.info.securityBody'),
    },
    {
      id: 'payment-methods',
      icon: 'credit-card-outline',
      iconColor: colors.sidebarIconData,
      title: t('payments.info.paymentMethods'),
      subtitle: t('payments.info.paymentMethodsBody'),
    },
  ], [colors, t]);

  return (
    <Section title={t('payments.sections.about')}>
      <AccountCard>
        <GroupedSection items={items} />
      </AccountCard>
    </Section>
  );
}

const styles = StyleSheet.create({
  faircoinIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  faircoinIconImage: {
    width: 36,
    height: 36,
  },
});
