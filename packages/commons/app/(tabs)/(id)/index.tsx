import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Platform, AppState, AccessibilityInfo } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Easing,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useOxy, useCurrentUser } from '@oxyhq/services';
import { buildUserDid } from '@oxyhq/core';
import { Fab } from '@oxyhq/bloom/fab';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Screen, Section, GroupedList, ListRow, Callout } from '@/components/ui';
import { Ticket as OxyID } from '@/components/OxyID';
import { FrontSide } from '@/components/OxyID/front-side';
import { BackSide } from '@/components/OxyID/back-side';
import { IdQrBack } from '@/components/civic/IdQrBack';
import { useIdentity } from '@/hooks/useIdentity';
import { useAvatarUrl } from '@/hooks/useAvatarUrl';
import { useCivicProfileState } from '@/hooks/useCivicProfileState';
import { useAttestQr } from '@/hooks/useAttestQr';
import { useNfcAttestEmitter } from '@/hooks/nfc/useNfcAttestEmitter';
import { useAttestedEvent, type AttestedEventPayload } from '@/hooks/civic/useAttestedEvent';
import { getDisplayName } from '@/utils/date-utils';
import { useTranslation } from '@/lib/i18n';

const CARD_WIDTH = 240;
const CARD_HEIGHT = 380;

/**
 * The Oxy ID screen — the landing/home surface of Commons.
 *
 * It is BOTH the identity overview (formerly the Home tab) and the citizen ID
 * card, merged into one coherent screen:
 *
 *   - The hero is the flippable OxyID card. The FRONT reuses the holographic
 *     identity card (name, @username, public-key ID, trust-tier badge); the BACK
 *     renders a QR of `oxyServices.getMyIdPayload()` — the DID-only payload a
 *     counterpart scans to resolve and verify the signed card server-side.
 *   - Below the card: the self-custody identity actions (deep-linking into the
 *     Settings "about your identity" detail), the real-life attestation entry,
 *     and the raw DID.
 *   - A Bloom FAB (bottom-right) opens the QR scanner, which lives at the root as
 *     a full-screen modal (`app/(scan)`) so its camera covers the tab bar.
 *
 * No in-screen title/subtitle/status chip: the tab bar already labels this "ID"
 * and the card stands on its own. The single accent moment is the card itself;
 * everything below it is flat, hairline-separated rows.
 *
 * Offline-first: the card front (identity + key + QR) is ALWAYS rendered from
 * the LOCAL identity and never gated on the network. The live trust tier is
 * hydrated cache-first from the signed public card.
 */
