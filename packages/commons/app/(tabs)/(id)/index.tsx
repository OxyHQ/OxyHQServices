import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useOxy, useCurrentUser } from '@oxyhq/services';
import { buildUserDid } from '@oxyhq/core';
import { Fab } from '@oxyhq/bloom/fab';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { Ticket as OxyID } from '@/components/OxyID';
import { FrontSide } from '@/components/OxyID/front-side';
import { IdQrBack } from '@/components/civic/IdQrBack';
import { CivicBadge } from '@/components/civic/CivicBadge';
import { IdentityCardsSection } from '@/components/identity-cards-section';
import { useIdentityCards } from '@/hooks/home/useIdentityCards';
import { useIdentity } from '@/hooks/useIdentity';
import { useAvatarUrl } from '@/hooks/useAvatarUrl';
import { useCivicProfileState } from '@/hooks/useCivicProfileState';
import { useCivicCard } from '@/hooks/useCivicCard';
import { getTrustTierMeta } from '@/lib/civic/card-presentation';
import { getDisplayName } from '@/utils/date-utils';
import { useTranslation } from '@/lib/i18n';

const CARD_WIDTH = 340;
const CARD_HEIGHT = 214;

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
 *   - Below the card: the self-custody identity quick-cards (the home hub
 *     actions, deep-linking into the Settings "about your identity" detail), the
 *     real-life attestation entry, and the raw DID.
 *   - A Bloom FAB (bottom-right) opens the QR scanner, which lives at the root as
 *     a full-screen modal (`app/(scan)`) so its camera covers the tab bar.
 *
 * No in-screen title/subtitle/status chip: the tab bar already labels this "ID"
 * and the card stands on its own. `useCivicProfileState` stays wired (it tracks
 * the cache-first vs live state of the signed card and the not-yet-registered
 * `pending` case) — only its visible status chip was dropped.
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

  // Live trust tier from the signed public card (cache-first).
  const cardQuery = useCivicCard(userId);
  const trustTier = cardQuery.data?.card.trustTier;

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

  const identityCards = useIdentityCards(handleAboutIdentity);

  return (
    <View style={styles.screen}>
      <ScreenContentWrapper>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={styles.content}>
            <View style={styles.cardContainer}>
              <OxyID
                width={CARD_WIDTH}
                height={CARD_HEIGHT}
                frontSide={
                  <View style={StyleSheet.absoluteFill}>
                    <FrontSide
                      displayName={displayName}
                      username={user?.username}
                      avatarUrl={avatarUrl}
                      accountCreated={user?.createdAt}
                      publicKeyShort={publicKeyShort}
                    />
                    {trustTier && (
                      <View style={styles.cardBadgeOverlay} pointerEvents="none">
                        <CivicBadge
                          tone={getTrustTierMeta(trustTier).tone}
                          icon="shield-check"
                          label={t(`civic.trustTier.${trustTier}`)}
                        />
                      </View>
                    )}
                  </View>
                }
                backSide={
                  qrPayload ? (
                    <IdQrBack payload={qrPayload} caption={t('civic.id.qrCaption')} />
                  ) : (
                    <View style={styles.qrPlaceholder}>
                      <ThemedText style={styles.qrPlaceholderText}>
                        {t('civic.id.qrPending')}
                      </ThemedText>
                    </View>
                  )
                }
              />
            </View>

            <ThemedText style={styles.flipHint}>{t('civic.id.flipHint')}</ThemedText>

            {/* Self-custody identity quick-cards (the home hub actions) */}
            <Section title={t('vault.home.yourIdentity')}>
              <ThemedText style={styles.sectionSubtitle}>{t('vault.home.yourIdentitySubtitle')}</ThemedText>
              <IdentityCardsSection cards={identityCards} />
            </Section>

            {/* Real-life attestation — A shows a QR for B to confirm they met IRL */}
            <Section title={t('civic.attest.section.title')}>
              <ThemedText style={styles.sectionSubtitle}>{t('civic.attest.section.subtitle')}</ThemedText>
              <AccountCard>
                <GroupedSection
                  items={[
                    {
                      id: 'attest-me',
                      icon: 'handshake-outline',
                      iconColor: colors.identityIconSelfCustody,
                      title: t('civic.attest.section.action'),
                      subtitle: t('civic.attest.section.actionSubtitle'),
                      onPress: handleAttestMe,
                      showChevron: true,
                    },
                  ]}
                />
              </AccountCard>
            </Section>

            {did && (
              <Section title={t('civic.id.didLabel')}>
                <ThemedText style={styles.didValue} selectable numberOfLines={2}>
                  {did}
                </ThemedText>
              </Section>
            )}

            {state === 'pending' && (
              <ThemedText style={[styles.pendingNote, { color: colors.warning }]}>
                {t('civic.id.pendingNote')}
              </ThemedText>
            )}
          </View>
        </View>
      </ScreenContentWrapper>

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
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  sectionSubtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 12,
  },
  cardContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  cardBadgeOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
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
    opacity: 0.6,
    textAlign: 'center',
    marginBottom: 16,
  },
  didValue: {
    fontSize: 13,
    opacity: 0.85,
  },
  pendingNote: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
});
