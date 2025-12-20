import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { ScreenHeader, ImportantBanner, useAlert } from '@/components/ui';
import { IdentityTransferQR } from '@/components/identity/IdentityTransferQR';
import { useOxy } from '@oxyhq/services';

/**
 * Transfer Identity Screen
 * 
 * Allows users to generate a QR code to transfer their identity to another device
 */
export default function TransferIdentityScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const alert = useAlert();
  const { isAuthenticated, hasIdentity } = useOxy();
  const [hasExistingIdentity, setHasExistingIdentity] = useState<boolean | null>(null);

  // Check if identity exists
  React.useEffect(() => {
    const checkIdentity = async () => {
      if (hasIdentity) {
        const exists = await hasIdentity();
        setHasExistingIdentity(exists);
        if (!exists) {
          alert(
            'No Identity',
            'You need to create or import an identity before you can transfer it.',
            [
              {
                text: 'OK',
                onPress: () => router.back(),
              },
            ]
          );
        }
      }
    };
    checkIdentity();
  }, [hasIdentity, router, alert]);

  const handleError = useCallback((error: string) => {
    alert('Error', error);
  }, [alert]);

  if (hasExistingIdentity === false) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <ScreenHeader
            title="Transfer Identity"
            subtitle="Generate QR code to move your identity to another device"
          />
        </View>
      </ScreenContentWrapper>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader
          title="Transfer Identity"
          subtitle="Generate QR code to move your identity to another device"
        />

        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
          <ImportantBanner iconSize={20}>
            This QR code contains your encrypted identity. Make sure you're in a secure location and only scan it with a device you trust.
          </ImportantBanner>

          <View style={styles.section}>
            <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
              Steps to Transfer
            </ThemedText>
            <View style={styles.stepsContainer}>
              <View style={styles.step}>
                <View style={[styles.stepNumber, { backgroundColor: colors.tint }]}>
                  <ThemedText style={styles.stepNumberText}>1</ThemedText>
                </View>
                <ThemedText style={[styles.stepText, { color: colors.text }]}>
                  Generate QR code on this device
                </ThemedText>
              </View>
              <View style={styles.step}>
                <View style={[styles.stepNumber, { backgroundColor: colors.tint }]}>
                  <ThemedText style={styles.stepNumberText}>2</ThemedText>
                </View>
                <ThemedText style={[styles.stepText, { color: colors.text }]}>
                  Open Oxy Accounts on the target device
                </ThemedText>
              </View>
              <View style={styles.step}>
                <View style={[styles.stepNumber, { backgroundColor: colors.tint }]}>
                  <ThemedText style={styles.stepNumberText}>3</ThemedText>
                </View>
                <ThemedText style={[styles.stepText, { color: colors.text }]}>
                  Scan the QR code using the QR scanner
                </ThemedText>
              </View>
              <View style={styles.step}>
                <View style={[styles.stepNumber, { backgroundColor: colors.tint }]}>
                  <ThemedText style={styles.stepNumberText}>4</ThemedText>
                </View>
                <ThemedText style={[styles.stepText, { color: colors.text }]}>
                  Enter the 6-character transfer code when prompted
                </ThemedText>
              </View>
            </View>
          </View>

          <View style={styles.qrSection}>
            <IdentityTransferQR onError={handleError} />
          </View>
        </ScrollView>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  stepsContainer: {
    gap: 16,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  qrSection: {
    marginTop: 32,
    alignItems: 'center',
  },
});

