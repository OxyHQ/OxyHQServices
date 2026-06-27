import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
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
 * score as a progress bar with the θ threshold marked, a human breakdown of the
 * three signals (vouches, real-life confirmations, biometric binding) with their
 * counts, and plain guidance on how to raise it. Loading / empty / error states
 * are all handled; the zeroed `unverified` shape (no status document yet) renders
 * as "building trust" rather than an error.
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
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={styles.loadingText}>{t('civic.personhood.loading')}</ThemedText>
        </View>
      );
    }

    if (statusQuery.isError && !status) {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="cloud-alert" size={56} color={colors.textSecondary} />
          <ThemedText style={styles.emptyTitle}>{t('civic.personhood.error.title')}</ThemedText>
          <ThemedText style={[styles.emptyBody, { color: colors.textSecondary }]}>
            {t('civic.personhood.error.body')}
          </ThemedText>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.tint }]}
            onPress={() => statusQuery.refetch()}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!status) return null;

    const verified = status.isRealPerson;
    const fillColor = verified ? colors.success : colors.tint;

    return (
      <View style={styles.content}>
        {!isOnline && (
          <View style={styles.offlineRow}>
            <CivicBadge tone="neutral" icon="cloud-off-outline" label={t('civic.personhood.offline')} />
          </View>
        )}

        {/* Verified / building hero */}
        <AccountCard>
          <View style={[styles.heroCard, { backgroundColor: colors.card }]}>
            <View style={styles.heroBadgeRow}>
              <CivicBadge
                emphasis
                tone={verified ? 'positive' : 'caution'}
                icon={verified ? 'account-check' : 'account-clock-outline'}
                label={t(verified ? 'civic.personhood.verifiedBadge' : 'civic.personhood.buildingBadge')}
              />
            </View>

            <ThemedText style={[styles.scoreValue, { color: colors.text }]}>
              {t('civic.personhood.scoreValue', { pct: scorePct })}
            </ThemedText>
            <ThemedText style={[styles.scoreLabel, { color: colors.textSecondary }]}>
              {t('civic.personhood.scoreLabel')}
            </ThemedText>

            {/* Progress to the θ threshold */}
            <View style={styles.progressBlock}>
              <View style={[styles.track, { backgroundColor: colors.border }]}>
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
        </AccountCard>

        {status.sybilPenalty > 0 && (
          <View style={styles.penaltyRow}>
            <MaterialCommunityIcons name="alert-octagon-outline" size={18} color={colors.warning} />
            <ThemedText style={[styles.penaltyNote, { color: colors.warning }]}>
              {t('civic.personhood.penaltyNote')}
            </ThemedText>
          </View>
        )}

        {/* Signals */}
        <Section title={t('civic.personhood.signals.title')}>
          <ThemedText style={styles.sectionSubtitle}>{t('civic.personhood.signals.subtitle')}</ThemedText>
          <AccountCard>
            <View style={styles.signalList}>
              <SignalRow
                colors={colors}
                icon="account-group-outline"
                title={t('civic.personhood.signals.vouches')}
                desc={t('civic.personhood.signals.vouchesDesc')}
                value={t('civic.personhood.signals.vouchesCount', { count: status.vouchCount })}
              />
              <SignalRow
                colors={colors}
                icon="handshake-outline"
                title={t('civic.personhood.signals.realLife')}
                desc={t('civic.personhood.signals.realLifeDesc')}
                value={t('civic.personhood.signals.realLifeCount', { count: status.realLifeCount })}
              />
              <SignalRow
                colors={colors}
                icon="fingerprint"
                title={t('civic.personhood.signals.biometric')}
                desc={t('civic.personhood.signals.biometricDesc')}
                value={t(
                  status.biometricBound
                    ? 'civic.personhood.signals.biometricBound'
                    : 'civic.personhood.signals.biometricUnbound',
                )}
                valueTone={status.biometricBound ? 'positive' : 'neutral'}
              />
            </View>
          </AccountCard>
        </Section>

        {/* How to increase it */}
        <Section title={t('civic.personhood.improve.title')}>
          <ThemedText style={styles.sectionSubtitle}>{t('civic.personhood.improve.subtitle')}</ThemedText>
          <AccountCard>
            <GroupedSection
              items={[
                {
                  id: 'improve-vouched',
                  icon: 'account-multiple-check-outline',
                  iconColor: colors.identityIconSelfCustody,
                  title: t('civic.personhood.improve.getVouched'),
                  subtitle: t('civic.personhood.improve.getVouchedDesc'),
                },
                {
                  id: 'improve-reallife',
                  icon: 'handshake-outline',
                  iconColor: colors.identityIconPublicKey,
                  title: t('civic.personhood.improve.doRealLife'),
                  subtitle: t('civic.personhood.improve.doRealLifeDesc'),
                },
                {
                  id: 'improve-biometric',
                  icon: 'fingerprint',
                  iconColor: colors.iconWarning,
                  title: t('civic.personhood.improve.bindBiometric'),
                  subtitle: t('civic.personhood.improve.bindBiometricDesc'),
                },
              ]}
            />
          </AccountCard>
        </Section>

        <ThemedText style={[styles.footnote, { color: colors.textSecondary }]}>
          {t('civic.personhood.footnote')}
        </ThemedText>
      </View>
    );
  };

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            style={styles.backBtn}
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color={colors.text} />
          </TouchableOpacity>
          <ThemedText style={styles.topTitle}>{t('civic.personhood.title')}</ThemedText>
        </View>
        {renderBody()}
      </View>
    </ScreenContentWrapper>
  );
}

