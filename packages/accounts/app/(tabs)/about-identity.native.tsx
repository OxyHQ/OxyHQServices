import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Share,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccountCard, ScreenHeader, useAlert, Button, ImportantBanner } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useOxy, KeyManager } from '@oxyhq/services';
import { useIdentity } from '@/hooks/useIdentity';
import * as Print from 'expo-print';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatDate, getDisplayName } from '@/utils/date-utils';
import { IdentityCard } from '@/components/identity';

export default function AboutIdentityScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const router = useRouter();
  const alert = useAlert();
  const { user, isAuthenticated, isLoading: oxyLoading, oxyServices, showBottomSheet } = useOxy();
  const { getPublicKey } = useIdentity();

  const displayName = useMemo(() => getDisplayName(user), [user]);
  const avatarUrl = useMemo(() => {
    if (user?.avatar && oxyServices) {
      return oxyServices.getFileDownloadUrl(user.avatar, 'thumb');
    }
    return undefined;
  }, [user?.avatar, oxyServices]);

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

  // Format relative time for dates (matching security screen)
  const formatRelativeTime = useCallback((dateString?: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return formatDate(dateString);
  }, []);


  useEffect(() => {
    const loadPublicKey = async () => {
      try {
        if (isAuthenticated && getPublicKey) {
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
  }, [isAuthenticated, getPublicKey]);

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

    if (isAuthenticated) {
      loadExportHistory();
    }
  }, [isAuthenticated]);

  const handleCopyPublicKey = useCallback(async () => {
    if (!publicKey) return;

    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(publicKey);
        alert('Copied', 'Public key copied to clipboard');
      } catch {
        alert('Error', 'Failed to copy');
      }
    } else {
      try {
        await Share.share({ message: publicKey });
      } catch {
        // Cancelled - don't show error
      }
    }
  }, [publicKey, alert]);

  // Format expiration setting for display
  const formatExpirationSetting = useCallback((days: number | null | undefined): string => {
    if (!days || days === null) return 'Never expires';
    if (days === 30) return '30 days';
    if (days === 90) return '90 days';
    if (days === 180) return '180 days';
    if (days === 365) return '1 year';
    return `${days} days`;
  }, []);

  // Get current expiration setting
  const currentExpirationDays = user?.accountExpiresAfterInactivityDays ?? null;

  // Handle expiration setting change
  const handleExpirationChange = useCallback(async (selectedDays: number | null) => {
    if (!oxyServices || !user) return;

    try {
      setIsSavingExpiration(true);
      await oxyServices.updateProfile({ accountExpiresAfterInactivityDays: selectedDays });
      // User object from useOxy should update automatically via the context
      alert('Success', 'Account expiration setting updated successfully');
    } catch (error: any) {
      console.error('Failed to update expiration setting:', error);
      alert('Error', error?.message || 'Failed to update account expiration setting. Please try again.');
    } finally {
      setIsSavingExpiration(false);
    }
  }, [oxyServices, user, alert]);

  // Show expiration selection dialog
  const showExpirationPicker = useCallback(() => {
    const options = [
      { label: '30 days', value: 30 },
      { label: '90 days', value: 90 },
      { label: '180 days', value: 180 },
      { label: '1 year', value: 365 },
      { label: 'Never', value: null },
    ];

    alert(
      'Account Expiration',
      'Choose when your account expires after inactivity',
      [
        ...options.map(option => ({
          text: option.label,
          onPress: () => handleExpirationChange(option.value),
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [handleExpirationChange, alert]);

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
      'Security Warning',
      'Exporting your private key will print it on paper. Anyone with access to this printed key can control your identity. Make sure you are in a secure location and will store the printed document safely.\n\nDo you want to continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsExporting(true);

              // Get private key
              const privateKey = await KeyManager.getPrivateKey();
              if (!privateKey) {
                alert('Error', 'No private key found on this device');
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
      <h1>Oxy Identity - Private Key Export</h1>
      <p>Generated: ${new Date().toLocaleString()}</p>
    </div>

    <div class="warning">
      <div class="warning-title">⚠️ SECURITY WARNING</div>
      <p>This document contains your private key. Anyone with access to this key can control your identity. Store this document in a secure location, such as a safe or safety deposit box. Never share this key with anyone.</p>
    </div>

    <div class="key-section">
      <div class="key-label">Public Key (Your Identity):</div>
      <div class="key-value">${pk}</div>
    </div>

    <div class="key-section">
      <div class="key-label">Private Key (KEEP SECRET):</div>
      <div class="key-value">${privateKey}</div>
    </div>

    <div class="info-section">
      <div class="info-title">Important Information:</div>
      <ul>
        <li>This private key is used to sign transactions and prove your identity</li>
        <li>If you lose this key and your recovery phrase, you will permanently lose access to your identity</li>
        <li>Do not store this document digitally (screenshots, cloud storage, etc.)</li>
        <li>Consider storing multiple copies in different secure locations</li>
        <li>If this key is compromised, you should immediately create a new identity</li>
      </ul>
    </div>

    <div class="footer">
      <p>Oxy Identity - Self-Custody Cryptographic Identity</p>
      <p>This document was generated by the Oxy Accounts app</p>
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

              alert('Success', 'Private key has been sent to printer');
            } catch (error: any) {
              console.error('Failed to export private key:', error);
              alert('Error', error?.message || 'Failed to export private key. Please try again.');
            } finally {
              setIsExporting(false);
            }
          },
        },
      ]
    );
  }, [publicKey, saveExportHistory, alert]);

  // Self-custody features
  const selfCustodyItems = useMemo(() => [
    {
      id: 'private-key',
      icon: 'key-variant',
      iconColor: '#10B981',
      title: 'Private Key Stored Locally',
      subtitle: 'Your private key is encrypted and stored securely on this device. It never leaves your device.',
    },
    {
      id: 'no-password',
      icon: 'lock-off-outline',
      iconColor: '#3B82F6',
      title: 'No Passwords',
      subtitle: 'You sign in using cryptographic proof, not passwords that can be guessed or stolen.',
    },
    {
      id: 'recovery',
      icon: 'text-box-outline',
      iconColor: '#F59E0B',
      title: 'Recovery Phrase Backup',
      subtitle: 'Your 12-word recovery phrase is the only way to restore your identity on a new device.',
    },
    {
      id: 'decentralized',
      icon: 'web',
      iconColor: '#8B5CF6',
      title: 'Decentralized Identity',
      subtitle: 'Your identity is not controlled by any company. You own it completely.',
    },
  ], []);


  if (oxyLoading || loading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading...</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  if (!isAuthenticated) {
    return (
      <UnauthenticatedScreen
        title="About Your Identity"
        subtitle="Learn about self-custody and how your identity works."
        message="Please sign in to view your identity information."
        isAuthenticated={isAuthenticated}
      />
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <ScreenHeader
            title="About Your Identity"
            subtitle="Self-custody identity powered by cryptography"
          />

          {/* ID Card */}
          <Section title="ID Card">
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
                Copy Public Key
              </Button>
            )}
          </Section>

          {/* Important Notice */}
          <ImportantBanner>
            Your recovery phrase is the ONLY way to restore your identity if you lose access to this device.
            Oxy cannot reset or recover your account. Keep your recovery phrase safe and never share it.
          </ImportantBanner>

          {/* Self-Custody Identity */}
          <Section title="Self-Custody Identity">
            <ThemedText style={styles.sectionDescription}>
              Unlike traditional accounts, your Oxy identity uses the same technology that secures Bitcoin.
              You have complete control over your identity.
            </ThemedText>
            <AccountCard>
              <GroupedSection items={selfCustodyItems} />
            </AccountCard>
          </Section>

          {/* Security Actions */}
          <Section title="Security Actions">
            <AccountCard>
              <GroupedSection
                items={[
                  {
                    id: 'create-backup',
                    icon: 'file-export',
                    iconColor: '#F59E0B',
                    title: 'Create Encrypted Backup',
                    subtitle: 'Generate password-protected backup file',
                    onPress: () => router.push('/(tabs)/create-backup'),
                    showChevron: true,
                  },
                  {
                    id: 'export-private-key',
                    icon: 'printer',
                    iconColor: '#8B5CF6',
                    title: 'Export Private Key',
                    subtitle: isExporting
                      ? 'Exporting...'
                      : exportHistory.length > 0
                        ? `Last exported ${formatRelativeTime(exportHistory[0]?.timestamp)}`
                        : 'Print your private key for secure backup',
                    onPress: handleExportPrivateKey,
                    showChevron: true,
                    disabled: isExporting,
                    customContent: isExporting ? (
                      <ActivityIndicator size="small" color="#8B5CF6" />
                    ) : undefined,
                  },
                ]}
              />
            </AccountCard>
          </Section>

          {/* Account Settings */}
          <Section title="Account Settings">
            <ThemedText style={styles.sectionDescription}>
              Manage your account preferences and expiration settings.
            </ThemedText>
            <AccountCard>
              <GroupedSection
                items={[
                  {
                    id: 'account-expiration',
                    icon: 'clock-outline',
                    iconColor: colors.tint,
                    title: 'Account Expiration',
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
