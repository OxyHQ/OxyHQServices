import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseAttestPayload } from '@oxyhq/core';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Screen, StackHeader, CenteredState, PrimaryButton } from '@/components/ui';
import { useAttestFlow } from '@/hooks/civic/useAttestFlow';
import { userIdFromDid } from '@/lib/civic/did';
import { useTranslation } from '@/lib/i18n';

/**
 * COLD-DEEP-LINK entry for a real-life attestation (the scanner's / B's side).
 *
 * The in-app paths (camera QR scan, in-app NFC read) no longer navigate here —
 * they auto-submit inline on the scanner (`app/(scan)/index.tsx`). This route
 * exists solely for the system NDEF tap on Android (app possibly closed): the
 * OS launches straight here from the tag's raw
 * `oxycommons://attest?subject=…&ctx=…&nonce=…&exp=…` URI (the same bytes
 * `OxyServices.civic.buildAttestQrPayload` puts on the QR — see
 * `useNfcAttestEmitter` and the `plugins/with-hce.js` intent filter, which
 * targets this route; do NOT delete it). expo-router hands back that URI's own
 * query keys (`subject`/`ctx`), reconstructed and re-run through the shared
 * Zod-backed `parseAttestPayload` so this path can never drift from the
 * scanner's validation.
 *
 * NOTE — no auto-trigger on this path yet (owner decision pending): the attest
 * flow is event-driven with zero `useEffect`, and this cold OS launch provides
 * no in-app event to hook the automatic submit onto (the app has no OS-URL
 * subscription / `+native-intent` infrastructure, and a cold-start submit would
 * also race the SDK's session cold boot). Until that is decided, this screen
 * renders A's server-resolved card plus whatever the flow store holds for this
 * subject (submitting/done/error render identically to the scanner's overlay).
 */
export default function AttestDeepLinkScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
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

  const subjectUserId = parsed ? userIdFromDid(parsed.subjectDid) : null;
  const flow = useAttestFlow(subjectUserId);

  // Only surface the store flow when it is about THIS subject — a lingering
  // flow from an earlier scanner session must not leak into a fresh deep link.
  const flowMatches = parsed !== null && flow.subjectDid === parsed.subjectDid;
  const status = flowMatches ? flow.status : 'idle';

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

    // idle / submitting — A's identity comes ONLY from the resolved card,
    // never from the tag.
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

        {status === 'submitting' && (
          <View style={styles.submitting}>
            <ActivityIndicator color={colors.tint} />
            <ThemedText style={[styles.submittingText, { color: colors.textSecondary }]}>
              {t('civic.attest.confirm.submitting', { name })}
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
