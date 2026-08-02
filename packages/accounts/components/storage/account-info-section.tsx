import React from 'react';
import { AccountCard } from '@/components/ui';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { useTranslation } from '@/lib/i18n';
import type { GroupedItem } from '@/components/sections/types';

interface AccountInfoSectionProps {
  items: GroupedItem[];
}

/**
 * Account-info block (plan + last-updated rows). Extracted verbatim from the
 * storage screen's "account info" `Section`.
 */
export function AccountInfoSection({ items }: AccountInfoSectionProps) {
  const { t } = useTranslation();

  return (
    <Section title={t('storage.sections.accountInfo')}>
      <AccountCard>
        <GroupedSection items={items} />
      </AccountCard>
    </Section>
  );
}
