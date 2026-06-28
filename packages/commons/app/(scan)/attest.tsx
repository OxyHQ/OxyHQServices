import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Screen, StackHeader, CenteredState, PrimaryButton, SecondaryButton } from '@/components/ui';
import { useRealLifeAttest, type RealLifeAttestParams } from '@/hooks/useRealLifeAttest';
import { useTranslation } from '@/lib/i18n';

/**
 * Confirm-someone screen (the scanner's / B's side of a real-life attestation).
 *
 * Reached from the QR scanner after it parses an `oxycommons://attest?…` payload.
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

    // ready / confirming
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

        <ThemedText style={[styles.prompt, { color: colors.text }]}>
          {t('civic.attest.confirm.prompt', { name })}
        </ThemedText>
        <ThemedText style={[styles.weight, { color: colors.textSecondary }]}>
          {t('civic.attest.confirm.weight')}
        </ThemedText>

        {biometricFailed && (
          <ThemedText style={[styles.inlineWarn, { color: colors.warning }]}>
            {t('civic.attest.confirm.biometricFailed')}
          </ThemedText>
        )}

        <View style={styles.actions}>
          <PrimaryButton
            tone="success"
            label={t('civic.attest.confirm.cta')}
            loading={state === 'confirming'}
            onPress={confirm}
          />
          <SecondaryButton label={t('common.cancel')} onPress={handleClose} disabled={state === 'confirming'} />
        </View>
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
  prompt: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 24,
    textAlign: 'center',
  },
  weight: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
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
