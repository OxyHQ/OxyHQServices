import React, { useState, useCallback } from 'react';
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
import { notifyTransferComplete } from '@/utils/transferUtils';

// Constants for delays
const IDENTITY_PERSIST_DELAY_MS = 100;
const STATE_STABILIZATION_DELAY_MS = 200;
const NAVIGATION_DELAY_MS = 100;

/**
 * QR Scanner Screen (Auth Flow)
 * 
 * Scans QR codes for identity transfer. Works for unauthenticated users.
 * After successful import, navigates to appropriate next step.
 */
export default function AuthScanQRScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const alert = useAlert();
  const { importIdentity, oxyServices, hasIdentity, signIn } = useOxy();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
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
        // Not JSON, show error for non-transfer QR codes
        alert(
          'Invalid QR Code',
          'This QR code is not a valid identity transfer code. Please scan a QR code generated from the Transfer Identity screen.',
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

      // Verify identity was successfully imported before proceeding
      // Small delay to ensure identity is fully persisted
      await new Promise(resolve => setTimeout(resolve, IDENTITY_PERSIST_DELAY_MS));
      const identityExists = await hasIdentity();
      if (!identityExists) {
        throw new Error('Identity import failed - identity not found on device');
      }

      // Sign in to create a session before calling notifyTransferComplete
      // This is required because notifyTransferComplete requires authentication
      setProcessingMessage('Signing in...');
      try {
        await signIn();
      } catch (signInError: any) {
        // If sign-in fails, we still have the identity imported locally
        // Log the error but continue - the notification might still work if there's a cached session
        if (__DEV__) {
          console.warn('[scan-qr] Sign-in failed after import, continuing anyway:', signInError);
        }
      }

      setProcessingMessage('Completing transfer...');
      
      const notificationResult = await notifyTransferComplete(
        oxyServices!,
        {
          transferId: pendingTransferData.transferId,
          sourceDeviceId: pendingTransferData.sourceDeviceId,
          publicKey: pendingTransferData.publicKey,
          transferCode: code,
        }
      );
      const notificationSuccess = notificationResult.success;

      setIsProcessing(false);
      setProcessingMessage('');
      setPendingTransferData(null);
      setTransferCode('');

      // Small delay to ensure state is fully stable before showing alert
      await new Promise(resolve => setTimeout(resolve, STATE_STABILIZATION_DELAY_MS));

      // Shared handler for alert navigation with identity verification
      const handleAlertNavigation = async () => {
        const identityVerified = await hasIdentity();
        if (identityVerified) {
          await new Promise(resolve => setTimeout(resolve, NAVIGATION_DELAY_MS));
          router.replace('/(auth)/import-identity/notifications');
        } else {
          alert(
            'Error',
            'Identity verification failed. Please try importing again.',
            [{ text: 'OK' }]
          );
        }
      };

      // Show appropriate message based on notification success
      if (notificationSuccess) {
        alert(
          'Identity Imported',
          'Your identity has been successfully transferred to this device. The source device will be notified to remove the identity.',
          [
            {
              text: 'OK',
              onPress: handleAlertNavigation,
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
              onPress: handleAlertNavigation,
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
  }, [pendingTransferData, transferCode, importIdentity, oxyServices, hasIdentity, signIn, alert, router]);

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
          To scan QR codes for identity transfer, we need access to your camera.
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
              Scan the QR code from another device to transfer your identity
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

