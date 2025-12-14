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
import { useOxy } from '@oxyhq/services';

export default function AboutIdentityScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const router = useRouter();
  const { user, isAuthenticated, isLoading: oxyLoading, getPublicKey, hasIdentity } = useOxy();

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
});
