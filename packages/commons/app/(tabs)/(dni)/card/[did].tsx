import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { AccountCard } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { CivicBadge } from '@/components/civic/CivicBadge';
import { useCivicCard } from '@/hooks/useCivicCard';
import { useCivicProfileState } from '@/hooks/useCivicProfileState';
import { userIdFromDid } from '@/lib/civic/did';
import {
  getVerificationMeta,
  getTrustTierMeta,
  getPersonhoodMeta,
} from '@/lib/civic/card-presentation';
import { useTranslation } from '@/lib/i18n';

/**
 * Scanned-person view — resolves and renders another citizen's signed DNI card.
 *
 * The `did` route param comes from a scanned `oxydni://card?did=…` payload; the
 * subject's `userId` is recovered from it and the signed card resolved +
 * verified client-side via `useCivicCard`. The verdict drives an explicit
 * VERIFIED ✓ / UNVERIFIED ⚠ indicator — a `verified: false` card (forged,
 * unsigned, or tampered) is surfaced as untrusted, never silently trusted.
 *
 * Offline-first: a previously-resolved card is served from cache with an
 * "offline" chip; a never-seen card while offline shows the error affordance.
 */
export default function ScannedCardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const { did } = useLocalSearchParams<{ did: string }>();

  const userId = useMemo(() => (did ? userIdFromDid(did) : null), [did]);

  const cardQuery = useCivicCard(userId);
  const { isOnline } = useCivicProfileState({ subject: 'remote' });

  const card = cardQuery.data?.card;
  const verified = cardQuery.data?.verified ?? false;

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/(dni)');
    }
  }, [router]);

  const renderBody = () => {
    // The DID could not be parsed into a user id — not a valid Oxy DNI.
    if (!userId) {
      return (
        <EmptyState
          icon="qrcode-remove"
          title={t('civic.card.error.invalidTitle')}
          body={t('civic.card.error.invalidBody')}
          colors={colors}
        />
      );
    }

    // First resolve with nothing cached yet.
    if (cardQuery.isPending && !card) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={styles.loadingText}>{t('civic.card.loading')}</ThemedText>
        </View>
      );
    }

    // Failed to resolve and we have no cached card to fall back to.
    if (cardQuery.isError && !card) {
      return (
        <EmptyState
          icon="cloud-alert"
          title={t('civic.card.error.title')}
          body={t('civic.card.error.body')}
          colors={colors}
          action={
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: colors.tint }]}
              onPress={() => cardQuery.refetch()}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          }
        />
      );
    }

    if (!card) return null;

    const verification = getVerificationMeta(verified);
    const trust = getTrustTierMeta(card.trustTier);
    const personhood = getPersonhoodMeta(card.personhoodStatus);

    return (
      <View style={styles.content}>
        {/* Trust verdict — the load-bearing indicator. */}
        <View style={styles.verdictRow}>
          <CivicBadge
            emphasis
            tone={verification.tone}
            icon={verified ? 'check-decagram' : 'alert-decagram'}
            label={t(`civic.card.${verification.labelKey}`)}
          />
        </View>
        <ThemedText style={styles.verdictDesc}>
          {t(`civic.card.${verification.labelKey}Desc`)}
        </ThemedText>

        {!isOnline && (
          <View style={styles.offlineRow}>
            <CivicBadge tone="neutral" icon="cloud-off-outline" label={t('civic.card.offline')} />
          </View>
        )}

        {/* Identity */}
        <View style={styles.identityRow}>
          {card.avatarUrl ? (
            <Image source={{ uri: card.avatarUrl }} style={styles.avatar} resizeMode="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
              <Text style={[styles.avatarInitial, { color: colors.textSecondary }]}>
                {card.name?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <View style={styles.identityText}>
            <ThemedText style={styles.name} numberOfLines={2}>
              {card.name}
            </ThemedText>
            {card.username && (
              <ThemedText style={[styles.username, { color: colors.textSecondary }]} numberOfLines={1}>
                @{card.username}
              </ThemedText>
            )}
          </View>
        </View>

        <View style={styles.badgeRow}>
          <CivicBadge
            tone={trust.tone}
            icon="shield-check"
            label={t(`civic.trustTier.${trust.labelKey}`)}
          />
          <CivicBadge
            tone={personhood.tone}
            icon="account-check-outline"
            label={t(`civic.personhood.${personhood.labelKey}`)}
          />
        </View>

        {card.verifiedDomains.length > 0 && (
          <Section title={t('civic.card.verifiedDomains')}>
            <AccountCard>
              <View style={styles.listCard}>
                {card.verifiedDomains.map((domain) => (
                  <View key={domain} style={styles.listItem}>
                    <MaterialCommunityIcons name="web-check" size={18} color={colors.success} />
                    <ThemedText style={styles.listItemText}>{domain}</ThemedText>
                  </View>
                ))}
              </View>
            </AccountCard>
          </Section>
        )}

        {card.credentialBadges.length > 0 && (
          <Section title={t('civic.card.credentials')}>
            <AccountCard>
              <View style={styles.listCard}>
                {card.credentialBadges.map((badge) => (
                  <View key={badge} style={styles.listItem}>
                    <MaterialCommunityIcons name="certificate-outline" size={18} color={colors.identityIconPublicKey} />
                    <ThemedText style={styles.listItemText}>{badge}</ThemedText>
                  </View>
                ))}
              </View>
            </AccountCard>
          </Section>
        )}

        <Section title={t('civic.card.didLabel')}>
          <ThemedText style={styles.didValue} selectable numberOfLines={2}>
            {card.did}
          </ThemedText>
        </Section>
      </View>
    );
  };

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.topBar}>
          <ThemedText style={styles.topTitle}>{t('civic.card.title')}</ThemedText>
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

interface EmptyStateProps {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  body: string;
  colors: ReturnType<typeof useColors>;
  action?: React.ReactNode;
}

function EmptyState({ icon, title, body, colors, action }: EmptyStateProps) {
  return (
    <View style={styles.centered}>
      <MaterialCommunityIcons name={icon} size={56} color={colors.textSecondary} style={styles.emptyIcon} />
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText style={[styles.emptyBody, { color: colors.textSecondary }]}>{body}</ThemedText>
      {action}
    </View>
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
  },
  verdictRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  verdictDesc: {
    fontSize: 13,
    opacity: 0.7,
    lineHeight: 19,
    marginBottom: 16,
  },
  offlineRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 28,
    fontWeight: '600',
  },
  identityText: {
    flex: 1,
    marginLeft: 16,
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
  },
  username: {
    fontSize: 15,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  listCard: {
    padding: 12,
    gap: 10,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  listItemText: {
    fontSize: 15,
  },
  didValue: {
    fontSize: 13,
    opacity: 0.85,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
    minHeight: 320,
  },
  loadingText: {
    fontSize: 15,
    opacity: 0.7,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  retryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
