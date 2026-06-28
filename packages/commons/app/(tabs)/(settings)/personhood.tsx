import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import {
  Screen,
  StackHeader,
  Section,
  GroupedList,
  ListRow,
  Callout,
  CenteredState,
  PrimaryButton,
} from '@/components/ui';
import { CivicBadge } from '@/components/civic/CivicBadge';
import { useMyPersonhood } from '@/hooks/usePersonhood';
import { useCivicProfileState } from '@/hooks/useCivicProfileState';
import { useTranslation } from '@/lib/i18n';

/**
 * The personhood verification threshold θ — a score `>= θ` is a "verified real
 * person". Mirrors the server's `PERSONHOOD_THRESHOLD`; the server remains
 * authoritative (`isRealPerson` is computed there), this only positions the
 * progress marker.
 */
const PERSONHOOD_THRESHOLD = 0.6;

/**
 * "Proof of personhood" — the current user's own personhood status.
 *
 * Reads the recomputable snapshot via `getMyPersonhood()` (offline-first, like
 * the other civic surfaces). Surfaces a clear verified / building state, the
 * score as a flat progress bar with the θ threshold marked, a human breakdown of
 * the three signals (vouches, real-life confirmations, biometric binding) with
 * their counts, and plain guidance on how to raise it. Loading / empty / error
 * states are all handled; the zeroed `unverified` shape renders as "building
 * trust" rather than an error.
 */
export default function PersonhoodScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();

  const statusQuery = useMyPersonhood();
  const status = statusQuery.data;
  const { isOnline } = useCivicProfileState({ subject: 'remote' });

  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(settings)');
  }, [router]);

  const scorePct = useMemo(
    () => (status ? Math.max(0, Math.min(100, Math.round(status.score * 100))) : 0),
    [status],
  );
  const thresholdPct = Math.round(PERSONHOOD_THRESHOLD * 100);

  const renderBody = () => {
    if (statusQuery.isPending && !status) {
      return <CenteredState loading body={t('civic.personhood.loading')} />;
    }

    if (statusQuery.isError && !status) {
      return (
        <CenteredState
          icon="cloud-alert"
          title={t('civic.personhood.error.title')}
          body={t('civic.personhood.error.body')}
          action={
            <View style={styles.action}>
              <PrimaryButton label={t('common.retry')} onPress={() => statusQuery.refetch()} fullWidth={false} />
            </View>
          }
        />
      );
    }

    if (!status) return null;

    const verified = status.isRealPerson;
    const fillColor = verified ? colors.success : colors.tint;

    return (
      <>
        {!isOnline && (
          <CivicBadge tone="neutral" icon="cloud-off-outline" label={t('civic.personhood.offline')} />
        )}

        {/* Verified / building hero — flat, no card. */}
        <View style={styles.hero}>
          <CivicBadge
            emphasis
            tone={verified ? 'positive' : 'caution'}
            icon={verified ? 'account-check' : 'account-clock-outline'}
            label={t(verified ? 'civic.personhood.verifiedBadge' : 'civic.personhood.buildingBadge')}
          />

          <View style={styles.scoreBlock}>
            <ThemedText style={[styles.scoreValue, { color: colors.text }]}>
              {t('civic.personhood.scoreValue', { pct: scorePct })}
            </ThemedText>
            <ThemedText style={[styles.scoreLabel, { color: colors.textSecondary }]}>
              {t('civic.personhood.scoreLabel')}
            </ThemedText>
          </View>

          {/* Progress to the θ threshold */}
          <View style={styles.progressBlock}>
            <View style={[styles.track, { backgroundColor: `${fillColor}1F` }]}>
              <View style={[styles.fill, { width: `${scorePct}%`, backgroundColor: fillColor }]} />
              <View style={[styles.thresholdMark, { left: `${thresholdPct}%`, backgroundColor: colors.text }]} />
            </View>
            <ThemedText style={[styles.thresholdLabel, { color: colors.textSecondary }]}>
              {t('civic.personhood.thresholdLabel', { pct: thresholdPct })}
            </ThemedText>
          </View>

          <ThemedText style={[styles.heroDesc, { color: colors.textSecondary }]}>
            {t(verified ? 'civic.personhood.verifiedDesc' : 'civic.personhood.buildingDesc')}
          </ThemedText>
        </View>

        {status.sybilPenalty > 0 && (
          <Callout tone="warning" icon="alert-octagon-outline">
            {t('civic.personhood.penaltyNote')}
          </Callout>
        )}

        {/* Signals */}
        <Section title={t('civic.personhood.signals.title')} subtitle={t('civic.personhood.signals.subtitle')}>
          <GroupedList>
            <ListRow
              icon="account-group-outline"
              title={t('civic.personhood.signals.vouches')}
              subtitle={t('civic.personhood.signals.vouchesDesc')}
              value={t('civic.personhood.signals.vouchesCount', { count: status.vouchCount })}
            />
            <ListRow
              icon="handshake-outline"
              title={t('civic.personhood.signals.realLife')}
              subtitle={t('civic.personhood.signals.realLifeDesc')}
              value={t('civic.personhood.signals.realLifeCount', { count: status.realLifeCount })}
            />
            <ListRow
              icon="fingerprint"
              title={t('civic.personhood.signals.biometric')}
              subtitle={t('civic.personhood.signals.biometricDesc')}
              value={t(
                status.biometricBound
                  ? 'civic.personhood.signals.biometricBound'
                  : 'civic.personhood.signals.biometricUnbound',
              )}
              valueColor={status.biometricBound ? colors.success : undefined}
            />
          </GroupedList>
        </Section>

        {/* How to increase it */}
        <Section title={t('civic.personhood.improve.title')} subtitle={t('civic.personhood.improve.subtitle')}>
          <GroupedList>
            <ListRow
              icon="account-multiple-check-outline"
              title={t('civic.personhood.improve.getVouched')}
              subtitle={t('civic.personhood.improve.getVouchedDesc')}
            />
            <ListRow
              icon="handshake-outline"
              title={t('civic.personhood.improve.doRealLife')}
              subtitle={t('civic.personhood.improve.doRealLifeDesc')}
            />
            <ListRow
              icon="fingerprint"
              title={t('civic.personhood.improve.bindBiometric')}
              subtitle={t('civic.personhood.improve.bindBiometricDesc')}
            />
          </GroupedList>
        </Section>

        <ThemedText style={[styles.footnote, { color: colors.textSecondary }]}>
          {t('civic.personhood.footnote')}
        </ThemedText>
      </>
    );
  };

  return (
    <Screen gap={24}>
      <StackHeader
        title={t('civic.personhood.title')}
        onBack={handleClose}
        backAccessibilityLabel={t('common.back')}
      />
      {renderBody()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    marginTop: 4,
  },
  hero: {
    gap: 18,
    alignItems: 'flex-start',
  },
  scoreBlock: {
    gap: 4,
  },
  scoreValue: {
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  scoreLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  progressBlock: {
    width: '100%',
    gap: 8,
  },
  track: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
  thresholdMark: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 2,
    opacity: 0.55,
  },
  thresholdLabel: {
    fontSize: 12,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  heroDesc: {
    fontSize: 14,
    lineHeight: 20,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 18,
  },
});
