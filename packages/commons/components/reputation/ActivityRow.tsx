import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { describeReputationAction, formatPointsDelta } from '@/lib/civic/reputation-activity';
import type { ReputationTransaction } from '@oxyhq/core';
import { useTranslation } from '@/lib/i18n';

interface ActivityRowProps {
  transaction: ReputationTransaction;
}

/**
 * One reputation ledger entry rendered as a human row: a category icon, a
 * readable action label, the relative time, an Oxy-signed/verifiable indicator
 * for crypto-attested actions, and the signed point delta (green award / red
 * penalty).
 */
export function ActivityRow({ transaction }: ActivityRowProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const relativeTime = useRelativeTime();

  const meta = describeReputationAction(transaction);
  const deltaColor = meta.positive ? colors.success : colors.error;

  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name={meta.icon} size={18} color={colors.textSecondary} />
      </View>

      <View style={styles.text}>
        <View style={styles.labelRow}>
          <ThemedText style={styles.label} numberOfLines={1}>
            {t(`civic.reputation.activity.actions.${meta.labelKey}`)}
          </ThemedText>
          {meta.signed && (
            <MaterialCommunityIcons
              name="shield-check"
              size={13}
              color={colors.success}
              accessibilityLabel={t('civic.reputation.activity.signed')}
            />
          )}
        </View>
        <ThemedText style={[styles.time, { color: colors.textSecondary }]} numberOfLines={1}>
          {relativeTime(transaction.createdAt)}
        </ThemedText>
      </View>

      <ThemedText style={[styles.delta, { color: deltaColor }]}>
        {formatPointsDelta(transaction.points)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  time: {
    fontSize: 12,
  },
  delta: {
    fontSize: 16,
    fontWeight: '700',
    minWidth: 44,
    textAlign: 'right',
  },
});
