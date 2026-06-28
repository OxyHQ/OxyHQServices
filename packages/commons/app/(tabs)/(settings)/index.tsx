import React, { useCallback } from 'react';
import { Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, StackHeader, Section, GroupedList, ListRow } from '@/components/ui';
import { useTranslation } from '@/lib/i18n';

/**
 * Settings tab — identity & vault management.
 *
 * Owns the key-management and account actions that used to live on the vault
 * home: about your identity, create an encrypted backup, manage your account
 * (deep-links to the Accounts app), and delete your account. The detail screens
 * are pushed within this tab's stack. Flat, hairline-separated rows — no cards.
 */
const ACCOUNTS_DEEP_LINK = 'accounts://';
const ACCOUNTS_WEB_URL = 'https://accounts.oxy.so';

export default function SettingsScreen() {
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

  const handleCredentials = useCallback(() => {
    router.push('/(tabs)/(settings)/credentials');
  }, [router]);

  const handleNode = useCallback(() => {
    router.push('/(tabs)/(settings)/node');
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
    <Screen>
      <StackHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {/* Key-management actions */}
      <Section title={t('vault.home.manageKeys')}>
        <GroupedList>
          <ListRow
            icon="shield-key"
            title={t('vault.home.actions.aboutIdentity')}
            subtitle={t('vault.home.actions.aboutIdentitySubtitle')}
            onPress={handleAboutIdentity}
            showChevron
          />
          <ListRow
            icon="file-export"
            title={t('vault.home.actions.createBackup')}
            subtitle={t('vault.home.actions.createBackupSubtitle')}
            onPress={handleCreateBackup}
            showChevron
          />
        </GroupedList>
      </Section>

      {/* Trust & verification — Fase 3 personhood + Fase 4 credentials */}
      <Section title={t('civic.personhood.settingsSection')}>
        <GroupedList>
          <ListRow
            icon="account-check"
            title={t('civic.personhood.settingsEntry')}
            subtitle={t('civic.personhood.settingsEntrySubtitle')}
            onPress={handlePersonhood}
            showChevron
          />
          <ListRow
            icon="certificate"
            title={t('civic.credentials.settingsEntry')}
            subtitle={t('civic.credentials.settingsEntrySubtitle')}
            onPress={handleCredentials}
            showChevron
          />
          <ListRow
            icon="server-network"
            title={t('civic.nodes.settingsEntry')}
            subtitle={t('civic.nodes.settingsEntrySubtitle')}
            onPress={handleNode}
            showChevron
          />
        </GroupedList>
      </Section>

      {/* Account management lives in the Accounts app */}
      <Section title={t('vault.home.account')} subtitle={t('vault.home.accountSubtitle')}>
        <GroupedList>
          <ListRow
            icon="account-cog"
            title={t('vault.home.actions.manageAccount')}
            subtitle={t('vault.home.actions.manageAccountSubtitle')}
            onPress={handleManageAccount}
            showChevron
          />
          <ListRow
            icon="delete-outline"
            title={t('vault.home.actions.deleteAccount')}
            subtitle={t('vault.home.actions.deleteAccountSubtitle')}
            onPress={handleDeleteAccount}
            showChevron
            destructive
          />
        </GroupedList>
      </Section>
    </Screen>
  );
}
