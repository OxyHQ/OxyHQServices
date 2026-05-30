import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Share,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader, Button, ImportantBanner } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy } from '@oxyhq/services';
import { alert, toast } from '@oxyhq/bloom';
import { KeyManager } from '@oxyhq/core';
import { useIdentity } from '@/hooks/useIdentity';
import { useAvatarUrl } from '@/hooks/useAvatarUrl';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import * as Print from 'expo-print';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDisplayName } from '@/utils/date-utils';
import { IdentityCard } from '@/components/identity';
import { useTranslation } from '@/lib/i18n';

export default function AboutIdentityScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  // Auth is enforced by the `(tabs)` layout — assume a session here.
  const { user, isLoading: oxyLoading, oxyServices, showBottomSheet } = useOxy();
  const { getPublicKey } = useIdentity();

  const displayName = useMemo(() => getDisplayName(user), [user]);
  const avatarUrl = useAvatarUrl(user);

  const handleEditName = useCallback(() => {
    showBottomSheet?.({
      screen: 'EditProfileField',
      props: { fieldType: 'displayName' }
    });
  }, [showBottomSheet]);

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSavingExpiration, setIsSavingExpiration] = useState(false);
  const [exportHistory, setExportHistory] = useState<{ timestamp: string; date: string }[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  const formatRelativeTime = useRelativeTime();


  useEffect(() => {
    const loadPublicKey = async () => {
      try {
        if (getPublicKey) {
          const pk = await getPublicKey();
          setPublicKey(pk);
        }
      } catch (err) {
        console.error('Failed to get public key:', err);
      } finally {
        setLoading(false);
      }
    };

    loadPublicKey();
  }, [getPublicKey]);

  // Load export history
  useEffect(() => {
    const loadExportHistory = async () => {
      try {
        const historyKey = 'oxy_private_key_export_history';
        const stored = await AsyncStorage.getItem(historyKey);
        if (stored) {
          const parsed = JSON.parse(stored);
          setExportHistory(parsed);
        } else {
          setExportHistory([]);
        }
      } catch (error) {
        console.error('Failed to load export history:', error);
        setExportHistory([]);
      }
    };

    loadExportHistory();
  }, []);

  const handleCopyPublicKey = useCallback(async () => {
    if (!publicKey) return;

    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(publicKey);
        toast.success(t('aboutIdentity.publicKeyCopied'));
      } catch {
        toast.error(t('aboutIdentity.copyFailed'));
      }
    } else {
      try {
        await Share.share({ message: publicKey });
      } catch {
        // Cancelled - don't show error
      }
    }
  }, [publicKey, t]);

  // Format expiration setting for display
  const formatExpirationSetting = useCallback((days: number | null | undefined): string => {
    if (!days || days === null) return t('aboutIdentity.expiration.never');
    if (days === 365) return t('aboutIdentity.expiration.oneYear');
    return t('aboutIdentity.expiration.days', { count: days });
  }, [t]);

  // Get current expiration setting
  const currentExpirationDays = user?.accountExpiresAfterInactivityDays ?? null;

  // Handle expiration setting change
  const handleExpirationChange = useCallback(async (selectedDays: number | null) => {
    if (!oxyServices || !user) return;

    try {
      setIsSavingExpiration(true);
      await oxyServices.updateProfile({ accountExpiresAfterInactivityDays: selectedDays });
      // User object from useOxy should update automatically via the context
      toast.success(t('aboutIdentity.expirationUpdated'));
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : t('aboutIdentity.expirationUpdateFailed');
      toast.error(message);
    } finally {
      setIsSavingExpiration(false);
    }
  }, [oxyServices, user, t]);

  // Show expiration selection dialog
  const showExpirationPicker = useCallback(() => {
    const options = [
      { label: t('aboutIdentity.expirationPicker.days30'), value: 30 },
      { label: t('aboutIdentity.expirationPicker.days90'), value: 90 },
      { label: t('aboutIdentity.expirationPicker.days180'), value: 180 },
      { label: t('aboutIdentity.expirationPicker.oneYear'), value: 365 },
      { label: t('aboutIdentity.expirationPicker.never'), value: null },
    ];

    alert(
      t('aboutIdentity.expirationPicker.title'),
      t('aboutIdentity.expirationPicker.message'),
      [
        ...options.map(option => ({
          text: option.label,
          onPress: () => handleExpirationChange(option.value),
        })),
        { text: t('common.cancel'), style: 'cancel' },
      ]
    );
  }, [handleExpirationChange, t]);

  // Save export history
  const saveExportHistory = useCallback(async (timestamp: string) => {
    try {
      const historyKey = 'oxy_private_key_export_history';
      const newEntry = {
        timestamp,
        date: new Date(timestamp).toLocaleString(),
      };
      const updatedHistory = [newEntry, ...exportHistory].slice(0, 50); // Keep last 50 exports
      await AsyncStorage.setItem(historyKey, JSON.stringify(updatedHistory));
      setExportHistory(updatedHistory);
    } catch (error) {
      console.error('Failed to save export history:', error);
    }
  }, [exportHistory]);

  // Export private key using expo-print
  const handleExportPrivateKey = useCallback(async () => {
    alert(
      t('aboutIdentity.securityWarning.title'),
      t('aboutIdentity.securityWarning.message'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('aboutIdentity.securityWarning.continue'),
          style: 'destructive',
          onPress: async () => {
            try {
              setIsExporting(true);

              // Get private key
              const privateKey = await KeyManager.getPrivateKey();
              if (!privateKey) {
                toast.error(t('aboutIdentity.export.noPrivateKey'));
                return;
              }

              // Get public key for reference
              const pk = publicKey || await KeyManager.getPublicKey() || 'Unknown';

              // Create HTML for printing
              const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
    <style>
      @page {
        margin: 20mm;
      }
      body {
        font-family: 'Courier New', monospace;
        padding: 20px;
        line-height: 1.6;
        color: #000;
      }
      .header {
        text-align: center;
        border-bottom: 2px solid #000;
        padding-bottom: 20px;
        margin-bottom: 30px;
      }
      .header h1 {
        margin: 0;
        font-size: 24px;
        font-weight: bold;
      }
      .warning {
        background-color: #fff3cd;
        border: 2px solid #ffc107;
        border-radius: 8px;
        padding: 15px;
        margin: 20px 0;
      }
      .warning-title {
        font-weight: bold;
        font-size: 16px;
        margin-bottom: 10px;
        color: #856404;
      }
      .key-section {
        margin: 30px 0;
        padding: 20px;
        background-color: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 8px;
      }
      .key-label {
        font-weight: bold;
        font-size: 14px;
        margin-bottom: 10px;
        color: #495057;
      }
      .key-value {
        font-family: 'Courier New', monospace;
        font-size: 12px;
        word-break: break-all;
        background-color: #fff;
        padding: 15px;
        border: 1px solid #ced4da;
        border-radius: 4px;
        margin-top: 10px;
      }
      .info-section {
        margin-top: 30px;
        padding: 15px;
        background-color: #e7f3ff;
        border-left: 4px solid #0066cc;
      }
      .info-title {
        font-weight: bold;
        margin-bottom: 10px;
      }
      .footer {
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #dee2e6;
        text-align: center;
        font-size: 12px;
        color: #6c757d;
      }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>${t('aboutIdentity.print.documentTitle')}</h1>
      <p>${t('aboutIdentity.print.generated', { date: new Date().toLocaleString() })}</p>
    </div>

    <div class="warning">
      <div class="warning-title">⚠️ ${t('aboutIdentity.print.warningTitle')}</div>
      <p>${t('aboutIdentity.print.warningBody')}</p>
    </div>

    <div class="key-section">
      <div class="key-label">${t('aboutIdentity.print.publicKeyLabel')}</div>
      <div class="key-value">${pk}</div>
    </div>

    <div class="key-section">
      <div class="key-label">${t('aboutIdentity.print.privateKeyLabel')}</div>
      <div class="key-value">${privateKey}</div>
    </div>

    <div class="info-section">
      <div class="info-title">${t('aboutIdentity.print.infoTitle')}</div>
      <ul>
        <li>${t('aboutIdentity.print.info1')}</li>
        <li>${t('aboutIdentity.print.info2')}</li>
        <li>${t('aboutIdentity.print.info3')}</li>
        <li>${t('aboutIdentity.print.info4')}</li>
        <li>${t('aboutIdentity.print.info5')}</li>
      </ul>
    </div>

    <div class="footer">
      <p>${t('aboutIdentity.print.footerLine1')}</p>
      <p>${t('aboutIdentity.print.footerLine2')}</p>
    </div>
  </body>
</html>
              `;

              // Print the HTML
              await Print.printAsync({ html });

              // Save to export history
              const timestamp = new Date().toISOString();
              await saveExportHistory(timestamp);

              // Log security event for private key export
              if (oxyServices) {
                try {
                  await oxyServices.logPrivateKeyExported();
                } catch (error) {
                  // Log error but don't fail the export
                  console.error('Failed to log security event:', error);
                }
              }

              toast.success(t('aboutIdentity.export.sentToPrinter'));
            } catch (error: unknown) {
              const message = error instanceof Error
                ? error.message
                : t('aboutIdentity.export.failed');
              toast.error(message);
            } finally {
              setIsExporting(false);
            }
          },
        },
      ]
    );
  }, [publicKey, saveExportHistory, t]);

  // Self-custody features
  const selfCustodyItems = useMemo(() => [
    {
      id: 'private-key',
      icon: 'key-variant',
      iconColor: colors.iconSuccess,
      title: t('aboutIdentity.items.privateKeyTitle'),
      subtitle: t('aboutIdentity.items.privateKeySubtitle'),
    },
    {
      id: 'no-password',
      icon: 'lock-off-outline',
      iconColor: colors.iconInfo,
      title: t('aboutIdentity.items.noPasswordTitle'),
      subtitle: t('aboutIdentity.items.noPasswordSubtitle'),
    },
    {
      id: 'recovery',
      icon: 'text-box-outline',
      iconColor: colors.iconWarning,
      title: t('aboutIdentity.items.recoveryTitle'),
      subtitle: t('aboutIdentity.items.recoverySubtitle'),
    },
    {
      id: 'decentralized',
      icon: 'web',
      iconColor: colors.identityIconPublicKey,
      title: t('aboutIdentity.items.decentralizedTitle'),
      subtitle: t('aboutIdentity.items.decentralizedSubtitle'),
    },
  ], [colors.iconSuccess, colors.iconInfo, colors.iconWarning, colors.identityIconPublicKey, t]);


  if (oxyLoading || loading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('aboutIdentity.loading')}</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <ScreenHeader
            title={t('aboutIdentity.title')}
            subtitle={t('aboutIdentity.subtitle')}
          />

          {/* ID Card */}
          <Section title={t('aboutIdentity.idCard')}>
            <View style={styles.idCardContainer}>
              <IdentityCard
                displayName={displayName}
                username={user?.username}
                avatarUrl={avatarUrl}
                accountCreated={user?.createdAt}
                publicKey={publicKey || undefined}
              />
            </View>
            {publicKey && (
              <Button
                variant="secondary"
                onPress={handleCopyPublicKey}
                style={styles.copyPublicKeyButton}
              >
                {t('aboutIdentity.copyPublicKey')}
              </Button>
            )}
          </Section>

          {/* Important Notice */}
          <ImportantBanner>
            {t('aboutIdentity.importantNotice')}
          </ImportantBanner>

          {/* Self-Custody Identity */}
          <Section title={t('aboutIdentity.selfCustodyTitle')}>
            <ThemedText style={styles.sectionDescription}>
              {t('aboutIdentity.selfCustodyDescription')}
            </ThemedText>
            <AccountCard>
              <GroupedSection items={selfCustodyItems} />
            </AccountCard>
          </Section>

          {/* Security Actions */}
          <Section title={t('aboutIdentity.securityActions')}>
            <AccountCard>
              <GroupedSection
                items={[
                  {
                    id: 'create-backup',
                    icon: 'file-export',
                    iconColor: colors.iconWarning,
                    title: t('aboutIdentity.createBackupTitle'),
                    subtitle: t('aboutIdentity.createBackupSubtitle'),
                    onPress: () => router.push('/(tabs)/create-backup'),
                    showChevron: true,
                  },
                  {
                    id: 'export-private-key',
                    icon: 'printer',
                    iconColor: colors.identityIconPublicKey,
                    title: t('aboutIdentity.exportKeyTitle'),
                    subtitle: isExporting
                      ? t('aboutIdentity.exporting')
                      : exportHistory.length > 0
                        ? t('aboutIdentity.lastExported', { time: formatRelativeTime(exportHistory[0]?.timestamp) })
                        : t('aboutIdentity.exportKeySubtitle'),
                    onPress: handleExportPrivateKey,
                    showChevron: true,
                    disabled: isExporting,
                    customContent: isExporting ? (
                      <ActivityIndicator size="small" color={colors.identityIconPublicKey} />
                    ) : undefined,
                  },
                ]}
              />
            </AccountCard>
          </Section>

          {/* Account Settings */}
          <Section title={t('aboutIdentity.accountSettings')}>
            <ThemedText style={styles.sectionDescription}>
              {t('aboutIdentity.accountSettingsDescription')}
            </ThemedText>
            <AccountCard>
              <GroupedSection
                items={[
                  {
                    id: 'account-expiration',
                    icon: 'clock-outline',
                    iconColor: colors.tint,
                    title: t('aboutIdentity.accountExpiration'),
                    subtitle: formatExpirationSetting(currentExpirationDays),
                    onPress: isSavingExpiration ? undefined : showExpirationPicker,
                    showChevron: !isSavingExpiration,
                    disabled: isSavingExpiration,
                    customContent: isSavingExpiration ? (
                      <ActivityIndicator size="small" color={colors.tint} />
                    ) : undefined,
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
  idCardContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'stretch',
  } as const,
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 120,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    opacity: 0.7,
  },
  copyPublicKeyButton: {
    marginTop: 16,
  },
  sectionDescription: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 12,
    lineHeight: 20,
  },
});
