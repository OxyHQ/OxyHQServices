import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseAttestPayload } from '@oxyhq/core';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Screen, StackHeader, CenteredState, PrimaryButton, SecondaryButton } from '@/components/ui';
import { useRealLifeAttest, type RealLifeAttestParams } from '@/hooks/useRealLifeAttest';
import { useTranslation } from '@/lib/i18n';

/**
 * Confirm-someone screen (the scanner's / B's side of a real-life attestation).
 *
 * Reached from the QR scanner / in-app NFC read after `parseScan` resolves an
 * `oxycommons://attest?…` payload (those paths pre-parse it and hand over
 * `subjectDid`/`context`/`nonce`/`exp`), OR reached directly by a system NDEF
 * tap on Android (app possibly closed): the OS launches straight to this route
 * from the tag's raw `oxycommons://attest?subject=…&ctx=…&nonce=…&exp=…` URI
 * (the same bytes `OxyServices.civic.buildAttestQrPayload` puts on the QR — see
 * `useNfcAttestEmitter`), so expo-router hands back that URI's own query keys
 * (`subject`/`ctx`) instead of the scanner's camelCase fields. Both are
 * normalized into the same shape below (mirrors
 * `lib/commons-signin/parse-scan.ts`'s `parseAttestPayload` → `ScanResult`
 * mapping) before reaching `useRealLifeAttest`.
 *
 * Resolves the subject (A) server-side from the DID, gates the signed
 * attestation behind the device biometric, then submits it. The subject identity
 * shown comes ONLY from the resolved card — never from the scanned QR.
 */
