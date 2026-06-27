import React, { useCallback } from 'react';
import { View, StyleSheet, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useTranslation } from '@/lib/i18n';

/**
 * Settings tab — identity & vault management.
 *
 * Owns the key-management and account actions that used to live on the vault
 * home: about your identity, create an encrypted backup, manage your account
 * (deep-links to the Accounts app), and delete your account. The detail screens
 * are pushed within this tab's stack.
 */
const ACCOUNTS_DEEP_LINK = 'accounts://';
const ACCOUNTS_WEB_URL = 'https://accounts.oxy.so';

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();

  const handleAboutIdentity = useCallback(() => {
    router.push('/(tabs)/(settings)/about-identity');
  }, [router]);

  const handleCreateBackup = useCallback(() => {
    router.push('/(tabs)/(settings)/create-backup');
  }, [router]);

  const handlePersonhood = useCallback(() => {
    router.push('/(tabs)/(settings)/personhood');
  }, [router]);

  const handleDeleteAccount = useCallback(() => {
    router.push('/(tabs)/(settings)/delete-account');
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

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <ScreenHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

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

          {/* Proof of personhood — Fase 3 trust surface */}
          <Section title={t('civic.personhood.settingsSection')}>
            <AccountCard>
              <GroupedSection
                items={[
                  {
                    id: 'personhood',
                    icon: 'account-check',
                    iconColor: colors.identityIconSelfCustody,
                    title: t('civic.personhood.settingsEntry'),
                    subtitle: t('civic.personhood.settingsEntrySubtitle'),
                    onPress: handlePersonhood,
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
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 12,
  },
});
