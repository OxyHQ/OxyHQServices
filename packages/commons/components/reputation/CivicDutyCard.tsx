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
 * The civic-duty call to action — ONE calm full-width row on a soft
 * `primarySubtle` fill (no loud border): a restrained accent icon, the title +
 * muted subtitle, an optional count pill when requests are waiting, and a quiet
 * chevron. The single accent moment on an otherwise flat screen.
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
      style={[styles.card, { backgroundColor: colors.primarySubtle }]}
    >
      <MaterialCommunityIcons name="scale-balance" size={22} color={colors.primary} />

      <View style={styles.text}>
        <ThemedText style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {t('civic.validate.dutyTitle')}
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {hasPending
            ? t('civic.validate.inboxEntryCount', { count: pendingCount })
            : t('civic.reputation.duty.secondary')}
        </ThemedText>
      </View>

      {hasPending && (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <ThemedText style={styles.badgeText}>{pendingCount}</ThemedText>
        </View>
      )}

      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    minHeight: 64,
    borderRadius: 24,
    borderCurve: 'continuous',
  },
  text: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
