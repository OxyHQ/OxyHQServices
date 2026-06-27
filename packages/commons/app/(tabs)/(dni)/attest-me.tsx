import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { CivicBadge } from '@/components/civic/CivicBadge';
import { useAttestQr } from '@/hooks/useAttestQr';
import { useTranslation } from '@/lib/i18n';

/** Tick the countdown once a second. */
const TICK_MS = 1000;

/**
 * "Confirm you met me IRL" — the person being attested (A) shows this QR so a
 * counterparty (B) can scan it and sign a real-life attestation. The QR encodes
 * only A's DID + a single-use nonce (10-min expiry); B re-signs and the server
 * is authoritative. A countdown shows freshness; "Regenerate" mints a new QR.
 */
export default function AttestMeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();

  // One opaque interaction id per screen session (stable across regenerations).
  const context = useMemo(() => `irl-${Date.now().toString(36)}`, []);
  const { state, payload, exp, regenerate } = useAttestQr(context);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const remainingMs = exp ? exp - now : 0;
  const expired = exp !== null && remainingMs <= 0;
  const mmss = useMemo(() => {
    const total = Math.max(0, Math.floor(remainingMs / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, [remainingMs]);

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.topBar}>
          <ThemedText style={styles.topTitle}>{t('civic.attest.request.title')}</ThemedText>
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            style={styles.closeButton}
          >
            <MaterialCommunityIcons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <ThemedText style={styles.subtitle}>{t('civic.attest.request.subtitle')}</ThemedText>

          <View style={[styles.qrCard, { backgroundColor: colors.card }]}>
            {state === 'loading' && <ActivityIndicator size="large" color={colors.tint} />}

            {state === 'error' && (
              <View style={styles.centered}>
                <MaterialCommunityIcons name="alert-circle-outline" size={40} color={colors.error} />
                <ThemedText style={styles.errorText}>{t('civic.attest.request.buildError')}</ThemedText>
              </View>
            )}

            {state === 'ready' && payload && !expired && (
              <View style={styles.qrWrapper}>
                <QRCode value={payload} size={216} color="#1C1C1E" backgroundColor="transparent" />
              </View>
            )}

            {state === 'ready' && expired && (
              <View style={styles.centered}>
                <MaterialCommunityIcons name="timer-off-outline" size={40} color={colors.textSecondary} />
                <ThemedText style={styles.expiredText}>{t('civic.attest.request.expired')}</ThemedText>
              </View>
            )}
          </View>

          {state === 'ready' && !expired && (
            <View style={styles.chipRow}>
              <CivicBadge tone="caution" icon="timer-outline" label={t('civic.attest.request.expiresIn', { time: mmss })} />
            </View>
          )}

          <ThemedText style={[styles.hint, { color: colors.textSecondary }]}>
            {t('civic.attest.request.hint')}
          </ThemedText>

          {(expired || state === 'error') && (
            <TouchableOpacity
              style={[styles.regenButton, { backgroundColor: colors.tint }]}
              onPress={regenerate}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="refresh" size={20} color="#fff" />
              <Text style={styles.regenText}>{t('civic.attest.request.regenerate')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  topTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 120,
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 15,
    opacity: 0.8,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  qrCard: {
    width: 264,
    height: 264,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  qrWrapper: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  chipRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  centered: {
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  expiredText: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.8,
  },
  regenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  regenText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
