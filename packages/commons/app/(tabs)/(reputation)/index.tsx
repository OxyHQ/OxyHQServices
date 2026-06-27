import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { StandingHero } from '@/components/reputation/StandingHero';
import { CompositionCard } from '@/components/reputation/CompositionCard';
import { CivicDutyCard } from '@/components/reputation/CivicDutyCard';
import { ActivityList } from '@/components/reputation/ActivityList';
import { useCivicReputation, useReputationSources } from '@/hooks/useCivicReputation';
import { useReputationActivity } from '@/hooks/useReputationActivity';
import { useValidatorInbox } from '@/hooks/useValidatorInbox';
import { useCivicProfileState } from '@/hooks/useCivicProfileState';
import { useTranslation } from '@/lib/i18n';

/**
 * Reputation — the "engine room".
 *
 * A single prioritized vertical scroll: the standing hero (tier + progress +
 * influence/reliability), the composition donut (where reputation comes from),
 * the civic-duty call to action (validator inbox), and the recent activity feed.
 * The canonical balance comes from `useCivicReputation`; the four civic sources
 * are derived client-side; recent ledger entries come from `useReputationActivity`.
 * Offline-first via the shared `civic`-namespaced React Query cache.
 */
export default function ReputationScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { user, oxyServices } = useOxy();
  const { isOnline } = useCivicProfileState({ subject: 'remote' });

  const userId = user?.id ?? oxyServices?.getCurrentUserId() ?? null;
  const balanceQuery = useCivicReputation(userId);
  const balance = balanceQuery.data;
  const sources = useReputationSources(balance);

  const activityQuery = useReputationActivity(userId);
  const inboxQuery = useValidatorInbox();
  const pendingValidations = inboxQuery.data?.length ?? 0;

  const handleOpenInbox = useCallback(() => {
    router.push('/(tabs)/(reputation)/validate');
  }, [router]);

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
        <StandingHero balance={balance} isOffline={!isOnline} />
        <CompositionCard sources={sources} />
        <CivicDutyCard pendingCount={pendingValidations} onPress={handleOpenInbox} />
        <ActivityList
          transactions={activityQuery.data}
          isLoading={activityQuery.isPending}
          isError={activityQuery.isError}
        />
        <ThemedText style={[styles.footnote, { color: colors.textSecondary }]}>
          {t('civic.reputation.footnote')}
        </ThemedText>
      </View>
    );
  };

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>{renderBody()}</View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 120,
    gap: 32,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 18,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 14,
    minHeight: 360,
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
    paddingVertical: 13,
    paddingHorizontal: 30,
    borderRadius: 16,
    borderCurve: 'continuous',
  },
  retryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
