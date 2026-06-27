import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
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
import { useTranslation } from '@/lib/i18n';

interface StandingHeroProps {
  balance: ReputationBalance;
  /** Whether the surface is rendering cached data while offline. */
  isOffline: boolean;
}

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
 * The "engine room" hero — deliberately FLAT (no card, no chrome) so the trust
 * TIER stands alone as the single focal point. The tier name is the confident
 * headline in its tier colour; the raw lifetime total is quiet secondary text; a
 * single thin progress bar with one calm line shows the climb to the next tier;
 * and the two explained stats (Influence / Reliability) sit as two roomy columns
 * split by a hairline. Verified/restricted states swap the bar for a calm line.
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
    <View style={styles.hero}>
      <View style={styles.identity}>
        <View style={styles.headlineRow}>
          <ThemedText style={[styles.tier, { color: accent }]} numberOfLines={1}>
            {t(`civic.trustTier.${balance.trustTier}`)}
          </ThemedText>
          {isOffline && (
            <CivicBadge tone="neutral" icon="cloud-off-outline" label={t('civic.reputation.offline')} />
          )}
        </View>
        <ThemedText style={[styles.totalLine, { color: colors.textSecondary }]} numberOfLines={1}>
          {t('civic.reputation.standing.totalLine', { total: balance.total })}
        </ThemedText>
      </View>

      {progress.kind === 'progress' && (
        <View style={styles.progressBlock}>
          <View style={[styles.track, { backgroundColor: `${accent}1F` }]}>
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
        <View style={styles.stat}>
          <ThemedText style={[styles.statLabel, { color: colors.textSecondary }]}>
            {t('civic.reputation.stats.influence')}
          </ThemedText>
          <ThemedText style={[styles.statValue, { color: colors.text }]}>
            {formatInfluenceMultiplier(balance.influence)}
          </ThemedText>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <ThemedText style={[styles.statLabel, { color: colors.textSecondary }]}>
            {t('civic.reputation.stats.reliability')}
          </ThemedText>
          <ThemedText style={[styles.statValue, { color: colors.text }]}>
            {formatReliabilityPercent(balance.reliability)}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: 24,
    paddingTop: 4,
  },
  identity: {
    gap: 6,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  tier: {
    flex: 1,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.6,
    lineHeight: 36,
  },
  totalLine: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  progressBlock: {
    gap: 10,
  },
  track: {
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: 7,
    borderRadius: 999,
  },
  progressCopy: {
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stateCopy: {
    fontSize: 13,
    lineHeight: 19,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stat: {
    flex: 1,
    gap: 7,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 40,
    marginHorizontal: 22,
  },
});
