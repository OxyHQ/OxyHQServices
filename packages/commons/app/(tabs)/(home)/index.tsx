import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { IdentityCard } from '@/components/identity';
import { IdentityCardsSection } from '@/components/identity-cards-section';
import { useIdentityCards } from '@/hooks/home/useIdentityCards';
import { useOxy, useCurrentUser } from '@oxyhq/services';
import { useIdentity } from '@/hooks/useIdentity';
import { useAvatarUrl } from '@/hooks/useAvatarUrl';
import { getDisplayName } from '@/utils/date-utils';
import { useTranslation } from '@/lib/i18n';

/**
 * Home tab — identity overview.
 *
 * The landing surface once a local identity + session exist: the live Oxy
 * profile (name / username / avatar) on the flippable self-custody ID card,
 * plus the identity quick-cards. The DNI, scanner, reputation and management
 * surfaces each live in their own tab now, so the home stays a clean overview;
 * the quick-cards deep-link into the Settings tab's "about your identity"
 * detail screen.
 */
export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  // Auth is guaranteed by the root `(auth)`↔`(tabs)` gate — assume a session.
  const { user, isLoading: oxyLoading } = useOxy();
  // Hydrate the user record from the server (createdAt + fields missing from a
  // cached signIn response). OxyContext picks up the fresh record from cache.
  useCurrentUser();
  const { getPublicKey } = useIdentity();

  const displayName = useMemo(() => getDisplayName(user), [user]);
  const avatarUrl = useAvatarUrl(user);

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadPublicKey = async () => {
      try {
        const pk = await getPublicKey();
        if (!cancelled) setPublicKey(pk);
      } catch (error) {
        console.error('Failed to get public key:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadPublicKey();
    return () => {
      cancelled = true;
    };
  }, [getPublicKey]);

  const handleAboutIdentity = useCallback(() => {
    router.push('/(tabs)/(settings)/about-identity');
  }, [router]);

  const identityCards = useIdentityCards(handleAboutIdentity);

  if (oxyLoading || loading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('common.loadingShort')}</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <ScreenHeader title={t('vault.home.title')} subtitle={t('vault.home.subtitle')} />

          {/* Live Oxy profile on the self-custody ID card */}
          <Section title={t('vault.home.identityCard')}>
            <View style={styles.idCardContainer}>
              <IdentityCard
                displayName={displayName}
                username={user?.username}
                avatarUrl={avatarUrl}
                accountCreated={user?.createdAt}
                publicKey={publicKey || undefined}
              />
            </View>
          </Section>

          {/* Identity quick-cards (self-custody / public key) */}
          <Section title={t('vault.home.yourIdentity')}>
            <ThemedText style={styles.subtitle}>{t('vault.home.yourIdentitySubtitle')}</ThemedText>
            <IdentityCardsSection cards={identityCards} />
          </Section>
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
  idCardContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'stretch',
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    opacity: 0.7,
  },
});
