import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { useTranslation } from '@/lib/i18n';

interface CivicDutyCardProps {
  /** Number of validation requests awaiting this juror. */
  pendingCount: number;
  onPress: () => void;
}

/**
 * The civic-duty call to action — a deliberately DISTINCT accent-tinted, accent-
 * bordered card (not a buried list row) that opens the validator inbox. Shows a
 * live pending-count badge when the juror has requests waiting.
 */
export function CivicDutyCard({ pendingCount, onPress }: CivicDutyCardProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const hasPending = pendingCount > 0;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('civic.validate.dutyTitle')}
      style={[
        styles.card,
        { backgroundColor: `${colors.primary}14`, borderColor: `${colors.primary}40` },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: `${colors.primary}1F` }]}>
        <MaterialCommunityIcons name="scale-balance" size={24} color={colors.primary} />
      </View>

      <View style={styles.text}>
        <View style={styles.titleRow}>
          <ThemedText style={styles.title}>{t('civic.validate.dutyTitle')}</ThemedText>
          {hasPending && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <ThemedText style={styles.badgeText}>{pendingCount}</ThemedText>
            </View>
          )}
        </View>
        <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {hasPending
            ? t('civic.validate.inboxEntryCount', { count: pendingCount })
            : t('civic.reputation.duty.secondary')}
        </ThemedText>
      </View>

      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
  },
});
