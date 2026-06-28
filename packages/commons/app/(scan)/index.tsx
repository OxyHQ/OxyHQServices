import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import { parseScan } from '@/lib/commons-signin/parse-scan';

/**
 * QR scanner for the Commons handoffs (approver / verifier side).
 *
 * `parseScan` branches the scanned string into one of two Commons payloads:
 *   - a "Sign in with Oxy" approval (`oxycommons://approve?code=…`) → the
 *     `/approve` flow, which re-resolves the requesting app identity server-side
 *   - a citizen Oxy ID card (`oxycommons://card?did=…`) → the `(id)/card` view,
 *     which resolves and verifies the signed card server-side
 *
 * The QR is never trusted for display — only the opaque `code` / `did` it
 * carries is used, and both are re-resolved server-side.
 */
export default function ScanSignInScreen() {
  const router = useRouter();
  const colors = useColors();
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [scanError, setScanError] = useState<'invalid' | 'expired' | null>(null);

  const handleBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (scanned) return;
      setScanned(true);

      const parsed = parseScan(data);
      // `replace` so the hardware back button doesn't return to the camera.
      if (parsed.kind === 'approval') {
        router.replace({ pathname: '/(scan)/approve', params: { code: parsed.code } });
        return;
      }
      if (parsed.kind === 'id') {
        router.replace({ pathname: '/(tabs)/(id)/card/[did]', params: { did: parsed.did } });
        return;
      }
      if (parsed.kind === 'attest') {
        router.replace({
          pathname: '/(scan)/attest',
          params: {
            subjectDid: parsed.subjectDid,
            context: parsed.context,
            nonce: parsed.nonce,
            exp: String(parsed.exp),
          },
        });
        return;
      }
      setScanError(parsed.reason);
    },
    [scanned, router],
  );

  const handleScanAgain = useCallback(() => {
    setScanError(null);
    setScanned(false);
  }, []);

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      // Dismiss the scanner modal back to whatever presented it (the ID tab).
      router.back();
    } else {
      // No history (e.g. cold deep link) — land on the ID home, not the camera.
      router.replace('/(tabs)/(id)');
    }
  }, [router]);

  const toggleFlash = useCallback(() => setFlashOn((prev) => !prev), []);

  const openSettings = useCallback(() => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:').catch(() => undefined);
    } else {
      Linking.openSettings().catch(() => undefined);
    }
  }, []);

  // Permission not determined yet
  if (!permission) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.text, { color: colors.text }]}>
          {t('signInApproval.scan.requestingPermission')}
        </Text>
      </View>
    );
  }

  // Permission denied
  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <MaterialCommunityIcons name="camera-off" size={64} color={colors.textSecondary} style={styles.icon} />
        <Text style={[styles.title, { color: colors.text }]}>{t('signInApproval.scan.permissionTitle')}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('signInApproval.scan.permissionBody')}
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.tint }]}
          onPress={requestPermission}
          accessibilityRole="button"
          accessibilityLabel={t('signInApproval.scan.a11y.grantPermission')}
        >
          <Text style={styles.buttonText}>{t('signInApproval.scan.grantPermission')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkButton}
          onPress={openSettings}
          accessibilityRole="button"
          accessibilityLabel={t('signInApproval.scan.a11y.openSettings')}
        >
          <Text style={[styles.linkText, { color: colors.tint }]}>{t('signInApproval.scan.openSettings')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkButton}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel={t('signInApproval.scan.a11y.cancel')}
        >
          <Text style={[styles.linkText, { color: colors.textSecondary }]}>{t('signInApproval.scan.cancel')}</Text>
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
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
      >
        <View style={styles.overlay}>
          <View style={styles.overlaySection} />
          <View style={styles.middleSection}>
            <View style={styles.overlaySection} />
            <View style={styles.scannerFrame}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
            </View>
            <View style={styles.overlaySection} />
          </View>
          <View style={[styles.overlaySection, styles.bottomSection]}>
            {scanError ? (
              <>
                <Text style={styles.errorText}>
                  {scanError === 'expired'
                    ? t('signInApproval.scan.expiredBody')
                    : t('signInApproval.scan.invalidBody')}
                </Text>
                <TouchableOpacity
                  style={styles.controlButton}
                  onPress={handleScanAgain}
                  accessibilityRole="button"
                  accessibilityLabel={t('signInApproval.scan.a11y.scanAgain')}
                >
                  <MaterialCommunityIcons name="refresh" size={28} color="#fff" />
                  <Text style={styles.controlText}>{t('signInApproval.scan.scanAgain')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.instructionText}>{t('signInApproval.scan.instructions')}</Text>
                <TouchableOpacity
                  style={styles.controlButton}
                  onPress={toggleFlash}
                  accessibilityRole="button"
                  accessibilityLabel={
                    flashOn ? t('signInApproval.scan.a11y.flashOff') : t('signInApproval.scan.a11y.flashOn')
                  }
                  accessibilityState={{ selected: flashOn }}
                >
                  <MaterialCommunityIcons name={flashOn ? 'flash' : 'flash-off'} size={28} color="#fff" />
                  <Text style={styles.controlText}>
                    {flashOn ? t('signInApproval.scan.flashOn') : t('signInApproval.scan.flashOff')}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel={t('signInApproval.scan.a11y.close')}
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
  centered: {
    padding: 32,
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
  cornerTopLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  cornerTopRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  cornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  cornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
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
    marginBottom: 24,
  },
  errorText: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 32,
    marginBottom: 24,
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
    borderRadius: 16,
    borderCurve: 'continuous',
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
