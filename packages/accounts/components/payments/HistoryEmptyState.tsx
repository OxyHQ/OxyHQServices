import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccountCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import type { MaterialCommunityIconName } from '@/types/icons';

interface HistoryEmptyStateProps {
  icon: MaterialCommunityIconName;
  title: string;
  subtitle: string;
}

/**
 * Shared empty-state card used by the billing-history and transaction-history
 * sections when there are no entries to render.
 */
export function HistoryEmptyState({ icon, title, subtitle }: HistoryEmptyStateProps) {
  const colors = useColors();

  return (
    <AccountCard>
      <View style={styles.emptyStateContainer}>
        <MaterialCommunityIcons
          name={icon}
          size={40}
          color={colors.text}
          style={styles.emptyStateIcon}
        />
        <Text style={[styles.emptyStateTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.emptyStateSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
    </AccountCard>
  );
}

const styles = StyleSheet.create({
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
