import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { ActivityRow } from '@/components/reputation/ActivityRow';
import type { ReputationTransaction } from '@oxyhq/core';
import { useTranslation } from '@/lib/i18n';

interface ActivityListProps {
  transactions: ReputationTransaction[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * The recent reputation activity feed. Renders the most recent ledger entries
 * with loading, error, and empty states. The list never owns its own scroller —
 * it sits inside the screen's single vertical scroll.
 */
export function ActivityList({ transactions, isLoading, isError }: ActivityListProps) {
  const colors = useColors();
  const { t } = useTranslation();

  const renderInner = () => {
    if (isLoading && !transactions) {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator color={colors.tint} />
          <ThemedText style={[styles.stateText, { color: colors.textSecondary }]}>
            {t('civic.reputation.activity.loading')}
          </ThemedText>
        </View>
      );
    }

    if (isError && !transactions) {
      return (
        <View style={styles.stateBox}>
          <MaterialCommunityIcons name="cloud-alert" size={28} color={colors.textSecondary} />
          <ThemedText style={[styles.stateText, { color: colors.textSecondary }]}>
            {t('civic.reputation.activity.error')}
          </ThemedText>
        </View>
      );
    }

    if (!transactions || transactions.length === 0) {
      return (
        <View style={styles.stateBox}>
          <MaterialCommunityIcons name="history" size={28} color={colors.textSecondary} />
          <ThemedText style={[styles.stateText, styles.centerText, { color: colors.textSecondary }]}>
            {t('civic.reputation.activity.empty')}
          </ThemedText>
        </View>
      );
    }

    return (
      <View>
        {transactions.map((transaction, index) => (
          <View
            key={transaction.id}
            style={index > 0 ? [styles.divider, { borderTopColor: colors.border }] : undefined}
          >
            <ActivityRow transaction={transaction} />
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <ThemedText style={styles.title}>{t('civic.reputation.activity.title')}</ThemedText>
      {renderInner()}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    padding: 20,
    paddingTop: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stateBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 10,
  },
  stateText: {
    fontSize: 14,
    lineHeight: 20,
  },
  centerText: {
    textAlign: 'center',
  },
});
