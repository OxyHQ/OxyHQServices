import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useOxy } from '@oxyhq/services';
import { useAlert } from '@/components/ui';

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
  const { importIdentity } = useOxy();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

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

          // Get transfer code from QR data
          const password = transferData.password || '';
          
          if (!password) {
            // If no code in QR, show error
            alert(
              'Transfer Code Required',
              'This QR code requires a transfer code. Please check the QR code and try again.',
              [
                {
                  text: 'OK',
                  onPress: () => {
                    // Navigate to import screen with transfer data
                    router.push({
                      pathname: '/(auth)/import-identity',
                      params: {
                        transferData: JSON.stringify(transferData),
                      },
                    });
                  },
                },
                {
                  text: 'Cancel',
                  onPress: () => setScanned(false),
                  style: 'cancel',
                },
              ]
            );
            return;
          }

          // Import identity using transfer data
          if (!importIdentity) {
            throw new Error('Import identity function not available');
          }

          try {
            await importIdentity(
              {
                encrypted: transferData.encrypted,
                salt: transferData.salt,
                iv: transferData.iv,
                publicKey: transferData.publicKey,
              },
              password
            );

            alert(
              'Identity Imported',
              'Your identity has been successfully transferred to this device.',
              [
                {
                  text: 'OK',
                  onPress: () => {
                    // Navigate to notifications step (similar to backup import flow)
                    router.replace('/(auth)/import-identity/notifications');
                  },
                },
              ]
            );
          } catch (importError: any) {
            alert(
              'Import Failed',
              importError?.message || 'Failed to import identity. Please check the QR code and try again.',
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
  }, [scanned, router, alert, importIdentity]);

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
});