export default function AttestConfirmScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const raw = useLocalSearchParams<{
    subjectDid?: string;
    context?: string;
    nonce?: string;
    exp?: string;
    // Raw system-NDEF-tap fields — see the module doc comment above.
    subject?: string;
    ctx?: string;
  }>();

  // Is this landing a system NDEF-tap deep link (vs a scanner handoff)? The
  // deep link carries the raw URI's own keys (`subject`/`ctx`); the scanner
  // paths pass `subjectDid`/`context` instead. `nonce`/`exp` exist on BOTH, so
  // they only mark a deep link when the scanner's `subjectDid` is absent —
  // that way a truncated tag that lost its `subject` still lands on the
  // deep-link branch (and its warn) instead of silently falling through.
  const isDeepLink =
    raw.subject !== undefined ||
    raw.ctx !== undefined ||
    (raw.subjectDid === undefined && (raw.nonce !== undefined || raw.exp !== undefined));

  // System NFC tap (Android, app possibly closed) deep-links the tag's raw
  // `oxycommons://attest?subject=…&ctx=…&nonce=…&exp=…` URI; expo-router hands
  // back that URI's literal query keys. Reconstruct it — with `''` for any
  // missing field, so partial/truncated tags still reach the parser — and
  // re-run it through the shared, already-tested parser so this path can never
  // drift from the scanner's validation (`parseAttestPayload` never throws —
  // it returns `null` for anything unparseable, warn-logged here).
  const fromDeepLink = useMemo(() => {
    if (!isDeepLink) return null;
    const reconstructed =
      `oxycommons://attest?subject=${encodeURIComponent(raw.subject ?? '')}` +
      `&ctx=${encodeURIComponent(raw.ctx ?? '')}` +
      `&nonce=${encodeURIComponent(raw.nonce ?? '')}` +
      `&exp=${encodeURIComponent(raw.exp ?? '')}`;
    const parsed = parseAttestPayload(reconstructed);
    if (!parsed) {
      console.warn('[AttestScreen] invalid NFC attest deep link', { subject: raw.subject });
    }
    return parsed;
  }, [isDeepLink, raw.subject, raw.ctx, raw.nonce, raw.exp]);

  const params = useMemo<RealLifeAttestParams | null>(() => {
    if (isDeepLink) {
      // A malformed deep link never falls back to the scanner fields — it
      // resolves to null and follows the screen's existing invalid state.
      if (!fromDeepLink) return null;
      return {
        subjectDid: fromDeepLink.subjectDid,
        context: fromDeepLink.context,
        nonce: fromDeepLink.nonce,
        exp: fromDeepLink.exp,
      };
    }
    const exp = Number(raw.exp);
    if (!raw.subjectDid || !raw.nonce || !Number.isFinite(exp)) return null;
    return { subjectDid: raw.subjectDid, context: raw.context ?? '', nonce: raw.nonce, exp };
  }, [isDeepLink, fromDeepLink, raw.subjectDid, raw.context, raw.nonce, raw.exp]);

  const { state, subject, biometricFailed, errorCode, result, confirm, reload } = useRealLifeAttest(
    params,
    t('civic.attest.confirm.biometricReason'),
  );

  const handleClose = useCallback(() => {
    if (router.canGoBack()) router.back();
    // Cold deep link with no history — land on the ID home, not the scanner.
    else router.replace('/(tabs)/(id)');
  }, [router]);

  const card = subject?.card;
  const name = card?.name ?? '';

  const renderBody = () => {
    if (state === 'loading') {
      return <CenteredState loading body={t('civic.attest.confirm.loading')} />;
    }

    if (state === 'error') {
      return (
        <CenteredState
          icon="alert-circle-outline"
          iconColor={colors.error}
          title={t('civic.attest.confirm.error.title')}
          body={t(`civic.attest.error.${errorCode ?? 'generic'}`)}
          action={
            <View style={styles.errorActions}>
              <SecondaryButton label={t('common.close')} onPress={handleClose} fullWidth={false} />
              {errorCode === 'generic' && (
                <PrimaryButton label={t('common.retry')} onPress={reload} fullWidth={false} />
              )}
            </View>
          }
        />
      );
    }

    if (state === 'done' && result) {
      return (
        <CenteredState
          icon="check-decagram"
          iconColor={colors.success}
          title={t('civic.attest.confirm.done.title')}
          body={t('civic.attest.confirm.done.body', { name, points: result.points })}
          action={
            <View style={styles.action}>
              <PrimaryButton label={t('common.done')} onPress={handleClose} fullWidth={false} />
            </View>
          }
        />
      );
    }

    // ready / confirming — the tap is the intent, so the biometric gate runs
    // automatically; there is no confirm button. Only a biometric FAILURE
    // surfaces a manual retry.
    return (
      <View style={styles.confirmBody}>
        <View style={styles.identity}>
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

        {biometricFailed ? (
          <>
            <ThemedText style={[styles.inlineWarn, { color: colors.warning }]}>
              {t('civic.attest.confirm.biometricFailed', { name })}
            </ThemedText>
            <View style={styles.actions}>
              <PrimaryButton
                tone="success"
                label={t('civic.attest.confirm.biometricRetry')}
                onPress={confirm}
              />
              <SecondaryButton label={t('common.cancel')} onPress={handleClose} />
            </View>
          </>
        ) : (
          <View style={styles.statusRow}>
            <ActivityIndicator color={colors.textSecondary} />
            <ThemedText style={[styles.status, { color: colors.textSecondary }]}>
              {t(state === 'confirming' ? 'civic.attest.confirm.recording' : 'civic.attest.confirm.verifying')}
            </ThemedText>
          </View>
        )}
      </View>
    );
  };

  return (
    <Screen gap={24}>
      <StackHeader
        title={t('civic.attest.confirm.title')}
        onClose={handleClose}
        closeAccessibilityLabel={t('common.close')}
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
  errorActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  confirmBody: {
    alignItems: 'center',
    gap: 14,
    paddingTop: 12,
  },
  identity: {
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 36,
    fontWeight: '600',
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  username: {
    fontSize: 15,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  status: {
    fontSize: 15,
  },
  inlineWarn: {
    fontSize: 13,
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: 12,
    marginTop: 8,
  },
});
