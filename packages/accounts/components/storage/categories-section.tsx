import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { AccountCard } from '@/components/ui';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import type { StorageDetailItem } from '@/hooks/storage/useStorageDetails';

interface CategoriesSectionProps {
  items: StorageDetailItem[];
}

/**
 * Per-category storage breakdown list. Each row renders its pre-formatted byte
 * value as trailing content. Extracted verbatim from the storage screen's
 * "by category" `Section`.
 */
export function CategoriesSection({ items }: CategoriesSectionProps) {
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <Section title={t('storage.sections.byCategory')}>
      <AccountCard>
        <GroupedSection
          items={items.map((item) => ({
            ...item,
            customContent: (
              <View style={styles.storageValue}>
                <ThemedText style={[styles.storageValueText, { color: colors.text }]}>
                  {item.valueText}
                </ThemedText>
              </View>
            ),
          }))}
        />
      </AccountCard>
    </Section>
  );
}

const styles = StyleSheet.create({
  storageValue: {
    marginLeft: 8,
  },
  storageValueText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
