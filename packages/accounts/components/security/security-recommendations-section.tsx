import React from 'react';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard } from '@/components/ui';
import { useTranslation } from '@/lib/i18n';
import type { PrioritizedGroupedItem } from '@/components/sections/types';

interface SecurityRecommendationsSectionProps {
  items: PrioritizedGroupedItem[];
}

/**
 * Renders the prioritized security recommendations at the top of the security
 * screen. Returns `null` when there are no recommendations, matching the
 * screen's original conditional rendering.
 */
export function SecurityRecommendationsSection({ items }: SecurityRecommendationsSectionProps) {
  const { t } = useTranslation();

  if (items.length === 0) {
    return null;
  }

  return (
    <Section title={t('security.sections.recommendations')}>
      <AccountCard>
        <GroupedSection items={items} />
      </AccountCard>
    </Section>
  );
}
