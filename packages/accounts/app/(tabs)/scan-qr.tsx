import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

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
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  // Handle barcode scan
  const handleBarCodeScanned = useCallback(({ data }: BarcodeScanningResult) => {
    if (scanned) return;
    setScanned(true);

    // Expected formats:
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
      Alert.alert(
        'Invalid QR Code',
        'This QR code is not a valid Oxy authorization request.',
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
  }, [scanned, router]);

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
          color={colors.textSecondary}
          style={styles.icon}
        />
        <Text style={[styles.title, { color: colors.text }]}>
          Camera Access Required
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          To scan QR codes for sign-in authorization, we need access to your camera.
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={requestPermission}
        >
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.linkButton]}
          onPress={openSettings}
        >
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Open Settings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.linkButton]}
          onPress={handleClose}
        >
          <Text style={[styles.linkText, { color: colors.textSecondary }]}>
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
              Scan the QR code shown in the app you want to sign in to
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

