import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseAttestPayload } from '@oxyhq/core';
import { useOxy } from '@oxyhq/services';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Screen, StackHeader, CenteredState, PrimaryButton } from '@/components/ui';
import { useAttestFlow } from '@/hooks/civic/useAttestFlow';
import { useAttestAutoDispatch } from '@/hooks/civic/useAttestAutoDispatch';
import type { AttestSubmitParams } from '@/hooks/civic/attestStore';
import { userIdFromDid } from '@/lib/civic/did';
import { useTranslation } from '@/lib/i18n';

/**
 * OS/system NFC deep-link entry for a real-life attestation (the scanner's /
 * B's side). Reached by Android NFC foreground dispatch (this screen open) OR a
 * cold launch (app closed) straight into `oxycommons://attest?subject=…&ctx=…&
 * nonce=…&exp=…` (the same bytes `OxyServices.civic.buildAttestQrPayload` puts
 * on the QR — see `useNfcAttestEmitter` and the `plugins/with-hce.js` intent
 * filter, which targets this route; do NOT delete it). The in-app camera / NFC
 * READ paths never navigate here — they auto-submit inline on the scanner
 * (`app/(scan)/index.tsx`).
 *
 * FLUID AUTO-CONFIRM: exactly like the in-app scanner, this submits
 * AUTOMATICALLY — no "Confirm in person" heading, no button, no biometric. On
 * arrival it shows A's server-resolved identity + "Confirming you met {name}…",
 * then the ✓ done (points) / classified-error result. The single auto-dispatch
 * lives in `useAttestAutoDispatch` (the one sanctioned effect in the flow); it
 * is gated on `canUsePrivateApi` so a cold launch never races the SDK session
 * cold boot. A's identity comes ONLY from the resolved card — never the tag.
 */
export default function AttestDeepLinkScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { canUsePrivateApi } = useOxy();
  const raw = useLocalSearchParams<{ subject?: string; ctx?: string; nonce?: string; exp?: string }>();

  // Reconstruct the tag URI — with `''` for any missing field, so partial or
  // truncated tags still reach the parser — and validate it with the shared,
  // already-tested parser (`parseAttestPayload` never throws; it returns `null`
  // for anything unparseable).
  const parsed = useMemo(
    () =>
      parseAttestPayload(
        `oxycommons://attest?subject=${encodeURIComponent(raw.subject ?? '')}` +
          `&ctx=${encodeURIComponent(raw.ctx ?? '')}` +
          `&nonce=${encodeURIComponent(raw.nonce ?? '')}` +
          `&exp=${encodeURIComponent(raw.exp ?? '')}`,
      ),
    [raw.subject, raw.ctx, raw.nonce, raw.exp],
  );

  const params = useMemo<AttestSubmitParams | null>(
    () =>
      parsed
        ? { subjectDid: parsed.subjectDid, context: parsed.context, nonce: parsed.nonce, exp: parsed.exp }
        : null,
    [parsed],
  );

  const subjectUserId = parsed ? userIdFromDid(parsed.subjectDid) : null;
  const flow = useAttestFlow(subjectUserId);

  // Only surface the store flow when it is about THIS subject — a lingering
  // flow from an earlier scanner session must not leak into a fresh deep link.
  const flowMatches = parsed !== null && flow.subjectDid === parsed.subjectDid;
  const status = flowMatches ? flow.status : 'idle';

  // Ready to auto-confirm once the subject's card has resolved AND the SDK can
  // make private calls (session cold boot has settled). The one-shot dispatch
  // is guarded per subject inside the hook.
  const ready = canUsePrivateApi && subjectUserId !== null && flow.subject !== null;
  useAttestAutoDispatch(ready, params, flow.submit);

  const handleClose = useCallback(() => {
    flow.reset();
    if (router.canGoBack()) router.back();
    // Cold deep link with no history — land on the ID home, not the scanner.
    else router.replace('/(tabs)/(id)');
  }, [flow.reset, router]);

  const card = flow.subject?.card;
  const name = card?.name ?? '';

  const renderBody = () => {
    // Malformed/truncated tag, an unresolvable DID, or a failed card lookup —
    // there is no subject to show.
    if (!parsed || !subjectUserId || flow.subjectFailed) {
      return (
        <CenteredState
          icon="alert-circle-outline"
          iconColor={colors.error}
          title={t('civic.attest.confirm.error.title')}
          body={t(`civic.attest.error.${!parsed || !subjectUserId ? 'generic' : 'subject_not_found'}`)}
          action={
            <PrimaryButton label={t('common.close')} onPress={handleClose} fullWidth={false} />
          }
        />
      );
    }

    if (status === 'error') {
      return (
        <CenteredState
          icon="alert-circle-outline"
          iconColor={colors.error}
          title={t('civic.attest.confirm.error.title')}
          body={t(`civic.attest.error.${flow.errorCode ?? 'generic'}`)}
          action={
            <PrimaryButton label={t('common.close')} onPress={handleClose} fullWidth={false} />
          }
        />
      );
    }

    if (status === 'done' && flow.result) {
      return (
        <CenteredState
          icon="check-decagram"
          iconColor={colors.success}
          title={t('civic.attest.confirm.done.title')}
          body={t('civic.attest.confirm.done.body', { name, points: flow.result.points })}
          action={
            <View style={styles.action}>
              <PrimaryButton label={t('common.done')} onPress={handleClose} fullWidth={false} />
            </View>
          }
        />
      );
    }

    if (!card) {
      return <CenteredState loading body={t('civic.attest.confirm.loading')} />;
    }

    // idle (awaiting the one-shot auto-dispatch) / submitting — both read as
    // "Confirming…" so the screen feels instant and fluid. A's identity comes
    // ONLY from the resolved card.
    return (
      <View style={styles.body}>
        <View style={styles.identity}>
          {card.avatarUrl ? (
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
          {card.username && (
            <ThemedText style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
              @{card.username}
            </ThemedText>
          )}
        </View>

        <View style={styles.submitting}>
          <ActivityIndicator color={colors.tint} />
          <ThemedText style={[styles.submittingText, { color: colors.textSecondary }]}>
            {t('civic.attest.confirm.submitting', { name })}
          </ThemedText>
        </View>
      </View>
    );
  };

  return (
    <Screen gap={24}>
      <StackHeader
        title={t('civic.attest.section.title')}
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
  body: {
    alignItems: 'center',
    gap: 20,
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
  submitting: {
    alignItems: 'center',
    gap: 10,
  },
  submittingText: {
    fontSize: 15,
    textAlign: 'center',
  },
});