export default function IdScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { user, oxyServices } = useOxy();
  // Hydrate the user record (createdAt + fields missing from a cached signIn).
  useCurrentUser();
  const { getPublicKey, identitySyncState } = useIdentity();

  // Drives cache-first vs live data for the card and the `pending` (not yet
  // server-registered) case. The visible status chip was intentionally dropped;
  // the hook stays wired because `state` still gates the pending note below.
  const { state } = useCivicProfileState({
    subject: 'self',
    isSynced: identitySyncState.isSynced,
  });

  const displayName = getDisplayName(user);
  const avatarUrl = useAvatarUrl(user);

  // The public key lives in local secure storage — load it directly so the card
  // renders without waiting on any network call.
  const [publicKey, setPublicKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPublicKey()
      .then((pk) => {
        if (!cancelled) setPublicKey(pk);
      })
      .catch((error) => {
        console.error('[IdScreen] Failed to load public key', error);
      });
    return () => {
      cancelled = true;
    };
  }, [getPublicKey]);

  const userId = user?.id ?? oxyServices?.getCurrentUserId() ?? null;
  const did = useMemo(() => (userId ? buildUserDid(userId) : null), [userId]);

  // The Oxy ID QR payload (DID-only). Requires an authenticated session; guarded
  // so a transient "no user id" never throws through render.
  const qrPayload = useMemo(() => {
    if (!oxyServices) return null;
    try {
      return oxyServices.getMyIdPayload();
    } catch {
      return null;
    }
  }, [oxyServices, userId]);

  // ---- NFC attest emission + card feedback -------------------------------
  const scanPulse = useSharedValue(0);
  const attestGlow = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // NFC emission must stop the moment the app leaves the foreground (locked,
  // backgrounded, task-switched) — a stale HCE session would keep answering
  // APDU reads with the attestation payload while the device is out of the
  // user's hands. The emitter's own blur/unmount disarm logic handles the
  // `focused`/`enabled` transition; this only tracks OS-level foreground state.
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppActive(nextState === 'active');
    });
    return () => subscription.remove();
  }, []);

  // Same payload the attest-me QR uses; one interaction id per screen session.
  const attestContext = useMemo(() => `irl-nfc-${Date.now().toString(36)}`, []);
  const { payload: attestPayload, exp: attestExp, regenerate: regenerateAttest } = useAttestQr(attestContext);

  // Single-use nonce: re-mint when it expires while we are emitting.
  useEffect(() => {
    if (!focused || !appActive || !attestExp) return;
    const ms = attestExp - Date.now();
    if (ms <= 0) {
      regenerateAttest();
      return;
    }
    const id = setTimeout(regenerateAttest, ms);
    return () => clearTimeout(id);
  }, [focused, appActive, attestExp, regenerateAttest]);

  const triggerScanPulse = useCallback(() => {
    void Haptics.selectionAsync();
    if (reducedMotion) return;
    scanPulse.value = 0;
    scanPulse.value = withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }, (finished) => {
      if (finished) scanPulse.value = 0;
    });
  }, [scanPulse, reducedMotion]);

  const [attestedVisible, setAttestedVisible] = useState(false);
  const attestedBadgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (attestedBadgeTimeoutRef.current) clearTimeout(attestedBadgeTimeoutRef.current);
    };
  }, []);
  const triggerAttestGlow = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAttestedVisible(true);
    AccessibilityInfo.announceForAccessibility(t('civic.attest.confirmed'));
    if (attestedBadgeTimeoutRef.current) clearTimeout(attestedBadgeTimeoutRef.current);
    attestedBadgeTimeoutRef.current = setTimeout(() => setAttestedVisible(false), 2500);
    if (reducedMotion) return;
    attestGlow.value = withSequence(
      withTiming(1, { duration: 400 }),
      withDelay(1000, withTiming(0, { duration: 1400 })),
    );
  }, [attestGlow, reducedMotion, t]);

  const { state: nfcState } = useNfcAttestEmitter({
    payload: attestPayload,
    enabled: focused && appActive,
    onRead: () => {
      triggerScanPulse();
      regenerateAttest();
    },
  });

  const handleAttestedEvent = useCallback(
    (payload: AttestedEventPayload) => {
      // A confirmation is only ever displayed for the identity currently on
      // screen — ignore events for another account signed in on this device.
      if (!userId || payload.subjectUserId !== userId) return;
      triggerAttestGlow();
    },
    [userId, triggerAttestGlow],
  );

  useAttestedEvent(handleAttestedEvent);

  const publicKeyShort = useMemo(() => {
    if (!publicKey) return undefined;
    if (publicKey.length <= 16) return publicKey;
    return `${publicKey.substring(0, 8)}...${publicKey.substring(publicKey.length - 8)}`;
  }, [publicKey]);

  const handleScan = useCallback(() => {
    router.push('/(scan)');
  }, [router]);

  const handleAttestMe = useCallback(() => {
    router.push('/(tabs)/(id)/attest-me');
  }, [router]);

  const handleAboutIdentity = useCallback(() => {
    router.push('/(tabs)/(settings)/about-identity');
  }, [router]);

  const isNative = Platform.OS !== 'web';

  return (
    <View style={styles.screen}>
      <Screen>
        <View style={styles.hero}>
          <OxyID
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
            scanPulse={scanPulse}
            attestGlow={attestGlow}
            frontSide={
              <FrontSide
                displayName={displayName}
                username={user?.username}
                avatarUrl={avatarUrl}
                accountCreated={user?.createdAt}
                publicKeyShort={publicKeyShort}
              />
            }
            backSide={
              <BackSide
                publicKey={publicKey ?? undefined}
                displayName={displayName}
                accountCreated={user?.createdAt}
              />
            }
            qrSide={
              qrPayload ? (
                <IdQrBack payload={qrPayload} caption={t('civic.id.qrCaption')} />
              ) : (
                <View style={styles.qrPlaceholder}>
                  <ThemedText style={styles.qrPlaceholderText}>{t('civic.id.qrPending')}</ThemedText>
                </View>
              )
            }
          />
          {attestedVisible && (
            <View style={[styles.attestedBadge, { backgroundColor: colors.card }]}>
              <MaterialCommunityIcons name="check-decagram" size={18} color={colors.success} />
              <ThemedText style={styles.attestedBadgeText}>{t('civic.attest.confirmed')}</ThemedText>
            </View>
          )}
          <ThemedText style={[styles.flipHint, { color: colors.textSecondary }]}>
            {nfcState === 'emitting' ? t('civic.nfc.active') : t('civic.id.flipHint')}
          </ThemedText>
        </View>

        {/* Self-custody identity actions (native only). */}
        {isNative && (
          <Section title={t('vault.home.yourIdentity')} subtitle={t('vault.home.yourIdentitySubtitle')}>
            <GroupedList>
              <ListRow
                icon="shield-key"
                title={t('home.identity.selfCustody')}
                subtitle={t('home.identity.selfCustodySubtitle')}
                onPress={handleAboutIdentity}
                showChevron
              />
              <ListRow
                icon="key-variant"
                title={t('home.identity.publicKey')}
                subtitle={t('home.identity.publicKeySubtitle')}
                onPress={handleAboutIdentity}
                showChevron
              />
            </GroupedList>
          </Section>
        )}

        {/* Real-life attestation — A shows a QR for B to confirm they met IRL */}
        <Section title={t('civic.attest.section.title')} subtitle={t('civic.attest.section.subtitle')}>
          <GroupedList>
            <ListRow
              icon="handshake-outline"
              title={t('civic.attest.section.action')}
              subtitle={t('civic.attest.section.actionSubtitle')}
              onPress={handleAttestMe}
              showChevron
            />
          </GroupedList>
        </Section>

        {did && (
          <Section title={t('civic.id.didLabel')}>
            <ThemedText style={[styles.didValue, { color: colors.textSecondary }]} selectable numberOfLines={2}>
              {did}
            </ThemedText>
          </Section>
        )}

        {state === 'pending' && (
          <Callout tone="warning" icon="clock-outline">
            {t('civic.id.pendingNote')}
          </Callout>
        )}
      </Screen>

      {/* QR scanner is an action, not a tab — opens the root full-screen modal. */}
      <Fab
        variant="primary"
        placement="bottom-right"
        onPress={handleScan}
        accessibilityLabel={t('civic.id.scanAction')}
        icon={<MaterialCommunityIcons name="qrcode-scan" size={26} color={colors.primaryForeground} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  hero: {
    alignItems: 'center',
    gap: 16,
    paddingTop: 8,
  },
  qrPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  qrPlaceholderText: {
    fontSize: 13,
    color: '#3A3A3C',
    textAlign: 'center',
  },
  flipHint: {
    fontSize: 13,
    textAlign: 'center',
  },
  attestedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderCurve: 'continuous',
  },
  attestedBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  didValue: {
    fontSize: 13,
    lineHeight: 19,
  },
});
