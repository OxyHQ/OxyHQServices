import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { AccountCard } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { CivicBadge } from '@/components/civic/CivicBadge';
import { useValidatorInbox } from '@/hooks/useValidatorInbox';
import { useValidationVote } from '@/hooks/useValidationVote';
import { prettyActionType, payloadEntries } from '@/lib/civic/validation-format';
import { useTranslation } from '@/lib/i18n';

/**
 * Juror vote screen. Shows the request the user was selected to judge and the
 * verdict actions. A signed verdict (Valid / Invalid / Abstain) is gated behind
 * the device biometric; Recuse needs none. The request itself is read from the
 * shared inbox query (no single-request endpoint) — if it's no longer there
 * (already voted / closed), we say so.
 */
export default function ValidationVoteScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isPending } = useValidatorInbox();
  const request = useMemo(() => data?.find((r) => r.id === id) ?? null, [data, id]);

  const { state, biometricFailed, errorCode, vote, deny } = useValidationVote(
    request?.id ?? null,
    request?.payloadHash ?? null,
    t('civic.validate.vote.biometricReason'),
  );

  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(reputation)/validate');
  }, [router]);

  const busy = state === 'voting' || state === 'denying';

  const renderBody = () => {
    if (state === 'done') {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="check-decagram" size={64} color={colors.success} />
          <ThemedText style={styles.title}>{t('civic.validate.vote.done.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>{t('civic.validate.vote.done.body')}</ThemedText>
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
          <ThemedText style={styles.title}>{t('civic.validate.vote.error.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>
            {t(`civic.validate.error.${errorCode ?? 'generic'}`)}
          </ThemedText>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.tint }]} onPress={handleClose}>
            <Text style={styles.primaryText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (isPending && !request) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      );
    }

    if (!request) {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="gavel" size={56} color={colors.textSecondary} />
          <ThemedText style={styles.title}>{t('civic.validate.vote.gone.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>{t('civic.validate.vote.gone.body')}</ThemedText>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.tint }]} onPress={handleClose}>
            <Text style={styles.primaryText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const entries = payloadEntries(request.payload);

    return (
      <View style={styles.content}>
        <View style={styles.headerBlock}>
          <ThemedText style={styles.actionType}>{prettyActionType(request.actionType)}</ThemedText>
          {request.highValue && (
            <View style={styles.badgeRow}>
              <CivicBadge tone="caution" icon="star-circle-outline" label={t('civic.validate.highValue')} />
            </View>
          )}
        </View>

        <ThemedText style={[styles.muted, styles.prompt]}>{t('civic.validate.vote.prompt')}</ThemedText>

        <Section title={t('civic.validate.vote.detailsTitle')}>
          <AccountCard>
            <View style={styles.detailCard}>
              {entries.length === 0 ? (
                <ThemedText style={[styles.muted, styles.centerText]}>{t('civic.validate.vote.noDetails')}</ThemedText>
              ) : (
                entries.map((e) => (
                  <View key={e.key} style={styles.detailRow}>
                    <ThemedText style={[styles.detailKey, { color: colors.textSecondary }]}>{e.key}</ThemedText>
                    <ThemedText style={styles.detailValue} numberOfLines={3}>
                      {e.value}
                    </ThemedText>
                  </View>
                ))
              )}
            </View>
          </AccountCard>
        </Section>

        {biometricFailed && (
          <ThemedText style={[styles.biometricWarn, { color: colors.warning }]}>
            {t('civic.validate.vote.biometricFailed')}
          </ThemedText>
        )}

        <View style={styles.verdictRow}>
          <TouchableOpacity
            style={[styles.verdictBtn, { backgroundColor: colors.success }]}
            onPress={() => vote('valid')}
            disabled={busy}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="check" size={20} color="#fff" />
            <Text style={styles.verdictText}>{t('civic.validate.vote.valid')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.verdictBtn, { backgroundColor: colors.error }]}
            onPress={() => vote('invalid')}
            disabled={busy}
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="close" size={20} color="#fff" />
            <Text style={styles.verdictText}>{t('civic.validate.vote.invalid')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          onPress={() => vote('abstain')}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryText, { color: colors.text }]}>{t('civic.validate.vote.abstain')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkBtn} onPress={deny} disabled={busy} accessibilityRole="button">
          <Text style={[styles.linkText, { color: colors.textSecondary }]}>{t('civic.validate.vote.recuse')}</Text>
        </TouchableOpacity>

        {busy && (
          <View style={styles.busyRow}>
            <ActivityIndicator color={colors.tint} />
            <ThemedText style={styles.muted}>{t('civic.validate.vote.submitting')}</ThemedText>
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
          <ThemedText style={styles.topTitle}>{t('civic.validate.vote.title')}</ThemedText>
        </View>
        {renderBody()}
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  topTitle: { fontSize: 20, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 120 },
  headerBlock: { marginBottom: 8 },
  actionType: { fontSize: 22, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', marginTop: 8 },
  prompt: { marginBottom: 12, lineHeight: 20 },
  detailCard: { padding: 12, gap: 10 },
  detailRow: { gap: 2 },
  detailKey: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  detailValue: { fontSize: 15 },
  biometricWarn: { fontSize: 13, marginTop: 12, marginBottom: 4 },
  verdictRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  verdictBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
  },
  verdictText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 16, fontWeight: '600' },
  linkBtn: { paddingVertical: 14, alignItems: 'center' },
  linkText: { fontSize: 15 },
  busyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14, minHeight: 360 },
  muted: { fontSize: 14, opacity: 0.7, lineHeight: 20 },
  centerText: { textAlign: 'center' },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  primaryBtn: { marginTop: 12, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
