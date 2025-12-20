import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { ScreenHeader } from '@/components/ui';

/**
 * Import Options Screen
 * 
 * Allows users to choose between scanning QR code or importing backup file
 */
export default function ImportOptionsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const handleScanQR = () => {
    router.push('/(auth)/scan-qr' as any);
  };

  const handleImportBackup = () => {
    router.push('/(auth)/import-identity');
  };

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader
          title="Import or Restore Identity"
          subtitle="Choose how you want to restore your identity"
        />

        <View style={styles.content}>
          <View style={styles.optionsContainer}>
            {/* Scan QR Code Option */}
            <TouchableOpacity
              style={[
                styles.optionCard,
                {
                  backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5',
                  borderColor: colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0',
                },
              ]}
              onPress={handleScanQR}
              activeOpacity={0.7}
            >
              <View style={[styles.iconContainer, { backgroundColor: colors.tint + '20' }]}>
                <MaterialCommunityIcons
                  name="qrcode-scan"
                  size={32}
                  color={colors.tint}
                />
              </View>
              <ThemedText style={[styles.optionTitle, { color: colors.text }]}>
                Scan QR Code
              </ThemedText>
              <ThemedText style={[styles.optionDescription, { color: colors.secondaryText }]}>
                Transfer your identity from another device by scanning a QR code
              </ThemedText>
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color={colors.secondaryText}
                style={styles.chevron}
              />
            </TouchableOpacity>

            {/* Import Backup File Option */}
            <TouchableOpacity
              style={[
                styles.optionCard,
                {
                  backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5',
                  borderColor: colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0',
                },
              ]}
              onPress={handleImportBackup}
              activeOpacity={0.7}
            >
              <View style={[styles.iconContainer, { backgroundColor: colors.tint + '20' }]}>
                <MaterialCommunityIcons
                  name="file-import"
                  size={32}
                  color={colors.tint}
                />
              </View>
              <ThemedText style={[styles.optionTitle, { color: colors.text }]}>
                Import Backup File
              </ThemedText>
              <ThemedText style={[styles.optionDescription, { color: colors.secondaryText }]}>
                Restore your identity from an encrypted backup file
              </ThemedText>
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color={colors.secondaryText}
                style={styles.chevron}
              />
            </TouchableOpacity>
          </View>
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
    flex: 1,
    padding: 16,
  },
  optionsContainer: {
    gap: 16,
    marginTop: 24,
  },
  optionCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    position: 'relative',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  optionDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  chevron: {
    position: 'absolute',
    right: 20,
    top: '50%',
    marginTop: -12,
  },
});

