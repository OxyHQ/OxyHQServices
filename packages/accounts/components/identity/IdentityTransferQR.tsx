import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { KeyManager, useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import * as Crypto from 'expo-crypto';

interface IdentityTransferQRProps {
  onError?: (error: string) => void;
  onCodeGenerated?: (code: string) => void;
}

/**
 * Component for generating QR code with encrypted identity data
 * Similar to backup file format but in QR code for easy transfer
 */
export function IdentityTransferQR({ onError, onCodeGenerated }: IdentityTransferQRProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { getPublicKey } = useOxy();

  const [qrData, setQrData] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(true);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [transferCode, setTransferCode] = useState<string | null>(null);

  // Generate QR code data with encrypted identity
  const generateQRData = useCallback(async () => {
    try {
      setIsGenerating(true);

      // Get public key for display
      const pk = await getPublicKey();
      if (!pk) {
        throw new Error('No identity found on this device');
      }
      setPublicKey(pk);

      // Get private key
      const privateKey = await KeyManager.getPrivateKey();
      if (!privateKey) {
        throw new Error('No private key found on this device');
      }

      // Generate random salt and IV (same as backup file)
      const salt = Crypto.getRandomBytes(32);
      const iv = Crypto.getRandomBytes(16);

      // Generate a 6-character transfer code
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing characters (0, O, I, 1)
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      setTransferCode(code);
      onCodeGenerated?.(code);

      // Encrypt private key (same algorithm as EncryptedBackupGenerator)
      const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
      let key = code + saltHex;
      for (let i = 0; i < 10000; i++) {
        key = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          key
        );
      }
      const keyBytes = new Uint8Array(32);
      for (let i = 0; i < 64 && i < key.length; i += 2) {
        keyBytes[i / 2] = parseInt(key.substring(i, i + 2), 16);
      }

      // XOR encryption (same as backup file)
      const privateKeyBytes = new TextEncoder().encode(privateKey);
      const encrypted = new Uint8Array(privateKeyBytes.length);
      for (let i = 0; i < privateKeyBytes.length; i++) {
        encrypted[i] = privateKeyBytes[i] ^ keyBytes[i % keyBytes.length] ^ iv[i % iv.length];
      }

      const encryptedBase64 = Buffer.from(encrypted).toString('base64');

      // Create transfer data structure
      const transferData = {
        version: '1.0',
        type: 'oxy_identity_transfer',
        algorithm: 'xor-sha256',
        encrypted: encryptedBase64,
        salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join(''),
        iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
        publicKey: pk,
        password: code, // Use 6-character code as password
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes expiry
      };

      // Convert to JSON string for QR code
      const qrString = JSON.stringify(transferData);
      setQrData(qrString);
    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to generate QR code';
      onError?.(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  }, [getPublicKey, onError, onCodeGenerated]);

  useEffect(() => {
    generateQRData();
  }, [generateQRData]);

  if (isGenerating) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.tint} />
        <ThemedText style={[styles.loadingText, { color: colors.text }]}>
          Generating QR code...
        </ThemedText>
      </View>
    );
  }

  if (!qrData) {
    return (
      <View style={styles.container}>
        <ThemedText style={[styles.errorText, { color: colors.text }]}>
          Failed to generate QR code
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.qrContainer, { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 12 }]}>
        <QRCode
          value={qrData}
          size={280}
          backgroundColor="white"
          color="black"
        />
      </View>
      {transferCode && (
        <View style={styles.codeContainer}>
          <ThemedText style={[styles.codeLabel, { color: colors.secondaryText }]}>
            Transfer Code
          </ThemedText>
          <View style={[styles.codeBox, { 
            backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5',
            borderColor: colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0',
          }]}>
            <ThemedText style={[styles.codeText, { color: colors.text }]}>
              {transferCode}
            </ThemedText>
          </View>
          <ThemedText style={[styles.codeHint, { color: colors.secondaryText }]}>
            Enter this code on the target device when prompted
          </ThemedText>
        </View>
      )}
      {publicKey && (
        <ThemedText style={[styles.publicKeyText, { color: colors.secondaryText }]}>
          Public Key: {publicKey.substring(0, 16)}...{publicKey.substring(publicKey.length - 16)}
        </ThemedText>
      )}
      <ThemedText style={[styles.instructionText, { color: colors.secondaryText }]}>
        Scan this QR code with another device to transfer your identity.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  publicKeyText: {
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  instructionText: {
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
    lineHeight: 20,
  },
  codeContainer: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  codeLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  codeBox: {
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeText: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 4,
    fontFamily: 'monospace',
  },
  codeHint: {
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 16,
  },
});

