import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { AccountCard } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useCivicCard } from '@/hooks/useCivicCard';
import { useVouch } from '@/hooks/useVouch';
import { userIdFromDid } from '@/lib/civic/did';
import { useTranslation } from '@/lib/i18n';

/** Default / clamp bounds for the optional stake — mirror the server's
 *  `PERSONHOOD_VOUCH_{DEFAULT,MIN,MAX}_STAKE`. The server re-clamps and is
 *  authoritative; these only seed and validate the input. */
const STAKE_DEFAULT = 10;
const STAKE_MIN = 1;
const STAKE_MAX = 100;

/**
 * Vouch confirm screen.
 *
 * Reuses the scanned subject's signed card (`useCivicCard`) for their name +
 * avatar, then walks the voucher through staking their reputation to vouch the
 * subject is a real person. The stake + slash risk are spelled out before the
 * action; the vouch itself is gated behind the device biometric (it signs a
 * `personhood_vouch` record on the voucher's own chain). On success the awarded
 * points are shown and a "Withdraw vouch" affordance is offered. Server
 * rejections (self-vouch, already-vouched, voucher-below-threshold, sock-puppet
 * exclusions) map to friendly copy via the `useVouch` error code.
 *
 * NATIVE-ONLY (the vouch signs with the on-device key).
 */
