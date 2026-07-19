import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import { parseScan, type ScanResult } from '@/lib/commons-signin/parse-scan';
import { useNfcReader } from '@/hooks/nfc/useNfcReader';
import { useAttestFlow } from '@/hooks/civic/useAttestFlow';

/**
 * QR scanner for the Commons handoffs (approver / verifier side).
 *
 * `parseScan` branches the scanned string into one of three Commons payloads:
 *   - a "Sign in with Oxy" approval (`oxycommons://approve?code=…`) → the
 *     `/approve` flow, which re-resolves the requesting app identity server-side
 *   - a citizen Oxy ID card (`oxycommons://card?did=…`) → the `(id)/card` view,
 *     which resolves and verifies the signed card server-side
 *   - a real-life attestation (`oxycommons://attest?…`) → signed and submitted
 *     AUTOMATICALLY on the scan/NFC event (no confirm step, no biometric) and
 *     rendered inline over the frozen camera: Confirming… → ✓ Verified
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
  const { available: nfcAvailable, readOnce } = useNfcReader();
  const [nfcReading, setNfcReading] = useState(false);
  const attest = useAttestFlow();
  // Gates the attest overlay to a flow THIS screen session started, so stale
  // store state from an earlier session can never surface over a fresh camera.
  const [attestActive, setAttestActive] = useState(false);

  // Shared routing for anything `parseScan` can resolve, regardless of
  // whether the raw string came from the camera or an NFC read.
  const routeParsed = useCallback(
    (parsed: ScanResult) => {
      // `replace` so the hardware back button doesn't return to the camera.
      if (parsed.kind === 'approval') {
        // Approval lives at the ROOT (`/approve`, a transparentModal) — NOT in
        // this `(scan)` fullScreenModal group — so the sheet rises over the real
        // context (the `(tabs)` anchor) instead of an opaque group card.
        // `replace` from the camera dismisses this modal and presents `/approve`.
        // `source: 'scanner'` marks the cross-device QR path so approval stays in
        // Commons on success (an external deep link omits it and, on Android,
        // returns to the caller instead).
        router.replace({ pathname: '/approve', params: { code: parsed.code, source: 'scanner' } });
        return;
      }
      if (parsed.kind === 'id') {
        router.replace({ pathname: '/(tabs)/(id)/card/[did]', params: { did: parsed.did } });
        return;
      }
      if (parsed.kind === 'attest') {
        // Real-life attestation: signed + submitted AUTOMATICALLY on the scan/
        // NFC event — no confirm step, no biometric. Rendered inline over the
        // frozen camera. The server upserts idempotently, so re-confirming the
        // same person is fine.
        setScanned(true); // the NFC path hasn't frozen the camera yet
        setAttestActive(true);
        attest.submit({
          subjectDid: parsed.subjectDid,
          context: parsed.context,
          nonce: parsed.nonce,
          exp: parsed.exp,
        });
        return;
      }
      // Freeze the camera behind the error overlay for BOTH entry paths (the
      // barcode handler already set `scanned`; an NFC-triggered invalid parse
      // hasn't) so "Scan Again" resets the same state either way.
      setScanned(true);
      setScanError(parsed.reason);
    },
    [router, attest.submit],
  );

  const handleBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (scanned) return;
      setScanned(true);
      routeParsed(parseScan(data));
    },
    [scanned, routeParsed],
  );

  // `useNfcReader` already no-ops concurrent calls (module-level busy guard →
  // `{ok:false, reason:'cancelled'}`); `nfcReading` is caller-side defense in
  // depth plus the pending visual on the button.
  const handleNfcRead = useCallback(async () => {
    if (nfcReading) return;
    setNfcReading(true);
    try {
      const read = await readOnce();
      if (!read.ok) return; // cancelled/empty — stay on the scanner
      routeParsed(parseScan(read.uri));
    } finally {
      setNfcReading(false);
    }
  }, [nfcReading, readOnce, routeParsed]);

  const handleScanAgain = useCallback(() => {
    attest.reset();
    setAttestActive(false);
    setScanError(null);
    setScanned(false);
  }, [attest.reset]);

  const handleClose = useCallback(() => {
    // Leaving the scanner ends the current attest flow; an in-flight submit is
    // simply abandoned (the store ignores its late completion).
    attest.reset();
    if (router.canGoBack()) {
      // Dismiss the scanner modal back to whatever presented it (the ID tab).
      router.back();
    } else {
      // No history (e.g. cold deep link) — land on the ID home, not the camera.
      router.replace('/(tabs)/(id)');
    }
  }, [attest.reset, router]);

  const toggleFlash = useCallback(() => setFlashOn((prev) => !prev), []);

  const openSettings = useCallback(() => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:').catch(() => undefined);
    } else {
      Linking.openSettings().catch(() => undefined);
    }
  }, []);

  // A's name from the server-resolved card (never from the QR). May still be
  // resolving during the brief `submitting` window — the copy waits for it.
  const attestName = attest.subject?.card.name ?? '';

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
                <View style={styles.controlsRow}>
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
                  {nfcAvailable && (
                    <TouchableOpacity
                      style={styles.controlButton}
                      onPress={handleNfcRead}
                      disabled={nfcReading}
                      accessibilityRole="button"
                      accessibilityLabel={t('civic.nfc.read')}
                      accessibilityState={{ disabled: nfcReading, busy: nfcReading }}
                    >
                      {nfcReading ? (
                        <ActivityIndicator size="small" color="#fff" style={styles.controlSpinner} />
                      ) : (
                        <MaterialCommunityIcons name="nfc" size={28} color="#fff" />
                      )}
                      <Text style={styles.controlText}>{t('civic.nfc.read')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>
        </View>

        {attestActive && (
          <View style={[StyleSheet.absoluteFill, styles.attestOverlay]}>
            {attest.status === 'submitting' && (
              <>
                <ActivityIndicator size="large" color="#fff" />
                {attestName !== '' && (
                  <Text style={styles.attestBody}>
                    {t('civic.attest.confirm.submitting', { name: attestName })}
                  </Text>
                )}
              </>
            )}
            {attest.status === 'done' && attest.result && (
              <>
                <MaterialCommunityIcons name="check-decagram" size={72} color={colors.success} />
                <Text style={styles.attestTitle}>{t('civic.attest.confirm.done.title')}</Text>
                <Text style={styles.attestBody}>
                  {t('civic.attest.confirm.done.body', { name: attestName, points: attest.result.points })}
                </Text>
                <TouchableOpacity
                  style={[styles.button, styles.attestDoneButton, { backgroundColor: colors.tint }]}
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.done')}
                >
                  <Text style={styles.buttonText}>{t('common.done')}</Text>
                </TouchableOpacity>
              </>
            )}
            {attest.status === 'error' && (
              <>
                <MaterialCommunityIcons name="alert-circle-outline" size={72} color={colors.error} />
                <Text style={styles.attestTitle}>{t('civic.attest.confirm.error.title')}</Text>
                <Text style={styles.attestBody}>
                  {t(`civic.attest.error.${attest.errorCode ?? 'generic'}`)}
                </Text>
                <TouchableOpacity
                  style={[styles.controlButton, styles.attestRetryButton]}
                  onPress={handleScanAgain}
                  accessibilityRole="button"
                  accessibilityLabel={t('signInApproval.scan.a11y.scanAgain')}
                >
                  <MaterialCommunityIcons name="refresh" size={28} color="#fff" />
                  <Text style={styles.controlText}>{t('signInApproval.scan.scanAgain')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

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
  controlsRow: {
    flexDirection: 'row',
    gap: 32,
  },
  controlSpinner: {
    // Matches the 28dp icon slot so the pending swap doesn't shift layout.
    height: 28,
  },
  controlButton: {
    alignItems: 'center',
    gap: 8,
  },
  controlText: {
    color: '#fff',
    fontSize: 12,
  },
  attestOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  attestTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  attestBody: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
  },
  attestDoneButton: {
    marginTop: 8,
    marginBottom: 0,
  },
  attestRetryButton: {
    marginTop: 8,
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
