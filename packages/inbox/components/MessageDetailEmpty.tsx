import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@oxyhq/bloom/typography';
import { useColors } from '@/constants/theme';
import { EmptyIllustration } from '@/components/EmptyIllustration';
import { useTranslation } from '@/lib/i18n';

export function MessageDetailEmpty() {
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <EmptyIllustration size={180} />
      <Text style={[styles.text, { color: colors.secondaryText }]}>{t('empty.selectConversation')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    fontSize: 16,
  },
});
