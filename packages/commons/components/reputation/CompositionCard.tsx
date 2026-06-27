import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { ReputationDonut, type DonutSegment } from '@/components/reputation/ReputationDonut';
import type { AppColors } from '@/hooks/useColors';
import type {
  ReputationSource,
  ReputationSourceKey,
  ReputationSourceWeight,
} from '@/lib/civic/reputation-sources';
import type { MaterialCommunityIconName } from '@/types/icons';
import { useTranslation } from '@/lib/i18n';

interface CompositionCardProps {
  sources: ReputationSource[];
}

/** Leading icon per reputation source (carried over from the old screen). */
const SOURCE_ICON: Record<ReputationSourceKey, MaterialCommunityIconName> = {
  realLife: 'handshake-outline',
  peerCivic: 'account-group-outline',
  apps: 'apps',
  penalties: 'alert-octagon-outline',
};

/** Colour of a compact source-weight tag — distinct per weight, scannable. */
function weightColor(weight: ReputationSourceWeight, colors: AppColors): string {
  switch (weight) {
    case 'high':
      return colors.success;
    case 'medium':
      return colors.info;
    case 'penalty':
      return colors.error;
    case 'low':
    default:
      return colors.textSecondary;
  }
}

const DONUT_SIZE = 132;
const DONUT_STROKE = 18;

/**
 * Reputation composition: a Skia donut of the POSITIVE sources (real-life /
 * peer-civic / apps) with a legend, plus penalties broken out separately below
 * the ring (penalties are subtracted, never part of the proportion). Each
 * legend row carries a compact HIGH / MED / LOW / PEN weight tag.
 */
export function CompositionCard({ sources }: CompositionCardProps) {
  const colors = useColors();
  const { t } = useTranslation();

  const positive = useMemo(() => sources.filter((source) => source.weight !== 'penalty'), [sources]);
  const penalty = useMemo(() => sources.find((source) => source.weight === 'penalty'), [sources]);

  const segments = useMemo<DonutSegment[]>(
    () =>
      positive.map((source) => ({
        key: source.key,
        value: Math.max(0, source.points),
        color: weightColor(source.weight, colors),
      })),
    [positive, colors],
  );

  const earned = useMemo(
    () => positive.reduce((sum, source) => sum + Math.max(0, source.points), 0),
    [positive],
  );
  const isEmpty = earned === 0 && (!penalty || penalty.points === 0);

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <ThemedText style={styles.title}>{t('civic.reputation.bySource')}</ThemedText>
      <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]}>
        {t('civic.reputation.bySourceSubtitle')}
      </ThemedText>

      <View style={styles.body}>
        <ReputationDonut
          size={DONUT_SIZE}
          strokeWidth={DONUT_STROKE}
          segments={segments}
          trackColor={colors.border}
        >
          <ThemedText style={[styles.donutValue, { color: colors.text }]}>{earned}</ThemedText>
          <ThemedText style={[styles.donutCaption, { color: colors.textSecondary }]}>
            {t('civic.reputation.composition.earned')}
          </ThemedText>
        </ReputationDonut>

        <View style={styles.legend}>
          {positive.map((source) => (
            <View key={source.key} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: weightColor(source.weight, colors) }]} />
              <MaterialCommunityIcons
                name={SOURCE_ICON[source.key]}
                size={16}
                color={colors.textSecondary}
              />
              <ThemedText style={styles.legendLabel} numberOfLines={1}>
                {t(`civic.reputation.sources.${source.key}`)}
              </ThemedText>
              <ThemedText style={[styles.legendPoints, { color: colors.text }]}>
                {source.points}
              </ThemedText>
              <View style={[styles.weightTag, { backgroundColor: `${weightColor(source.weight, colors)}1A` }]}>
                <ThemedText style={[styles.weightTagText, { color: weightColor(source.weight, colors) }]}>
                  {t(`civic.reputation.weightShort.${source.weight}`)}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
      </View>

      {penalty && penalty.points > 0 && (
        <View style={[styles.penaltyRow, { borderTopColor: colors.border }]}>
          <MaterialCommunityIcons name={SOURCE_ICON.penalties} size={16} color={colors.error} />
          <ThemedText style={[styles.penaltyLabel, { color: colors.text }]}>
            {t('civic.reputation.sources.penalties')}
          </ThemedText>
          <ThemedText style={[styles.penaltyPoints, { color: colors.error }]}>
            {`-${penalty.points}`}
          </ThemedText>
        </View>
      )}

      {isEmpty && (
        <ThemedText style={[styles.empty, { color: colors.textSecondary }]}>
          {t('civic.reputation.composition.empty')}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 28,
    padding: 20,
    marginBottom: 16,
    gap: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 12,
  },
  donutValue: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  donutCaption: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  legend: {
    flex: 1,
    gap: 12,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  legendPoints: {
    fontSize: 14,
    fontWeight: '700',
  },
  weightTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    minWidth: 38,
    alignItems: 'center',
  },
  weightTagText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  penaltyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  penaltyLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  penaltyPoints: {
    fontSize: 14,
    fontWeight: '700',
  },
  empty: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
});
