import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useOxy } from '@oxyhq/services';
import { useAlert } from '@/components/ui';

/**
 * QR Scanner Screen
 * 
 * Scans QR codes from other Oxy apps to authorize sign-in requests.
 * The QR code contains an oxyauth:// URL with a session token.
 */
export default function ScanQRScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const alert = useAlert();
  const oxyContext = useOxy();
  const { hasIdentity, isLoading, importIdentity, oxyServices } = oxyContext;
  // @ts-ignore - isStorageReady may not be in type definition yet due to build cache
  const isStorageReady = oxyContext.isStorageReady ?? false;
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [checkingIdentity, setCheckingIdentity] = useState(true);
  const [hasExistingIdentity, setHasExistingIdentity] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [transferCode, setTransferCode] = useState('');
  const [pendingTransferData, setPendingTransferData] = useState<any>(null);

  // Handle barcode scan
  const handleBarCodeScanned = useCallback(async ({ data }: BarcodeScanningResult) => {
    if (scanned) return;
    setScanned(true);

    try {
      // Check if it's an identity transfer QR code (JSON format)
      let transferData: any = null;
      try {
        transferData = JSON.parse(data);
        if (transferData.type === 'oxy_identity_transfer') {
          // Handle identity transfer
          // Check if QR code expired
          if (transferData.expiresAt) {
            const expiresAt = new Date(transferData.expiresAt);
            if (Date.now() > expiresAt.getTime()) {
              alert(
                'QR Code Expired',
                'This QR code has expired. Please generate a new one.',
                [
                  {
                    text: 'Scan Again',
                    onPress: () => setScanned(false),
                  },
                  {
                    text: 'Cancel',
                    onPress: () => router.back(),
                    style: 'cancel',
                  },
                ]
              );
              return;
            }
          }

          // Store transfer data and prompt for transfer code
          setPendingTransferData(transferData);
          setShowCodeInput(true);
          setScanned(false); // Allow scanning again if user cancels
          return;
        }
      } catch {
        // Not JSON, continue with auth QR code handling
      }

      // Expected formats for auth QR codes:
      // 1. oxyauth://{sessionToken} (simple format from OxyAuthScreen QR)
      // 2. oxyauth://authorize?token=xxx (with query params)
      // 3. oxyaccounts://authorize?token=xxx (deep link format)
      // 4. https://accounts.oxy.so/authorize?token=xxx (web URL)
      let token: string | null = null;

      try {
        // Simple format: oxyauth://{sessionToken}
        if (data.startsWith('oxyauth://') && !data.includes('?')) {
          // Extract token directly from the path
          token = data.replace('oxyauth://', '').trim();
        }
        // URL format with query params
        else if (data.startsWith('oxyauth://') || data.startsWith('oxyaccounts://')) {
          const url = new URL(data);
          token = url.searchParams.get('token');
        }
        // Web URL format
        else if (data.includes('/authorize')) {
          const url = new URL(data);
          token = url.searchParams.get('token');
        }
      } catch {
        // Invalid URL format, try extracting token directly
        if (data.startsWith('oxyauth://')) {
          token = data.replace('oxyauth://', '').split('?')[0].trim();
        }
      }

      if (token && token.length > 10) {
        // Navigate to authorize screen with the token
        router.push({
          pathname: '/(tabs)/authorize',
          params: { token },
        });
      } else {
        alert(
          'Invalid QR Code',
          'This QR code is not a valid Oxy authorization request or identity transfer.',
          [
            {
              text: 'Scan Again',
              onPress: () => setScanned(false),
            },
            {
              text: 'Cancel',
              onPress: () => router.back(),
              style: 'cancel',
            },
          ]
        );
      }
    } catch (error) {
      alert(
        'Scan Error',
        'Failed to process QR code. Please try again.',
        [
          {
            text: 'Scan Again',
            onPress: () => setScanned(false),
          },
          {
            text: 'Cancel',
            onPress: () => router.back(),
            style: 'cancel',
          },
        ]
      );
    }
  }, [scanned, router, alert, importIdentity, oxyServices]);

  // Handle transfer code submission
  const handleTransferCodeSubmit = useCallback(async () => {
    if (!pendingTransferData || !transferCode || transferCode.length !== 6) {
      alert('Invalid Code', 'Please enter the 6-character transfer code.');
      return;
    }

    // Validate code matches (optional - we can just use what user entered)
    const code = transferCode.toUpperCase().trim();
    setShowCodeInput(false);
    setIsProcessing(true);
    setProcessingMessage('Decrypting identity...');
    setScanned(true); // Prevent further scanning

    try {
      if (!importIdentity) {
        throw new Error('Import identity function not available');
      }

      setProcessingMessage('Importing identity...');
      await importIdentity(
        {
          encrypted: pendingTransferData.encrypted,
          salt: pendingTransferData.salt,
          iv: pendingTransferData.iv,
          publicKey: pendingTransferData.publicKey,
        },
        code
      );

      setProcessingMessage('Completing transfer...');
      
      // Notify server about successful transfer (if transferId and sourceDeviceId are present)
      // Include transfer code for verification on source device
      // Retry with exponential backoff if it fails
      // Note: User should already be authenticated in tabs flow, but check anyway
      let notificationSuccess = false;
      if (pendingTransferData.transferId && pendingTransferData.sourceDeviceId && pendingTransferData.publicKey && oxyServices) {
        let retries = 3;
        let delay = 1000; // Start with 1 second
        
        while (retries > 0) {
          try {
            await oxyServices.makeRequest('POST', '/api/identity/transfer-complete', {
              transferId: pendingTransferData.transferId,
              sourceDeviceId: pendingTransferData.sourceDeviceId,
              publicKey: pendingTransferData.publicKey,
              transferCode: code, // Include transfer code for verification
            }, { cache: false });
            notificationSuccess = true;
            break; // Success, exit retry loop
          } catch (err: any) {
            retries--;
            if (retries > 0) {
              // Wait before retrying with exponential backoff
              await new Promise(resolve => setTimeout(resolve, delay));
              delay *= 2; // Double the delay for next retry
            } else {
              // Final failure - log but don't block user
              if (__DEV__) {
                console.warn('Failed to notify server about transfer completion after retries:', err);
              }
              notificationSuccess = false;
            }
          }
        }
      }

      setIsProcessing(false);
      setProcessingMessage('');
      setPendingTransferData(null);
      setTransferCode('');

      // Show appropriate message based on notification success
      if (notificationSuccess) {
        alert(
          'Identity Imported',
          'Your identity has been successfully transferred to this device. The source device will be notified to remove the identity.',
          [
            {
              text: 'OK',
              onPress: () => {
                router.replace('/(tabs)');
              },
            },
          ]
        );
      } else {
        // Transfer succeeded but notification failed - still show success but warn user
        alert(
          'Identity Imported',
          'Your identity has been successfully transferred to this device. However, we were unable to notify the source device automatically. Please manually delete the identity from the source device.',
          [
            {
              text: 'OK',
              onPress: () => {
                router.replace('/(tabs)');
              },
            },
          ]
        );
      }
    } catch (importError: any) {
      setIsProcessing(false);
      setProcessingMessage('');
      setScanned(false);
      alert(
        'Import Failed',
        importError?.message || 'Failed to import identity. Please check the transfer code and try again.',
        [
          {
            text: 'Try Again',
            onPress: () => {
              setShowCodeInput(true);
              setTransferCode('');
            },
          },
          {
            text: 'Cancel',
            onPress: () => {
              setPendingTransferData(null);
              setTransferCode('');
            },
            style: 'cancel',
          },
        ]
      );
    }
  }, [pendingTransferData, transferCode, importIdentity, oxyServices, alert, router]);

  // Toggle flash
  const toggleFlash = useCallback(() => {
    setFlashOn((prev) => !prev);
  }, []);

  // Handle close
  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  // Open settings
  const openSettings = useCallback(() => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  }, []);

  // Check identity on mount
  const checkIdentity = useCallback(async () => {
    try {
      const exists = await hasIdentity();
      setHasExistingIdentity(exists);

      if (!exists) {
        // No identity found - handle based on platform
        if (Platform.OS !== 'web') {
          // Native: redirect to auth flow
          router.replace('/(auth)');
        }
        // Web: will show message below
      }
    } catch (err) {
      console.error('Error checking identity:', err);
    } finally {
      setCheckingIdentity(false);
    }
  }, [hasIdentity, router]);

  useEffect(() => {
    // Wait for storage to be ready before checking identity
    if (isStorageReady) {
      checkIdentity();
    } else {
      // If storage isn't ready after a reasonable time, stop checking to avoid infinite loading
      const timeout = setTimeout(() => {
        console.warn('Storage not ready after timeout, stopping check');
        setCheckingIdentity(false);
      }, 3000); // 3 second timeout

      return () => clearTimeout(timeout);
    }
  }, [isStorageReady, checkIdentity]);

  // Show loading state while checking identity
  if (checkingIdentity || isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.text, { color: colors.secondaryText, marginTop: 16 }]}>
          Checking identity...
        </Text>
      </View>
    );
  }

  // No identity - show platform-specific message
  if (!hasExistingIdentity) {
    if (Platform.OS === 'web') {
      // Web: show message that identity creation is native-only
      return (
        <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
          <MaterialCommunityIcons
            name="qrcode-scan"
            size={64}
            color={colors.secondaryText}
            style={styles.icon}
          />
          <Text style={[styles.title, { color: colors.text }]}>
            Identity Required
          </Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
            To scan QR codes and authorize sign-in requests, you need to create or import an identity.{'\n\n'}
            Identity creation is only available on native platforms (iOS/Android). Please use the mobile app to set up your identity.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.tint, marginTop: 24 }]}
            onPress={handleClose}
          >
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      );
    }
    // Native: should have redirected, but show fallback just in case
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <Text style={[styles.text, { color: colors.secondaryText, marginTop: 16 }]}>
          Redirecting to identity setup...
        </Text>
      </View>
    );
  }

  // Permission not determined yet
  if (!permission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.text, { color: colors.text }]}>
          Requesting camera permission...
        </Text>
      </View>
    );
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons
          name="camera-off"
          size={64}
          color={colors.secondaryText}
          style={styles.icon}
        />
        <Text style={[styles.title, { color: colors.text }]}>
          Camera Access Required
        </Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
          To scan QR codes for sign-in authorization, we need access to your camera.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.tint }]}
          onPress={requestPermission}
        >
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.linkButton]}
          onPress={openSettings}
        >
          <Text style={[styles.linkText, { color: colors.tint }]}>
            Open Settings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.linkButton]}
          onPress={handleClose}
        >
          <Text style={[styles.linkText, { color: colors.secondaryText }]}>
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Loading Overlay */}
      {isProcessing && (
        <Modal
          transparent
          visible={isProcessing}
          animationType="fade"
        >
          <View style={styles.loadingOverlay}>
            <View style={[styles.loadingContent, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.tint} />
              <Text style={[styles.loadingText, { color: colors.text, marginTop: 16 }]}>
                {processingMessage || 'Processing...'}
              </Text>
            </View>
          </View>
        </Modal>
      )}

      {/* Transfer Code Input Modal */}
      {showCodeInput && (
        <Modal
          transparent
          visible={showCodeInput}
          animationType="slide"
          onRequestClose={() => {
            setShowCodeInput(false);
            setPendingTransferData(null);
            setTransferCode('');
            setScanned(false);
          }}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Enter Transfer Code
              </Text>
              <Text style={[styles.modalSubtitle, { color: colors.secondaryText }]}>
                Enter the 6-character code shown on the source device
              </Text>
              <TextInput
                style={[styles.codeInput, { 
                  backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5',
                  color: colors.text,
                  borderColor: colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0',
                }]}
                value={transferCode}
                onChangeText={(text) => {
                  // Only allow uppercase alphanumeric, max 6 characters
                  const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
                  setTransferCode(cleaned);
                }}
                placeholder="ABCD12"
                placeholderTextColor={colors.secondaryText}
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect={false}
                keyboardType="default"
                returnKeyType="done"
                onSubmitEditing={handleTransferCodeSubmit}
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={() => {
                    setShowCodeInput(false);
                    setPendingTransferData(null);
                    setTransferCode('');
                    setScanned(false);
                  }}
                >
                  <Text style={[styles.modalButtonText, { color: colors.secondaryText }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonSubmit, { 
                    backgroundColor: colors.tint,
                    opacity: transferCode.length !== 6 ? 0.5 : 1,
                  }]}
                  onPress={handleTransferCodeSubmit}
                  disabled={transferCode.length !== 6}
                >
                  <Text style={[styles.modalButtonText, { color: '#FFFFFF' }]}>
                    Continue
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      <CameraView
        style={styles.camera}
        facing="back"
        enableTorch={flashOn}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      >
        {/* Overlay */}
        <View style={styles.overlay}>
          {/* Top section */}
          <View style={styles.overlaySection} />

          {/* Middle section with scanner frame */}
          <View style={styles.middleSection}>
            <View style={styles.overlaySection} />
            <View style={styles.scannerFrame}>
              {/* Corner decorations */}
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
            <View style={styles.overlaySection} />
          </View>

          {/* Bottom section */}
          <View style={[styles.overlaySection, styles.bottomSection]}>
            <Text style={styles.instructionText}>
              Scan a QR code to authorize sign-in or transfer identity
            </Text>

            {/* Controls */}
            <View style={styles.controls}>
              <TouchableOpacity
                style={styles.controlButton}
                onPress={toggleFlash}
              >
                <MaterialCommunityIcons
                  name={flashOn ? 'flash' : 'flash-off'}
                  size={28}
                  color="#fff"
                />
                <Text style={styles.controlText}>
                  {flashOn ? 'Flash On' : 'Flash Off'}
                </Text>
              </TouchableOpacity>

              {scanned && (
                <TouchableOpacity
                  style={styles.controlButton}
                  onPress={() => setScanned(false)}
                >
                  <MaterialCommunityIcons
                    name="refresh"
                    size={28}
                    color="#fff"
                  />
                  <Text style={styles.controlText}>Scan Again</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Close button */}
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
        >
          <MaterialCommunityIcons name="close" size={28} color="#fff" />
        </TouchableOpacity>
      </CameraView>
    </View>
  );
}

const SCANNER_SIZE = 280;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  overlaySection: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  middleSection: {
    flexDirection: 'row',
    height: SCANNER_SIZE,
  },
  scannerFrame: {
    width: SCANNER_SIZE,
    height: SCANNER_SIZE,
    backgroundColor: 'transparent',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#fff',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  bottomSection: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 32,
  },
  instructionText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 32,
    marginBottom: 32,
  },
  controls: {
    flexDirection: 'row',
    gap: 40,
  },
  controlButton: {
    alignItems: 'center',
    gap: 8,
  },
  controlText: {
    color: '#fff',
    fontSize: 12,
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
    marginBottom: 32,
    lineHeight: 22,
  },
  text: {
    fontSize: 16,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    padding: 12,
  },
  linkText: {
    fontSize: 16,
  },
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    padding: 32,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 200,
  },
  loadingText: {
    fontSize: 16,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  codeInput: {
    width: '100%',
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    paddingHorizontal: 16,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    fontFamily: 'monospace',
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonCancel: {
    backgroundColor: 'transparent',
  },
  modalButtonSubmit: {
    opacity: 1,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

