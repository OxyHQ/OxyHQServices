import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { ReputationDonut, type DonutSegment } from '@/components/reputation/ReputationDonut';
import type { AppColors } from '@/hooks/useColors';
import type {
  ReputationSource,
  ReputationSourceWeight,
} from '@/lib/civic/reputation-sources';
import { useTranslation } from '@/lib/i18n';

interface CompositionCardProps {
  sources: ReputationSource[];
}

/** Calm dot colour per source weight — distinct enough to read the ring share. */
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

const DONUT_SIZE = 150;
const DONUT_STROKE = 12;

/** One calm legend line: a coloured dot, the source label, a muted weight
 *  caption, and the right-aligned points — no boxes, hairline-separated. */
function LegendRow({
  source,
  colors,
  first,
}: {
  source: ReputationSource;
  colors: AppColors;
  first: boolean;
}) {
  const { t } = useTranslation();
  const isPenalty = source.weight === 'penalty';
  const tone = weightColor(source.weight, colors);

  return (
    <View
      style={[
        styles.legendRow,
        !first && [styles.legendDivider, { borderTopColor: colors.border }],
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <ThemedText style={[styles.legendLabel, { color: colors.text }]} numberOfLines={1}>
        {t(`civic.reputation.sources.${source.key}`)}
      </ThemedText>
      <ThemedText style={[styles.legendWeight, { color: colors.textSecondary }]}>
        {t(`civic.reputation.weightShort.${source.weight}`)}
      </ThemedText>
      <ThemedText style={[styles.legendPoints, { color: isPenalty ? colors.error : colors.text }]}>
        {isPenalty ? `-${source.points}` : source.points}
      </ThemedText>
    </View>
  );
}

/**
 * Reputation composition: a clean, thin Skia ring of the POSITIVE sources
 * centred with generous air above and below, the earned total light-weighted in
 * its hole, and a calm legend list below. Penalties are broken out as their own
 * subtracted line (never part of the ring proportion).
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
  const showPenalty = !!penalty && penalty.points > 0;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <ThemedText style={[styles.title, { color: colors.text }]}>
          {t('civic.reputation.bySource')}
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('civic.reputation.bySourceSubtitle')}
        </ThemedText>
      </View>

      <View style={styles.donutWrap}>
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
      </View>

      <View style={styles.legend}>
        {positive.map((source, index) => (
          <LegendRow key={source.key} source={source} colors={colors} first={index === 0} />
        ))}
        {showPenalty && penalty && (
          <LegendRow source={penalty} colors={colors} first={positive.length === 0} />
        )}
      </View>

      {isEmpty && (
        <ThemedText style={[styles.empty, { color: colors.textSecondary }]}>
          {t('civic.reputation.composition.empty')}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  donutWrap: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  donutValue: {
    fontSize: 30,
    fontWeight: '500',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  donutCaption: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  legend: {
    marginTop: 2,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  legendDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  legendWeight: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  legendPoints: {
    fontSize: 15,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    fontSize: 13,
    lineHeight: 18,
  },
});
