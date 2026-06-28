import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Screen, StackHeader, PrimaryButton } from '@/components/ui';
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
    <Screen gap={24}>
      <StackHeader
        title={t('civic.attest.request.title')}
        onClose={() => router.back()}
        closeAccessibilityLabel={t('common.close')}
      />

      <View style={styles.body}>
        <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('civic.attest.request.subtitle')}
        </ThemedText>

        <View style={[styles.qrSurface, { backgroundColor: colors.card }]}>
          {state === 'loading' && <ActivityIndicator size="large" color={colors.tint} />}

          {state === 'error' && (
            <View style={styles.qrState}>
              <MaterialCommunityIcons name="alert-circle-outline" size={40} color={colors.error} />
              <ThemedText style={styles.qrStateText}>{t('civic.attest.request.buildError')}</ThemedText>
            </View>
          )}

          {state === 'ready' && payload && !expired && (
            <View style={styles.qrWrapper}>
              <QRCode value={payload} size={216} color="#1C1C1E" backgroundColor="transparent" />
            </View>
          )}

          {state === 'ready' && expired && (
            <View style={styles.qrState}>
              <MaterialCommunityIcons name="timer-off-outline" size={40} color={colors.textSecondary} />
              <ThemedText style={[styles.qrStateText, { color: colors.textSecondary }]}>
                {t('civic.attest.request.expired')}
              </ThemedText>
            </View>
          )}
        </View>

        {state === 'ready' && !expired && (
          <CivicBadge tone="caution" icon="timer-outline" label={t('civic.attest.request.expiresIn', { time: mmss })} />
        )}

        <ThemedText style={[styles.hint, { color: colors.textSecondary }]}>
          {t('civic.attest.request.hint')}
        </ThemedText>

        {(expired || state === 'error') && (
          <View style={styles.regen}>
            <PrimaryButton icon="refresh" label={t('civic.attest.request.regenerate')} onPress={regenerate} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    gap: 20,
    paddingTop: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 21,
  },
  qrSurface: {
    width: 264,
    height: 264,
    borderRadius: 28,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrWrapper: {
    padding: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  qrState: {
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  qrStateText: {
    fontSize: 14,
    textAlign: 'center',
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  regen: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
});
