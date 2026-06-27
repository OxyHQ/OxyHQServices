import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { CivicBadge } from '@/components/civic/CivicBadge';
import {
  getTierProgress,
  formatInfluenceMultiplier,
  formatReliabilityPercent,
} from '@/lib/civic/reputation-standing';
import type { AppColors } from '@/hooks/useColors';
import type { ReputationBalance, TrustTier } from '@oxyhq/core';
import type { MaterialCommunityIconName } from '@/types/icons';
import { useTranslation } from '@/lib/i18n';

interface StandingHeroProps {
  balance: ReputationBalance;
  /** Whether the surface is rendering cached data while offline. */
  isOffline: boolean;
}

/** The shield variant that best conveys each tier. */
const TIER_ICON: Record<TrustTier, MaterialCommunityIconName> = {
  new: 'shield-outline',
  trusted: 'shield-check-outline',
  high_trust: 'shield-star-outline',
  verified: 'shield-crown-outline',
  restricted: 'shield-alert-outline',
};

/**
 * The headline colour for a trust tier — `new` reads neutral (still earning),
 * the earned tiers escalate through the brand/success palette, and `restricted`
 * is punitive red.
 */
function tierColor(tier: TrustTier, colors: AppColors): string {
  switch (tier) {
    case 'verified':
    case 'high_trust':
      return colors.success;
    case 'trusted':
      return colors.primary;
    case 'restricted':
      return colors.error;
    case 'new':
    default:
      return colors.textSecondary;
  }
}

/**
 * The "engine room" hero: the trust TIER is the headline (in its tier colour,
 * behind a shield), with a progress bar toward the next tier, two explained
 * stat chips (Influence / Reliability), and the raw lifetime total as quiet
 * secondary text. The bare number is intentionally NOT the headline.
 */
export function StandingHero({ balance, isOffline }: StandingHeroProps) {
  const colors = useColors();
  const { t } = useTranslation();

  const accent = tierColor(balance.trustTier, colors);
  const progress = useMemo(
    () => getTierProgress(balance.trustTier, balance.total),
    [balance.trustTier, balance.total],
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.headerRow}>
        <View style={[styles.shield, { backgroundColor: `${accent}1A` }]}>
          <MaterialCommunityIcons name={TIER_ICON[balance.trustTier]} size={26} color={accent} />
        </View>
        <View style={styles.headerText}>
          <ThemedText style={[styles.tier, { color: accent }]} numberOfLines={1}>
            {t(`civic.trustTier.${balance.trustTier}`)}
          </ThemedText>
          <ThemedText style={[styles.totalLine, { color: colors.textSecondary }]} numberOfLines={1}>
            {t('civic.reputation.standing.totalLine', { total: balance.total })}
          </ThemedText>
        </View>
        {isOffline && (
          <CivicBadge tone="neutral" icon="cloud-off-outline" label={t('civic.reputation.offline')} />
        )}
      </View>

      {progress.kind === 'progress' && (
        <View style={styles.progressBlock}>
          <View style={[styles.track, { backgroundColor: `${accent}26` }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: accent, width: `${Math.round(progress.fraction * 100)}%` },
              ]}
            />
          </View>
          <ThemedText style={[styles.progressCopy, { color: colors.textSecondary }]}>
            {t('civic.reputation.progress.label', {
              current: progress.current,
              target: progress.targetMin,
              remaining: progress.remaining,
              tier: t(`civic.trustTier.${progress.nextTier}`),
            })}
          </ThemedText>
        </View>
      )}

      {progress.kind === 'topPoints' && (
        <ThemedText style={[styles.stateCopy, { color: colors.textSecondary }]}>
          {t('civic.reputation.progress.topTier')}
        </ThemedText>
      )}

      {progress.kind === 'max' && (
        <View style={styles.stateRow}>
          <CivicBadge tone="positive" icon="shield-crown-outline" label={t('civic.trustTier.verified')} />
          <ThemedText style={[styles.stateCopy, { color: colors.textSecondary, flex: 1 }]}>
            {t('civic.reputation.standing.verifiedMax')}
          </ThemedText>
        </View>
      )}

      {progress.kind === 'restricted' && (
        <ThemedText style={[styles.stateCopy, { color: colors.error }]}>
          {t('civic.reputation.standing.restricted')}
        </ThemedText>
      )}

      <View style={styles.statsRow}>
        <View style={[styles.stat, { borderColor: colors.border }]}>
          <ThemedText style={[styles.statValue, { color: colors.text }]}>
            {formatInfluenceMultiplier(balance.influence)}
          </ThemedText>
          <ThemedText style={[styles.statLabel, { color: colors.text }]}>
            {t('civic.reputation.stats.influence')}
          </ThemedText>
          <ThemedText style={[styles.statCaption, { color: colors.textSecondary }]}>
            {t('civic.reputation.stats.influenceCaption')}
          </ThemedText>
        </View>
        <View style={[styles.stat, { borderColor: colors.border }]}>
          <ThemedText style={[styles.statValue, { color: colors.text }]}>
            {formatReliabilityPercent(balance.reliability)}
          </ThemedText>
          <ThemedText style={[styles.statLabel, { color: colors.text }]}>
            {t('civic.reputation.stats.reliability')}
          </ThemedText>
          <ThemedText style={[styles.statCaption, { color: colors.textSecondary }]}>
            {t('civic.reputation.stats.reliabilityCaption')}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    padding: 20,
    gap: 16,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  shield: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  tier: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  totalLine: {
    fontSize: 13,
  },
  progressBlock: {
    gap: 8,
  },
  track: {
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: 10,
    borderRadius: 999,
  },
  progressCopy: {
    fontSize: 13,
    fontWeight: '600',
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stateCopy: {
    fontSize: 13,
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  stat: {
    flex: 1,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 2,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  statCaption: {
    fontSize: 11,
    lineHeight: 15,
  },
});
