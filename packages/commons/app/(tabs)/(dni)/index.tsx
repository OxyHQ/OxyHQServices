import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useOxy, useCurrentUser } from '@oxyhq/services';
import { buildUserDid } from '@oxyhq/core';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { Ticket as OxyID } from '@/components/OxyID';
import { FrontSide } from '@/components/OxyID/front-side';
import { DniQrBack } from '@/components/civic/DniQrBack';
import { CivicBadge } from '@/components/civic/CivicBadge';
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
 * The citizen DNI card.
 *
 * The FRONT reuses the OxyID flippable holographic card (identity: name,
 * @username, public-key ID, trust-tier badge). The BACK renders a QR of
 * `oxyServices.getMyDniPayload()` — the DID-only payload a counterpart scans to
 * resolve and verify the signed card server-side.
 *
 * Offline-first: the card front (identity + key + QR) is ALWAYS rendered from
 * the LOCAL identity and never gated on the network. `useCivicProfileState`
 * surfaces a `pending` note (no server account yet) or an `offline` chip
 * (cache-first); the live trust tier is hydrated cache-first from the signed
 * public card.
 */
export default function DniScreen() {
  const colors = useColors();
  const { t } = useTranslation();
  const { user, oxyServices } = useOxy();
  // Hydrate the user record (createdAt + fields missing from a cached signIn).
  useCurrentUser();
  const { getPublicKey, identitySyncState } = useIdentity();

  const { state, isOnline } = useCivicProfileState({
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
        console.error('[DniScreen] Failed to load public key', error);
      });
    return () => {
      cancelled = true;
    };
  }, [getPublicKey]);

  const userId = user?.id ?? oxyServices?.getCurrentUserId() ?? null;
  const did = useMemo(() => (userId ? buildUserDid(userId) : null), [userId]);

  // The DNI QR payload (DID-only). Requires an authenticated session; guarded so
  // a transient "no user id" never throws through render.
  const qrPayload = useMemo(() => {
    if (!oxyServices) return null;
    try {
      return oxyServices.getMyDniPayload();
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

  const renderStateChip = useCallback(() => {
    if (state === 'pending') {
      return <CivicBadge tone="caution" icon="progress-clock" label={t('civic.dni.state.pending')} />;
    }
    if (state === 'cache-first' || !isOnline) {
      return <CivicBadge tone="neutral" icon="cloud-off-outline" label={t('civic.dni.state.offline')} />;
    }
    return <CivicBadge tone="positive" icon="check-decagram" label={t('civic.dni.state.live')} />;
  }, [state, isOnline, t]);

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <ScreenHeader title={t('civic.dni.title')} subtitle={t('civic.dni.subtitle')} />

          <View style={styles.chipRow}>{renderStateChip()}</View>

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
                  <DniQrBack payload={qrPayload} caption={t('civic.dni.qrCaption')} />
                ) : (
                  <View style={styles.qrPlaceholder}>
                    <ThemedText style={styles.qrPlaceholderText}>
                      {t('civic.dni.qrPending')}
                    </ThemedText>
                  </View>
                )
              }
            />
          </View>

          <ThemedText style={styles.flipHint}>{t('civic.dni.flipHint')}</ThemedText>

          {did && (
            <Section title={t('civic.dni.didLabel')}>
              <ThemedText style={styles.didValue} selectable numberOfLines={2}>
                {did}
              </ThemedText>
            </Section>
          )}

          {state === 'pending' && (
            <ThemedText style={[styles.pendingNote, { color: colors.warning }]}>
              {t('civic.dni.pendingNote')}
            </ThemedText>
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
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  chipRow: {
    flexDirection: 'row',
    marginBottom: 16,
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
