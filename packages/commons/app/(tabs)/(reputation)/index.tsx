import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { CivicBadge } from '@/components/civic/CivicBadge';
import { useCivicReputation, useReputationSources } from '@/hooks/useCivicReputation';
import { useCivicProfileState } from '@/hooks/useCivicProfileState';
import { getTrustTierMeta } from '@/lib/civic/card-presentation';
import type { CivicTone } from '@/lib/civic/card-presentation';
import type {
  ReputationSourceKey,
  ReputationSourceWeight,
} from '@/lib/civic/reputation-sources';
import { useTranslation } from '@/lib/i18n';

const SOURCE_ICON: Record<ReputationSourceKey, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  realLife: 'handshake-outline',
  peerCivic: 'account-group-outline',
  apps: 'apps',
  penalties: 'alert-octagon-outline',
};

const WEIGHT_TONE: Record<ReputationSourceWeight, CivicTone> = {
  high: 'positive',
  medium: 'positive',
  low: 'neutral',
  penalty: 'danger',
};

/**
 * Reputation breakdown by SOURCE.
 *
 * The canonical lifetime total + trust tier come straight from the balance; the
 * four civic sources (Real life / Peer-civic / Apps / Penalties) are derived
 * client-side from `breakdown` via `deriveReputationSources`. Offline-first via
 * the same `civic`-namespaced React Query cache.
 */
export default function ReputationScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { user, oxyServices } = useOxy();
  const { isOnline } = useCivicProfileState({ subject: 'remote' });

  const userId = user?.id ?? oxyServices?.getCurrentUserId() ?? null;
  const balanceQuery = useCivicReputation(userId);
  const balance = balanceQuery.data;
  const sources = useReputationSources(balance);

  const trustMeta = useMemo(
    () => (balance ? getTrustTierMeta(balance.trustTier) : null),
    [balance],
  );

  const renderBody = () => {
    if (balanceQuery.isPending && !balance) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={styles.loadingText}>{t('civic.reputation.loading')}</ThemedText>
        </View>
      );
    }

    if (balanceQuery.isError && !balance) {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="cloud-alert" size={56} color={colors.textSecondary} />
          <ThemedText style={styles.emptyTitle}>{t('civic.reputation.error.title')}</ThemedText>
          <ThemedText style={[styles.emptyBody, { color: colors.textSecondary }]}>
            {t('civic.reputation.error.body')}
          </ThemedText>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.tint }]}
            onPress={() => balanceQuery.refetch()}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!balance || !sources) return null;

    return (
      <View style={styles.content}>
        {!isOnline && (
          <View style={styles.offlineRow}>
            <CivicBadge tone="neutral" icon="cloud-off-outline" label={t('civic.reputation.offline')} />
          </View>
        )}

        {/* Headline total + trust tier */}
        <AccountCard>
          <View style={[styles.totalCard, { backgroundColor: colors.card }]}>
            <ThemedText style={[styles.totalValue, { color: colors.text }]}>{balance.total}</ThemedText>
            <ThemedText style={[styles.totalLabel, { color: colors.textSecondary }]}>
              {t('civic.reputation.total')}
            </ThemedText>
            {trustMeta && (
              <View style={styles.totalBadge}>
                <CivicBadge
                  tone={trustMeta.tone}
                  icon="shield-star-outline"
                  label={t(`civic.trustTier.${trustMeta.labelKey}`)}
                />
              </View>
            )}
          </View>
        </AccountCard>

        {/* By source */}
        <Section title={t('civic.reputation.bySource')}>
          <ThemedText style={styles.subtitle}>{t('civic.reputation.bySourceSubtitle')}</ThemedText>
          <AccountCard>
            <View style={styles.sourceList}>
              {sources.map((source) => (
                <View key={source.key} style={styles.sourceRow}>
                  <View style={[styles.sourceIcon, { backgroundColor: colors.background }]}>
                    <MaterialCommunityIcons
                      name={SOURCE_ICON[source.key]}
                      size={20}
                      color={source.weight === 'penalty' ? colors.error : colors.tint}
                    />
                  </View>
                  <View style={styles.sourceText}>
                    <ThemedText style={styles.sourceTitle}>
                      {t(`civic.reputation.sources.${source.key}`)}
                    </ThemedText>
                    <ThemedText style={[styles.sourceDesc, { color: colors.textSecondary }]}>
                      {t(`civic.reputation.sources.${source.key}Desc`)}
                    </ThemedText>
                    <View style={styles.sourceBadgeRow}>
                      <CivicBadge tone={WEIGHT_TONE[source.weight]} label={t(`civic.reputation.weight.${source.weight}`)} />
                    </View>
                  </View>
                  <ThemedText
                    style={[
                      styles.sourcePoints,
                      { color: source.weight === 'penalty' ? colors.error : colors.text },
                    ]}
                  >
                    {source.weight === 'penalty' ? `-${source.points}` : source.points}
                  </ThemedText>
                </View>
              ))}
            </View>
          </AccountCard>
        </Section>

        <ThemedText style={[styles.footnote, { color: colors.textSecondary }]}>
          {t('civic.reputation.footnote')}
        </ThemedText>
      </View>
    );
  };

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('civic.reputation.title')} subtitle={t('civic.reputation.subtitle')} />
        </View>
        {renderBody()}
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerWrap: {
    paddingHorizontal: 16,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  offlineRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  totalCard: {
    padding: 24,
    alignItems: 'center',
  },
  totalValue: {
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -1,
  },
  totalLabel: {
    fontSize: 14,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  totalBadge: {
    marginTop: 12,
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 12,
  },
  sourceList: {
    paddingVertical: 4,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    gap: 12,
  },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceText: {
    flex: 1,
    gap: 4,
  },
  sourceTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  sourceDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  sourceBadgeRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  sourcePoints: {
    fontSize: 20,
    fontWeight: '700',
    minWidth: 44,
    textAlign: 'right',
  },
  footnote: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    minHeight: 320,
  },
  loadingText: {
    fontSize: 15,
    opacity: 0.7,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  retryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
