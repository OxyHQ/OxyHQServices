import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Button, ImportantBanner, useAlert, KeyboardAwareScrollViewWrapper } from '@/components/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { extractAuthErrorMessage } from '@/utils/auth/errorUtils';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import JSZip from 'jszip';

/**
 * Import Identity - Backup File Screen
 * 
 * Allows user to import identity from encrypted backup file
 */
export default function ImportBackupScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const { importIdentity, isLoading } = useOxy();
  const { error, setAuthError } = useAuthFlowContext();
  const alert = useAlert();

  const backgroundColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.background : Colors.light.background),
    [colorScheme]
  );
  const textColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.text : Colors.light.text),
    [colorScheme]
  );

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ name: string; uri: string } | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleSelectFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/zip',
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedFile({
          name: asset.name || 'backup.zip',
          uri: asset.uri,
        });
        setAuthError(null);
      }
    } catch (err: any) {
      setAuthError('Failed to select file. Please try again.');
      console.error('File selection error:', err);
    }
  }, [setAuthError]);

  const handleImport = useCallback(async () => {
    if (!selectedFile) {
      setAuthError('Please select a backup file');
      return;
    }

    if (!password) {
      setAuthError('Please enter your backup password');
      return;
    }

    setAuthError(null);
    setIsImporting(true);

    try {
      // Read the ZIP file
      const file = new File(selectedFile.uri);
      const zipData = await file.read();

      // Parse ZIP
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(zipData);

      // Extract wallet.json
      const walletFile = zipContent.file('wallet.json');
      if (!walletFile) {
        throw new Error('Backup file is invalid. wallet.json not found.');
      }

      const walletJson = await walletFile.async('string');
      const backupData = JSON.parse(walletJson);

      // Validate backup data structure
      if (
        !backupData.encrypted ||
        !backupData.salt ||
        !backupData.iv ||
        !backupData.publicKey ||
        backupData.type !== 'oxy_identity_backup'
      ) {
        throw new Error('Backup file is invalid or corrupted.');
      }

      // Import identity
      const result = await importIdentity(
        {
          encrypted: backupData.encrypted,
          salt: backupData.salt,
          iv: backupData.iv,
          publicKey: backupData.publicKey,
        },
        password
      );

      const wasOffline = !result.synced;

      // Check if offline - if so, skip username step
      if (wasOffline) {
        router.replace('/(auth)/import-identity/notifications');
      } else {
        router.replace('/(auth)/import-identity/username');
      }
    } catch (err: unknown) {
      const errorMessage = extractAuthErrorMessage(err, 'Failed to import identity');
      setAuthError(errorMessage);
      alert('Import Failed', errorMessage);
    } finally {
      setIsImporting(false);
    }
  }, [selectedFile, password, importIdentity, router, setAuthError, alert]);

  const isLoadingState = isLoading || isImporting;

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <KeyboardAwareScrollViewWrapper
        contentContainerStyle={[styles.scrollContent, styles.stepContainer]}
      >
        <MaterialCommunityIcons
          name="file-import"
          size={64}
          color={textColor}
          style={styles.icon}
        />
        <Text style={[styles.title, { color: textColor }]}>Import Your Identity</Text>
        <Text style={[styles.subtitle, { color: textColor, opacity: 0.6 }]}>
          Select your encrypted backup file and enter your password to restore your identity.
        </Text>

        <ImportantBanner iconSize={20} style={styles.banner}>
          Your backup file contains your encrypted identity. Make sure you're in a secure location when importing.
        </ImportantBanner>

        {/* File Selection */}
        <View style={styles.section}>
          <ThemedText style={[styles.label, { color: textColor }]}>Backup File</ThemedText>
          <TouchableOpacity
            style={[
              styles.fileButton,
              {
                backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5',
                borderColor: colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0',
              },
            ]}
            onPress={handleSelectFile}
            disabled={isLoadingState}
          >
            <MaterialCommunityIcons
              name={selectedFile ? 'file-check' : 'file-document-outline'}
              size={24}
              color={textColor}
            />
            <ThemedText
              style={[styles.fileButtonText, { color: textColor }]}
              numberOfLines={1}
            >
              {selectedFile ? selectedFile.name : 'Select backup file (.zip)'}
            </ThemedText>
            <MaterialCommunityIcons
              name="chevron-right"
              size={24}
              color={textColor}
              style={{ opacity: 0.5 }}
            />
          </TouchableOpacity>
        </View>

        {/* Password Input */}
        <View style={styles.section}>
          <ThemedText style={[styles.label, { color: textColor }]}>Backup Password</ThemedText>
          <View
            style={[
              styles.passwordContainer,
              {
                backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5',
                borderColor: colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0',
              },
            ]}
          >
            <TextInput
              style={[styles.passwordInput, { color: textColor }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter backup password"
              placeholderTextColor={colorScheme === 'dark' ? '#8E8E93' : '#8E8E93'}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoadingState}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeButton}
            >
              <MaterialCommunityIcons
                name={showPassword ? 'eye-off' : 'eye'}
                size={20}
                color={textColor}
                style={{ opacity: 0.6 }}
              />
            </TouchableOpacity>
          </View>
        </View>

        {error && (
          <View style={styles.errorContainer}>
            <MaterialCommunityIcons name="alert-circle" size={20} color="#FF3B30" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Button
          variant="primary"
          onPress={handleImport}
          disabled={isLoadingState || !selectedFile || !password}
          loading={isLoadingState}
          style={styles.primaryButton}
        >
          Import Identity
        </Button>

        <Button
          variant="ghost"
          onPress={() => router.push('/(auth)/create-identity')}
          disabled={isLoadingState}
        >
          Create a new identity instead
        </Button>
      </KeyboardAwareScrollViewWrapper>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  stepContainer: {
    padding: 20,
    alignItems: 'center',
  },
  icon: {
    marginBottom: 24,
    opacity: 0.8,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  banner: {
    marginBottom: 24,
    width: '100%',
  },
  section: {
    width: '100%',
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  fileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  fileButtonText: {
    flex: 1,
    fontSize: 16,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 16,
  },
  eyeButton: {
    padding: 8,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
    width: '100%',
  },
  errorText: {
    flex: 1,
    color: '#FF3B30',
    fontSize: 14,
  },
  primaryButton: {
    width: '100%',
    marginBottom: 12,
  },
});
