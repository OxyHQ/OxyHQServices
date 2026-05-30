import React, { useMemo } from 'react';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import { formatFairCoinBalance } from '@/utils/payment-utils';
import type { GroupedItem } from '@/components/sections/types';

interface WalletSectionProps {
  /** Current FairCoin wallet balance, in FairCoin units. */
  balance: number;
}

/**
 * "Wallets" section: lists the user's Oxy Pay balance and the FAIRWallet entry.
 */
export function WalletSection({ balance }: WalletSectionProps) {
  const colors = useColors();
  const { t } = useTranslation();

  const items = useMemo<GroupedItem[]>(() => [
    {
      id: 'oxy-pay',
      icon: 'wallet-outline',
      iconColor: colors.sidebarIconPayments,
      title: t('payments.wallet.oxyPay'),
      subtitle: t('payments.wallet.oxyPaySubtitle', { balance: formatFairCoinBalance(balance) }),
    },
    {
      id: 'faircoin',
      icon: 'qrcode-scan',
      iconColor: colors.brandFairCoinScan,
      title: t('payments.wallet.fairwallet'),
      subtitle: t('payments.wallet.fairwalletSubtitle'),
    },
  ], [colors, balance, t]);

  return (
    <Section title={t('payments.sections.wallets')}>
      <AccountCard>
        <GroupedSection items={items} />
      </AccountCard>
    </Section>
  );
}