export default function VouchScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { did } = useLocalSearchParams<{ did: string }>();

  const userId = useMemo(() => (did ? userIdFromDid(did) : null), [did]);
  const cardQuery = useCivicCard(userId);
  const card = cardQuery.data?.card;
  const subjectName = card?.name ?? '';

  const [stakeText, setStakeText] = useState(String(STAKE_DEFAULT));

  const { state, biometricFailed, errorCode, result, vouch, withdraw } = useVouch(
    did ?? null,
    userId,
    t('civic.vouch.confirm.biometricReason'),
  );

  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(id)');
  }, [router]);

  const stakeAmount = useMemo(() => {
    const parsed = Number.parseInt(stakeText, 10);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(STAKE_MIN, Math.min(STAKE_MAX, parsed));
  }, [stakeText]);

  const handleVouch = useCallback(() => {
    void vouch(stakeAmount);
  }, [vouch, stakeAmount]);

  const busy = state === 'vouching' || state === 'withdrawing';

  const renderBody = () => {
    // Invalid / unparseable target.
    if (!userId || !did) {
      return (
        <EmptyState
          icon="account-alert-outline"
          title={t('civic.vouch.confirm.invalidTitle')}
          body={t('civic.vouch.confirm.invalidBody')}
          colors={colors}
        />
      );
    }

    if (state === 'done' && result) {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="account-check" size={64} color={colors.success} />
          <ThemedText style={styles.resultTitle}>{t('civic.vouch.confirm.done.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>
            {t('civic.vouch.confirm.done.body', { name: subjectName, points: result.points })}
          </ThemedText>
          <View style={styles.stakedChip}>
            <MaterialCommunityIcons name="lock-outline" size={15} color={colors.textSecondary} />
            <ThemedText style={[styles.stakedText, { color: colors.textSecondary }]}>
              {t('civic.vouch.confirm.done.staked', { stake: result.stakeAmount })}
            </ThemedText>
          </View>
          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
            onPress={withdraw}
            disabled={busy}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="undo-variant" size={18} color={colors.text} />
            <Text style={[styles.secondaryText, { color: colors.text }]}>
              {t('civic.vouch.confirm.withdraw')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.tint }]} onPress={handleClose}>
            <Text style={styles.primaryText}>{t('common.done')}</Text>
          </TouchableOpacity>
          {busy && (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.tint} />
              <ThemedText style={styles.muted}>{t('civic.vouch.confirm.withdrawing')}</ThemedText>
            </View>
          )}
        </View>
      );
    }

    if (state === 'withdrawn') {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="undo-variant" size={64} color={colors.textSecondary} />
          <ThemedText style={styles.resultTitle}>{t('civic.vouch.confirm.withdrawn.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>
            {t('civic.vouch.confirm.withdrawn.body', { name: subjectName })}
          </ThemedText>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.tint }]} onPress={handleClose}>
            <Text style={styles.primaryText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (state === 'error') {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="alert-circle-outline" size={56} color={colors.error} />
          <ThemedText style={styles.resultTitle}>{t('civic.vouch.confirm.error.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>
            {t(`civic.vouch.error.${errorCode ?? 'generic'}`)}
          </ThemedText>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.tint }]} onPress={handleClose}>
            <Text style={styles.primaryText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Resolving the subject card (name/avatar) for the first time.
    if (cardQuery.isPending && !card) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={styles.muted}>{t('civic.vouch.confirm.loading')}</ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.content}>
        {/* Subject identity */}
        <View style={styles.identityRow}>
          {card?.avatarUrl ? (
            <Image source={{ uri: card.avatarUrl }} style={styles.avatar} resizeMode="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
              <Text style={[styles.avatarInitial, { color: colors.textSecondary }]}>
                {subjectName.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <View style={styles.identityText}>
            <ThemedText style={styles.name} numberOfLines={2}>
              {subjectName || t('civic.vouch.confirm.unknownPerson')}
            </ThemedText>
            {card?.username && (
              <ThemedText style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
                @{card.username}
              </ThemedText>
            )}
          </View>
        </View>

        <ThemedText style={[styles.intro, { color: colors.text }]}>
          {t('civic.vouch.confirm.intro', { name: subjectName || t('civic.vouch.confirm.unknownPerson') })}
        </ThemedText>

        {/* Stake input */}
        <Section title={t('civic.vouch.confirm.stakeTitle')}>
          <ThemedText style={styles.sectionSubtitle}>{t('civic.vouch.confirm.stakeHint')}</ThemedText>
          <AccountCard>
            <View style={styles.stakeRow}>
              <MaterialCommunityIcons name="shield-star-outline" size={20} color={colors.tint} />
              <ThemedText style={styles.stakeLabel}>{t('civic.vouch.confirm.stakeLabel')}</ThemedText>
              <TextInput
                value={stakeText}
                onChangeText={setStakeText}
                keyboardType="number-pad"
                maxLength={3}
                editable={!busy}
                accessibilityLabel={t('civic.vouch.confirm.stakeLabel')}
                style={[styles.stakeInput, { color: colors.text, borderColor: colors.border }]}
              />
            </View>
          </AccountCard>
        </Section>

        {/* Slash warning */}
        <View style={[styles.warningCard, { backgroundColor: `${colors.warning}14`, borderColor: `${colors.warning}55` }]}>
          <MaterialCommunityIcons name="alert-outline" size={20} color={colors.warning} />
          <ThemedText style={[styles.warningText, { color: colors.text }]}>
            {t('civic.vouch.confirm.slashWarning')}
          </ThemedText>
        </View>

        {biometricFailed && (
          <ThemedText style={[styles.biometricWarn, { color: colors.warning }]}>
            {t('civic.vouch.confirm.biometricFailed')}
          </ThemedText>
        )}

        <TouchableOpacity
          style={[styles.vouchBtn, { backgroundColor: colors.tint }, busy && styles.btnDisabled]}
          onPress={handleVouch}
          disabled={busy}
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="fingerprint" size={20} color="#fff" />
          <Text style={styles.vouchText}>{t('civic.vouch.confirm.cta')}</Text>
        </TouchableOpacity>

        {busy && (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.tint} />
            <ThemedText style={styles.muted}>{t('civic.vouch.confirm.submitting')}</ThemedText>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleClose} accessibilityRole="button" style={styles.backBtn}>
            <MaterialCommunityIcons name="chevron-left" size={26} color={colors.text} />
          </TouchableOpacity>
          <ThemedText style={styles.topTitle}>{t('civic.vouch.confirm.title')}</ThemedText>
        </View>
        {renderBody()}
      </View>
    </ScreenContentWrapper>
  );
}

interface EmptyStateProps {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  body: string;
  colors: ReturnType<typeof useColors>;
}

function EmptyState({ icon, title, body, colors }: EmptyStateProps) {
  return (
    <View style={styles.centered}>
      <MaterialCommunityIcons name={icon} size={56} color={colors.textSecondary} />
      <ThemedText style={styles.resultTitle}>{title}</ThemedText>
      <ThemedText style={[styles.muted, styles.centerText]}>{body}</ThemedText>
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
  content: { padding: 16, paddingBottom: 120 },
  identityRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 24, fontWeight: '600' },
  identityText: { flex: 1, marginLeft: 14 },
  name: { fontSize: 20, fontWeight: '700' },
  username: { fontSize: 14, marginTop: 2 },
  intro: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  sectionSubtitle: { fontSize: 14, opacity: 0.7, marginBottom: 12 },
  stakeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  stakeLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  stakeInput: {
    minWidth: 64,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  warningCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
  },
  warningText: { flex: 1, fontSize: 13, lineHeight: 19 },
  biometricWarn: { fontSize: 13, marginTop: 12 },
  vouchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 12,
    marginTop: 20,
  },
  btnDisabled: { opacity: 0.6 },
  vouchText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  busyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 14 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 14,
    minHeight: 360,
  },
  muted: { fontSize: 14, opacity: 0.7, lineHeight: 20 },
  centerText: { textAlign: 'center' },
  resultTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  stakedChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stakedText: { fontSize: 13, fontWeight: '600' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryText: { fontSize: 15, fontWeight: '600' },
  primaryBtn: { marginTop: 4, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
