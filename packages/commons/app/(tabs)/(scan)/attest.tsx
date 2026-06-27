import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Image, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useRealLifeAttest, type RealLifeAttestParams } from '@/hooks/useRealLifeAttest';
import { useTranslation } from '@/lib/i18n';

/**
 * Confirm-someone screen (the scanner's / B's side of a real-life attestation).
 *
 * Reached from the QR scanner after it parses an `oxydni://attest?…` payload.
 * Resolves the subject (A) server-side from the DID, gates the signed
 * attestation behind the device biometric, then submits it. The subject identity
 * shown comes ONLY from the resolved card — never from the scanned QR.
 */
export default function AttestConfirmScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const raw = useLocalSearchParams<{ subjectDid?: string; context?: string; nonce?: string; exp?: string }>();

  const params = useMemo<RealLifeAttestParams | null>(() => {
    const exp = Number(raw.exp);
    if (!raw.subjectDid || !raw.nonce || !Number.isFinite(exp)) return null;
    return { subjectDid: raw.subjectDid, context: raw.context ?? '', nonce: raw.nonce, exp };
  }, [raw.subjectDid, raw.context, raw.nonce, raw.exp]);

  const { state, subject, biometricFailed, errorCode, result, confirm, reload } = useRealLifeAttest(
    params,
    t('civic.attest.confirm.biometricReason'),
  );

  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(scan)');
  }, [router]);

  const card = subject?.card;
  const name = card?.name ?? '';

  const renderBody = () => {
    if (state === 'loading') {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={styles.muted}>{t('civic.attest.confirm.loading')}</ThemedText>
        </View>
      );
    }

    if (state === 'error') {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="alert-circle-outline" size={56} color={colors.error} />
          <ThemedText style={styles.title}>{t('civic.attest.confirm.error.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>
            {t(`civic.attest.error.${errorCode ?? 'generic'}`)}
          </ThemedText>
          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={handleClose}>
              <Text style={[styles.secondaryText, { color: colors.text }]}>{t('common.close')}</Text>
            </TouchableOpacity>
            {errorCode === 'generic' && (
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.tint }]} onPress={reload}>
                <Text style={styles.primaryText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    }

    if (state === 'done' && result) {
      return (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="check-decagram" size={64} color={colors.success} />
          <ThemedText style={styles.title}>{t('civic.attest.confirm.done.title')}</ThemedText>
          <ThemedText style={[styles.muted, styles.centerText]}>
            {t('civic.attest.confirm.done.body', { name, points: result.points })}
          </ThemedText>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.tint }]} onPress={handleClose}>
            <Text style={styles.primaryText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // ready / confirming
    return (
      <View style={styles.confirmBody}>
        <View style={styles.identityRow}>
          {card?.avatarUrl ? (
            <Image source={{ uri: card.avatarUrl }} style={styles.avatar} resizeMode="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
              <Text style={[styles.avatarInitial, { color: colors.textSecondary }]}>
                {name.charAt(0).toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <ThemedText style={styles.name} numberOfLines={2}>
            {name}
          </ThemedText>
          {card?.username && (
            <ThemedText style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
              @{card.username}
            </ThemedText>
          )}
        </View>

        <ThemedText style={[styles.prompt, styles.centerText]}>
          {t('civic.attest.confirm.prompt', { name })}
        </ThemedText>
        <ThemedText style={[styles.muted, styles.centerText]}>{t('civic.attest.confirm.weight')}</ThemedText>

        {biometricFailed && (
          <ThemedText style={[styles.biometricWarn, { color: colors.warning }]}>
            {t('civic.attest.confirm.biometricFailed')}
          </ThemedText>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, styles.fullBtn, { backgroundColor: colors.success }]}
          onPress={confirm}
          disabled={state === 'confirming'}
          accessibilityRole="button"
        >
          {state === 'confirming' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>{t('civic.attest.confirm.cta')}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={handleClose} disabled={state === 'confirming'}>
          <Text style={[styles.linkText, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.topBar}>
          <ThemedText style={styles.topTitle}>{t('civic.attest.confirm.title')}</ThemedText>
          <TouchableOpacity
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            style={styles.closeButton}
          >
            <MaterialCommunityIcons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
        {renderBody()}
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  topTitle: { fontSize: 20, fontWeight: '700' },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 14,
    minHeight: 360,
  },
  confirmBody: { padding: 24, alignItems: 'center', gap: 12 },
  identityRow: { alignItems: 'center', gap: 8, marginBottom: 8 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 36, fontWeight: '600' },
  name: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  username: { fontSize: 15 },
  prompt: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  muted: { fontSize: 14, opacity: 0.7, lineHeight: 20 },
  centerText: { textAlign: 'center' },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  biometricWarn: { fontSize: 13, textAlign: 'center', marginTop: 4 },
  primaryBtn: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullBtn: { alignSelf: 'stretch' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryText: { fontSize: 16, fontWeight: '600' },
  linkBtn: { paddingVertical: 12 },
  linkText: { fontSize: 15 },
  actionsRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