interface SignalRowProps {
  colors: ReturnType<typeof useColors>;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  desc: string;
  value: string;
  valueTone?: 'positive' | 'neutral';
}

function SignalRow({ colors, icon, title, desc, value, valueTone = 'neutral' }: SignalRowProps) {
  return (
    <View style={styles.signalRow}>
      <View style={[styles.signalIcon, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.tint} />
      </View>
      <View style={styles.signalText}>
        <ThemedText style={styles.signalTitle}>{title}</ThemedText>
        <ThemedText style={[styles.signalDesc, { color: colors.textSecondary }]}>{desc}</ThemedText>
      </View>
      <ThemedText
        style={[
          styles.signalValue,
          { color: valueTone === 'positive' ? colors.success : colors.text },
        ]}
        numberOfLines={1}
      >
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  topTitle: { fontSize: 20, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingBottom: 120 },
  offlineRow: { flexDirection: 'row', marginBottom: 16 },
  heroCard: { padding: 24, alignItems: 'center' },
  heroBadgeRow: { flexDirection: 'row', marginBottom: 16 },
  scoreValue: { fontSize: 44, fontWeight: '800', letterSpacing: -1 },
  scoreLabel: {
    fontSize: 13,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  progressBlock: { width: '100%', marginTop: 20 },
  track: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 5 },
  thresholdMark: { position: 'absolute', top: -2, bottom: -2, width: 2, opacity: 0.5 },
  thresholdLabel: { fontSize: 12, marginTop: 8, textAlign: 'right' },
  heroDesc: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 20 },
  penaltyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  penaltyNote: { flex: 1, fontSize: 13, lineHeight: 18 },
  sectionSubtitle: { fontSize: 14, opacity: 0.7, marginBottom: 12 },
  signalList: { paddingVertical: 4 },
  signalRow: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, gap: 12 },
  signalIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalText: { flex: 1, gap: 4 },
  signalTitle: { fontSize: 16, fontWeight: '600' },
  signalDesc: { fontSize: 13, lineHeight: 18 },
  signalValue: { fontSize: 15, fontWeight: '700', textAlign: 'right', minWidth: 56 },
  footnote: { fontSize: 12, lineHeight: 17, marginTop: 16 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    minHeight: 320,
  },
  loadingText: { fontSize: 15, opacity: 0.7 },
  emptyTitle: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retryButton: { marginTop: 8, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 12 },
  retryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
