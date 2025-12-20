import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Platform, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { KeyManager, useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authenticate, canUseBiometrics, getErrorMessage } from '@/lib/biometricAuth';

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
  const { getPublicKey, currentDeviceId, activeSessionId, oxyServices, storeTransferCode, getTransferCode, hasIdentity, isAuthenticated, getActiveTransferId, getAllPendingTransfers } = useOxy();

  const [qrData, setQrData] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [transferCode, setTransferCode] = useState<string | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [transferStatus, setTransferStatus] = useState<'pending' | 'completed'>('pending');
  const [transferCodeStored, setTransferCodeStored] = useState<boolean>(false);
  const [wasAuthenticated, setWasAuthenticated] = useState<boolean>(false);

  // Use refs to track generation state and prevent infinite loops
  const isGeneratingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Generate QR code data with encrypted identity
  const generateQRData = useCallback(async () => {
    // CRITICAL: Don't generate if transfer already completed
    if (transferStatus === 'completed') {
      setIsGenerating(false);
      isGeneratingRef.current = false;
      return;
    }

    // CRITICAL: Check for active transfer lock - prevent multiple simultaneous transfers
    const activeTransferId = getActiveTransferId();
    if (activeTransferId && activeTransferId !== transferId) {
      const pendingTransfers = getAllPendingTransfers();
      const activeTransfer = pendingTransfers.find((t: { transferId: string }) => t.transferId === activeTransferId);
      if (activeTransfer) {
        const errorMsg = 'Another identity transfer is already in progress. Please wait for it to complete before starting a new transfer.';
        setError(errorMsg);
        setIsGenerating(false);
        isGeneratingRef.current = false;
        onError?.(errorMsg);
        if (__DEV__) {
          console.warn('[IdentityTransferQR] Active transfer lock detected', { activeTransferId });
        }
        return;
      }
    }

    // Prevent multiple simultaneous generation attempts
    if (isGeneratingRef.current) {
      if (__DEV__) {
        console.log('[IdentityTransferQR] Generation already in progress, skipping');
      }
      return;
    }

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    try {
      isGeneratingRef.current = true;
      setIsGenerating(true);
      setError(null);

      // Set timeout to detect stuck operations (30 seconds)
      timeoutRef.current = setTimeout(() => {
        if (isMountedRef.current && isGeneratingRef.current) {
          const errorMsg = 'QR code generation timed out. Please try again.';
          setError(errorMsg);
          setIsGenerating(false);
          isGeneratingRef.current = false;
          onError?.(errorMsg);
          if (__DEV__) {
            console.error('[IdentityTransferQR] Generation timeout');
          }
        }
      }, 30000);

      // Verify identity exists before proceeding
      const identityExists = await hasIdentity();
      if (!identityExists) {
        const errorMsg = 'No identity found. Please create or import an identity first.';
        setError(errorMsg);
        setIsGenerating(false);
        isGeneratingRef.current = false;
        onError?.(errorMsg);
        if (__DEV__) {
          console.error('[IdentityTransferQR] No identity found');
        }
        return;
      }

      // Verify identity still exists before proceeding
      const identityStillExists = await KeyManager.hasIdentity();
      if (!identityStillExists) {
        const errorMsg = 'Identity was deleted. Please create or import an identity first.';
        setError(errorMsg);
        setIsGenerating(false);
        isGeneratingRef.current = false;
        onError?.(errorMsg);
        if (__DEV__) {
          console.error('[IdentityTransferQR] Identity was deleted');
        }
        return;
      }

      // Check if biometric authentication is enabled and required
      if (Platform.OS !== 'web') {
        try {
          const biometricEnabled = await AsyncStorage.getItem('oxy_biometric_enabled');
          if (biometricEnabled === 'true') {
            const canUse = await canUseBiometrics();
            if (canUse) {
              // Verify identity still exists before biometric prompt
              const identityCheck = await KeyManager.hasIdentity();
              if (!identityCheck) {
                const errorMsg = 'Identity was deleted during authentication. Please create or import an identity first.';
                setError(errorMsg);
                setIsGenerating(false);
                isGeneratingRef.current = false;
                onError?.(errorMsg);
                if (__DEV__) {
                  console.error('[IdentityTransferQR] Identity was deleted during authentication');
                }
                return;
              }

              const authResult = await authenticate('Authenticate to generate identity transfer QR code');

              if (!authResult.success) {
                const errorMsg = getErrorMessage(authResult.error);
                throw new Error(errorMsg || 'Biometric authentication failed');
              }
            }
          }
        } catch (err: any) {
          // If it's a user cancellation, throw to prevent QR generation
          if (err?.message?.includes('cancelled') || err?.message?.includes('cancel') || err?.message?.includes('user_cancel')) {
            throw new Error('Transfer cancelled');
          }
          // For other errors, re-throw
          throw err;
        }
      }

      // Get public key for display
      const pk = await getPublicKey();
      if (!pk) {
        const errorMsg = 'Failed to retrieve public key. Please try again.';
        setError(errorMsg);
        setIsGenerating(false);
        isGeneratingRef.current = false;
        onError?.(errorMsg);
        if (__DEV__) {
          console.error('[IdentityTransferQR] Failed to retrieve public key');
        }
        return;
      }
      setPublicKey(pk);

      // Get private key
      const privateKey = await KeyManager.getPrivateKey();
      if (!privateKey) {
        const errorMsg = 'Failed to retrieve private key. Please try again.';
        setError(errorMsg);
        setIsGenerating(false);
        isGeneratingRef.current = false;
        onError?.(errorMsg);
        if (__DEV__) {
          console.error('[IdentityTransferQR] Failed to retrieve private key');
        }
        return;
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

      // Generate transfer ID (UUID v4)
      const randomBytes = Crypto.getRandomBytes(4);
      const randomHex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const generatedTransferId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${randomHex}`;

      // Reset state for new transfer
      setTransferCodeStored(false);
      setWasAuthenticated(false);
      setTransferStatus('pending');
      setTransferId(generatedTransferId);

      // Get source device ID from current device (exposed by OxyContext)
      // If not available, try to fetch it from the API
      let sourceDeviceId = currentDeviceId || null;

      // If deviceId is not available from session, try to get it from API
      if (!sourceDeviceId && activeSessionId && oxyServices) {
        try {
          const deviceSessions = await oxyServices.getDeviceSessions(activeSessionId);
          // Find the current session in the device sessions list
          const currentDeviceSession = deviceSessions.find(
            (session: any) => session.sessionId === activeSessionId
          );
          if (currentDeviceSession?.deviceId) {
            sourceDeviceId = currentDeviceSession.deviceId;
          }
        } catch (error) {
          // deviceId is optional for transfer
        }
      }

      // Store transfer code for verification when transfer completes (this sets the transfer lock)
      await storeTransferCode(generatedTransferId, code, sourceDeviceId, pk);
      setTransferCodeStored(true);
      setWasAuthenticated(isAuthenticated);

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
        transferId: generatedTransferId, // Unique ID for this transfer
        sourceDeviceId, // Device ID of the source device (for deletion notification)
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes expiry
      };

      // Convert to JSON string for QR code
      const qrString = JSON.stringify(transferData);

      // Clear timeout on success
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (isMountedRef.current) {
        setQrData(qrString);
        setError(null);
      }
    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to generate QR code';

      // Clear timeout on error
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (isMountedRef.current) {
        setError(errorMessage);
        onError?.(errorMessage);
        if (__DEV__) {
          console.error('[IdentityTransferQR] Generation error:', errorMessage, error);
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsGenerating(false);
      }
      isGeneratingRef.current = false;
    }
  }, [getPublicKey, onError, onCodeGenerated, storeTransferCode, activeSessionId, oxyServices, currentDeviceId, hasIdentity, transferStatus, isAuthenticated, getActiveTransferId, getAllPendingTransfers, transferId]);

  useEffect(() => {
    // Only generate QR if identity exists and transfer not completed
    // Use ref to prevent infinite loops
    const currentStatus = transferStatus;
    if (isGeneratingRef.current || currentStatus === 'completed') {
      return;
    }

    // Check if identity exists and generate QR code
    const checkAndGenerate = async () => {
      // Double-check ref inside async function
      // Re-read transferStatus to get latest value
      const latestStatus = transferStatus;
      if (isGeneratingRef.current || latestStatus === 'completed' || !isMountedRef.current) {
        return;
      }

      try {
        const identityExists = await hasIdentity();
        // Re-check status and ref inside async function to ensure it hasn't changed
        const finalStatus = transferStatus;
        if (identityExists && finalStatus !== 'completed' && !isGeneratingRef.current && isMountedRef.current) {
          generateQRData();
        }
      } catch (error) {
        // Identity may have been deleted or error checking
        if (isMountedRef.current) {
          setIsGenerating(false);
          isGeneratingRef.current = false;
          const errorMsg = 'Failed to check identity. Please try again.';
          setError(errorMsg);
          onError?.(errorMsg);
          if (__DEV__) {
            console.error('[IdentityTransferQR] Error checking identity:', error);
          }
        }
      }
    };

    checkAndGenerate();

    // Cleanup function
    return () => {
      // Cleanup is handled by isMountedRef
    };
  }, [generateQRData, hasIdentity, transferStatus, onError]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      isGeneratingRef.current = false;
    };
  }, []);

  // Listen for socket-triggered deletion
  useEffect(() => {
    if (!transferId || transferStatus === 'completed' || !transferCodeStored) return;

    const storedTransfer = getTransferCode(transferId);

    // Mark as completed if transfer code was cleared and user was logged out
    if (!storedTransfer && wasAuthenticated && !isAuthenticated && isMountedRef.current) {
      setTransferStatus('completed');
    }
  }, [transferId, transferStatus, transferCodeStored, wasAuthenticated, isAuthenticated, getTransferCode]);

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

  if (error) {
    return (
      <View style={styles.container}>
        <ThemedText style={[styles.errorText, { color: '#FF3B30' }]}>
          {error}
        </ThemedText>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.tint, marginTop: 16 }]}
          onPress={() => {
            setError(null);
            generateQRData();
          }}
        >
          <ThemedText style={[styles.retryButtonText, { color: '#FFFFFF' }]}>
            Try Again
          </ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  if (!qrData) {
    return (
      <View style={styles.container}>
        <ThemedText style={[styles.errorText, { color: colors.text }]}>
          Failed to generate QR code
        </ThemedText>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.tint, marginTop: 16 }]}
          onPress={() => {
            generateQRData();
          }}
        >
          <ThemedText style={[styles.retryButtonText, { color: '#FFFFFF' }]}>
            Try Again
          </ThemedText>
        </TouchableOpacity>
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

      {/* Transfer Status Indicator */}
      {transferId && transferStatus !== 'completed' && (
        <View style={styles.statusContainer}>
          <ThemedText style={[styles.statusLabel, { color: colors.secondaryText }]}>
            Transfer Status:
          </ThemedText>
          <View style={[styles.statusBadge, {
            backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
          }]}>
            <ThemedText style={[styles.statusText, { color: colors.text }]}>
              Waiting for transfer...
            </ThemedText>
          </View>
        </View>
      )}

      {transferStatus === 'completed' && (
        <View style={[styles.completedContainer, {
          backgroundColor: colorScheme === 'dark' ? 'rgba(52, 199, 89, 0.15)' : 'rgba(52, 199, 89, 0.1)',
        }]}>
          <ThemedText style={[styles.completedText, { color: '#34C759' }]}>
            ✓ Transfer completed successfully
          </ThemedText>
          <ThemedText style={[styles.completedSubtext, { color: colors.secondaryText }]}>
            Your identity has been removed from this device.
          </ThemedText>
        </View>
      )}
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
  statusContainer: {
    marginTop: 24,
    alignItems: 'center',
    width: '100%',
  },
  statusLabel: {
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 12,
    minWidth: 200,
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  completedContainer: {
    marginTop: 24,
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    width: '100%',
  },
  completedText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  completedSubtext: {
    fontSize: 12,
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

