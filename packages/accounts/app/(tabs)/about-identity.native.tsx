import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Share,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useOxy, KeyManager } from '@oxyhq/services';
import * as Print from 'expo-print';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function AboutIdentityScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const router = useRouter();
  const { user, isAuthenticated, isLoading: oxyLoading, getPublicKey, hasIdentity, oxyServices } = useOxy();

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSavingExpiration, setIsSavingExpiration] = useState(false);
  const [exportHistory, setExportHistory] = useState<Array<{ timestamp: string; date: string }>>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

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
        setIsLoadingHistory(true);
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
      } finally {
        setIsLoadingHistory(false);
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
        Alert.alert('Copied', 'Public key copied to clipboard');
      } catch {
        Alert.alert('Error', 'Failed to copy');
      }
    } else {
      try {
        await Share.share({ message: publicKey });
      } catch {
        // Cancelled
      }
    }
  }, [publicKey]);

  const truncateKey = (key: string): string => {
    if (key.length <= 20) return key;
    return `${key.slice(0, 10)}...${key.slice(-10)}`;
  };

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
      Alert.alert('Success', 'Account expiration setting updated successfully');
    } catch (error: any) {
      console.error('Failed to update expiration setting:', error);
      Alert.alert('Error', error?.message || 'Failed to update account expiration setting. Please try again.');
    } finally {
      setIsSavingExpiration(false);
    }
  }, [oxyServices, user]);

  // Show expiration selection dialog
  const showExpirationPicker = useCallback(() => {
    const options = [
      { label: '30 days', value: 30 },
      { label: '90 days', value: 90 },
      { label: '180 days', value: 180 },
      { label: '1 year', value: 365 },
      { label: 'Never', value: null },
    ];

    Alert.alert(
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
  }, [handleExpirationChange]);

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
    Alert.alert(
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
                Alert.alert('Error', 'No private key found on this device');
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

              Alert.alert('Success', 'Private key has been sent to printer');
            } catch (error: any) {
              console.error('Failed to export private key:', error);
              Alert.alert('Error', error?.message || 'Failed to export private key. Please try again.');
            } finally {
              setIsExporting(false);
            }
          },
        },
      ]
    );
  }, [publicKey, saveExportHistory]);

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

  // How it works
  const howItWorksItems = useMemo(() => [
    {
      id: 'create',
      icon: 'plus-circle-outline',
      iconColor: colors.tint,
      title: '1. Key Generation',
      subtitle: 'When you create your identity, a unique ECDSA secp256k1 key pair is generated on your device.',
    },
    {
      id: 'sign',
      icon: 'draw',
      iconColor: colors.tint,
      title: '2. Digital Signatures',
      subtitle: 'When you sign in, your device signs a challenge with your private key, proving your identity.',
    },
    {
      id: 'verify',
      icon: 'check-decagram',
      iconColor: colors.tint,
      title: '3. Verification',
      subtitle: 'The server verifies the signature using your public key. No secrets are ever transmitted.',
    },
  ], [colors]);

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

          {/* Public Key Card */}
          <AccountCard>
            <View style={styles.publicKeyCard}>
              <View style={styles.publicKeyHeader}>
                <MaterialCommunityIcons name="key" size={24} color={colors.tint} />
                <Text style={[styles.publicKeyLabel, { color: colors.text }]}>Your Public Key</Text>
              </View>
              <TouchableOpacity onPress={handleCopyPublicKey} style={styles.publicKeyButton}>
                <Text style={[styles.publicKeyValue, { color: colors.textSecondary }]}>
                  {publicKey ? truncateKey(publicKey) : 'Not available'}
                </Text>
                {publicKey && (
                  <MaterialCommunityIcons name="content-copy" size={18} color={colors.textSecondary} />
                )}
              </TouchableOpacity>
              <Text style={[styles.publicKeyHint, { color: colors.textSecondary }]}>
                This is your unique identifier across all Oxy apps. Tap to copy.
              </Text>
            </View>
          </AccountCard>

          {/* Self-Custody Explanation */}
          <Section title="Self-Custody Identity">
            <ThemedText style={styles.sectionDescription}>
              Unlike traditional accounts, your Oxy identity uses the same technology that secures Bitcoin. 
              You have complete control over your identity.
            </ThemedText>
            <AccountCard>
              <GroupedSection items={selfCustodyItems} />
            </AccountCard>
          </Section>

          {/* How It Works */}
          <Section title="How It Works">
            <ThemedText style={styles.sectionDescription}>
              Your identity is based on public key cryptography (ECDSA secp256k1).
            </ThemedText>
            <AccountCard>
              <GroupedSection items={howItWorksItems} />
            </AccountCard>
          </Section>

          {/* Important Notice */}
          <View style={[styles.importantNotice, { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' }]}>
            <View style={styles.noticeHeader}>
              <MaterialCommunityIcons name="alert-circle" size={24} color="#D97706" />
              <Text style={[styles.noticeTitle, { color: '#92400E' }]}>Important</Text>
            </View>
            <Text style={[styles.noticeText, { color: '#92400E' }]}>
              Your recovery phrase is the ONLY way to restore your identity if you lose access to this device.
              Oxy cannot reset or recover your account. Keep your recovery phrase safe and never share it.
            </Text>
          </View>

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

          {/* Security Actions */}
          <Section title="Security Actions">
            <AccountCard>
              <GroupedSection
                items={[
                  {
                    id: 'view-recovery',
                    icon: 'shield-key-outline',
                    iconColor: '#F59E0B',
                    title: 'View Recovery Phrase',
                    subtitle: 'Show your 12-word backup phrase',
                    onPress: () => Alert.alert(
                      'Security Check',
                      'Make sure no one is looking at your screen before viewing your recovery phrase.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Continue', onPress: () => router.push('/(tabs)/security') },
                      ]
                    ),
                    showChevron: true,
                  },
                  {
                    id: 'export-private-key',
                    icon: 'printer',
                    iconColor: '#8B5CF6',
                    title: 'Export Private Key',
                    subtitle: 'Print your private key for secure backup',
                    onPress: handleExportPrivateKey,
                    showChevron: true,
                    disabled: isExporting,
                    customContent: isExporting ? (
                      <ActivityIndicator size="small" color="#8B5CF6" />
                    ) : undefined,
                  },
                  {
                    id: 'export-identity',
                    icon: 'export-variant',
                    iconColor: colors.tint,
                    title: 'Export to Another Device',
                    subtitle: 'Use your recovery phrase on another device',
                    onPress: () => Alert.alert(
                      'Export Identity',
                      'To use your identity on another device, open Oxy Accounts on that device and choose "I Have a Recovery Phrase".',
                      [{ text: 'OK' }]
                    ),
                    showChevron: true,
                  },
                ]}
              />
            </AccountCard>
          </Section>

          {/* Export History */}
          <Section title="Export History">
            <ThemedText style={styles.sectionDescription}>
              View your private key export history for transparency and security auditing.
            </ThemedText>
            <AccountCard>
              {isLoadingHistory ? (
                <View style={styles.historyLoadingContainer}>
                  <ActivityIndicator size="small" color={colors.tint} />
                  <Text style={[styles.historyLoadingText, { color: colors.textSecondary }]}>
                    Loading history...
                  </Text>
                </View>
              ) : exportHistory.length === 0 ? (
                <View style={styles.emptyHistoryContainer}>
                  <MaterialCommunityIcons name="history" size={48} color={colors.textSecondary} style={{ opacity: 0.5 }} />
                  <Text style={[styles.emptyHistoryText, { color: colors.textSecondary }]}>
                    No export history yet
                  </Text>
                  <Text style={[styles.emptyHistorySubtext, { color: colors.textSecondary }]}>
                    When you export your private key, it will appear here
                  </Text>
                </View>
              ) : (
                <ScrollView style={styles.historyList} nestedScrollEnabled>
                  {exportHistory.map((entry, index) => (
                    <View key={index} style={[styles.historyItem, { borderBottomColor: colors.border }]}>
                      <View style={styles.historyItemContent}>
                        <MaterialCommunityIcons name="printer" size={20} color={colors.tint} />
                        <View style={styles.historyItemText}>
                          <Text style={[styles.historyItemDate, { color: colors.text }]}>
                            {entry.date}
                          </Text>
                          <Text style={[styles.historyItemTimestamp, { color: colors.textSecondary }]}>
                            {new Date(entry.timestamp).toISOString()}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
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
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    opacity: 0.7,
  },
  publicKeyCard: {
    padding: 16,
  },
  publicKeyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  publicKeyLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 10,
  },
  publicKeyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.05)',
    padding: 12,
    borderRadius: 8,
  },
  publicKeyValue: {
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  publicKeyHint: {
    fontSize: 12,
    marginTop: 8,
  },
  sectionDescription: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 12,
    lineHeight: 20,
  },
  importantNotice: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginVertical: 16,
  },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  noticeTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  noticeText: {
    fontSize: 14,
    lineHeight: 20,
  },
  historyLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  historyLoadingText: {
    marginLeft: 12,
    fontSize: 14,
  },
  emptyHistoryContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyHistoryText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyHistorySubtext: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
  },
  historyList: {
    maxHeight: 300,
  },
  historyItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  historyItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyItemText: {
    marginLeft: 12,
    flex: 1,
  },
  historyItemDate: {
    fontSize: 14,
    fontWeight: '500',
  },
  historyItemTimestamp: {
    fontSize: 12,
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
