import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader } from '@/components/ui';
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
 * Commons vault home.
 *
 * The landing surface once a local identity + session exist. Shows the live
 * Oxy profile (name / username / avatar fetched from the API) on a flippable
 * self-custody ID card, the identity quick-cards, and the key-management
 * actions. Account *management* (profile, devices, payments, privacy) lives in
 * the separate Accounts app — Commons deep-links there.
 */
const ACCOUNTS_DEEP_LINK = 'accounts://';
const ACCOUNTS_WEB_URL = 'https://accounts.oxy.so';

export default function VaultHomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  // Auth is guaranteed by the root `(auth)`↔`(vault)` gate — assume a session.
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
    router.push('/(vault)/about-identity');
  }, [router]);

  const handleCreateBackup = useCallback(() => {
    router.push('/(vault)/create-backup');
  }, [router]);

  const handleScanToSignIn = useCallback(() => {
    router.push('/(vault)/scan');
  }, [router]);

  const handleDeleteAccount = useCallback(() => {
    router.push('/(vault)/delete-account');
  }, [router]);

  const handleManageAccount = useCallback(() => {
    const target = Platform.OS === 'web' ? ACCOUNTS_WEB_URL : ACCOUNTS_DEEP_LINK;
    Linking.openURL(target).catch(() => {
      // Accounts app not installed / link blocked — fall back to the web app.
      if (target !== ACCOUNTS_WEB_URL) {
        Linking.openURL(ACCOUNTS_WEB_URL).catch(() => undefined);
      }
    });
  }, []);

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
          <ScreenHeader
            title={t('vault.home.title')}
            subtitle={t('vault.home.subtitle')}
          />

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

          {/* Sign in to another device (QR handoff) */}
          <Section title={t('signInApproval.scan.title')}>
            <AccountCard>
              <GroupedSection
                items={[
                  {
                    id: 'scan-sign-in',
                    icon: 'qrcode-scan',
                    iconColor: colors.tint,
                    title: t('signInApproval.scan.title'),
                    subtitle: t('signInApproval.scan.subtitle'),
                    onPress: handleScanToSignIn,
                    showChevron: true,
                  },
                ]}
              />
            </AccountCard>
          </Section>

          {/* Key-management actions */}
          <Section title={t('vault.home.manageKeys')}>
            <AccountCard>
              <GroupedSection
                items={[
                  {
                    id: 'about-identity',
                    icon: 'shield-key',
                    iconColor: colors.identityIconSelfCustody,
                    title: t('vault.home.actions.aboutIdentity'),
                    subtitle: t('vault.home.actions.aboutIdentitySubtitle'),
                    onPress: handleAboutIdentity,
                    showChevron: true,
                  },
                  {
                    id: 'create-backup',
                    icon: 'file-export',
                    iconColor: colors.iconWarning,
                    title: t('vault.home.actions.createBackup'),
                    subtitle: t('vault.home.actions.createBackupSubtitle'),
                    onPress: handleCreateBackup,
                    showChevron: true,
                  },
                ]}
              />
            </AccountCard>
          </Section>

          {/* Account management lives in the Accounts app */}
          <Section title={t('vault.home.account')}>
            <ThemedText style={styles.subtitle}>{t('vault.home.accountSubtitle')}</ThemedText>
            <AccountCard>
              <GroupedSection
                items={[
                  {
                    id: 'manage-account',
                    icon: 'account-cog',
                    iconColor: colors.tint,
                    title: t('vault.home.actions.manageAccount'),
                    subtitle: t('vault.home.actions.manageAccountSubtitle'),
                    onPress: handleManageAccount,
                    showChevron: true,
                  },
                  {
                    id: 'delete-account',
                    icon: 'delete-outline',
                    iconColor: colors.error,
                    title: t('vault.home.actions.deleteAccount'),
                    subtitle: t('vault.home.actions.deleteAccountSubtitle'),
                    onPress: handleDeleteAccount,
                    showChevron: true,
                  },
                ]}
              />
            </AccountCard>
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
