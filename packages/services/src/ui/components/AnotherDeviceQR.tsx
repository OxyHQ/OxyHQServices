/**
 * AnotherDeviceQR — the collapsed "Sign in on another device" disclosure shared
 * by both sign-in containers (`SignInModal` on web, `OxyAuthScreen` on native).
 *
 * The QR code is always DEMOTED below the platform-primary "Continue with Oxy"
 * action: you cannot scan your own screen, so the QR is only useful for handing
 * sign-in to a SECOND device (scan with the Oxy Accounts app there). It lives
 * inside a tap-to-expand disclosure so it never competes with the primary CTA.
 *
 * The QR plate stays white intentionally — high contrast is required for
 * reliable scanning regardless of the app theme. That single plate (and its
 * fixed dimensions) is the only StyleSheet/hardcoded-color in this component;
 * everything else is composed from Bloom typography + centralized token classes.
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from '@oxyhq/bloom/theme';
import { Text } from '@oxyhq/bloom/typography';
import * as Icons from '@oxyhq/bloom/icons';

export interface AnotherDeviceQRProps {
  /** The legacy QR payload (`oxyauth://<token>`). Empty string renders nothing. */
  qrData: string;
  /**
   * The secure "Sign in with Oxy" handoff payload (`oxycommons://approve?...`).
   * Preferred over `qrData` when present — it carries the PUBLIC authorize code
   * (never the secret session token), so the Oxy identity app on another device
   * can scan it to approve. Falls back to `qrData` when the handoff backend has
   * not returned a payload.
   */
  qrPayload?: string | null;
}

/** Size, in px, of the rendered QR symbol. */
const QR_SIZE = 200;

/** High-contrast QR colors — intentionally fixed (NOT themed) for scan reliability. */
const QR_PLATE_BG = '#FFFFFF';
const QR_FOREGROUND = '#000000';

/**
 * Collapsed disclosure that reveals a high-contrast QR for signing in on a
 * second device with the Oxy Accounts app.
 */
const AnotherDeviceQR: React.FC<AnotherDeviceQRProps> = ({ qrData, qrPayload }) => {
  const bloomTheme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  // Prefer the secure handoff payload (public authorize code) over the legacy
  // token QR; fall back to `qrData` until the handoff backend is available.
  const value = qrPayload || qrData;

  if (!value) {
    return null;
  }

  return (
    <View className="w-full items-center">
      <TouchableOpacity
        className="flex-row items-center justify-center gap-space-8 py-space-12 px-space-8"
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityHint="Reveals a QR code to sign in using the Oxy Accounts app on another device"
      >
        <Icons.QrCode_Stroke2_Corner0_Rounded
          size="sm"
          style={{ color: bloomTheme.colors.textSecondary }}
        />
        <Text className="font-sansSemibold text-body text-text-secondary">
          Sign in on another device
        </Text>
        {expanded ? (
          <Icons.ChevronTop_Stroke2_Corner0_Rounded
            size="sm"
            style={{ color: bloomTheme.colors.textSecondary }}
          />
        ) : (
          <Icons.ChevronRight_Stroke2_Corner0_Rounded
            size="sm"
            style={{ color: bloomTheme.colors.textSecondary }}
          />
        )}
      </TouchableOpacity>

      {expanded && (
        <View className="items-center mt-space-8 gap-space-12">
          {/* The QR plate is intentionally white for scan reliability. */}
          <View style={styles.qrPlate}>
            <QRCode value={value} size={QR_SIZE} backgroundColor={QR_PLATE_BG} color={QR_FOREGROUND} />
          </View>
          <Text className="font-sans text-caption text-text-tertiary text-center">
            Scan with the Oxy app
          </Text>
        </View>
      )}
    </View>
  );
};

// Measured/positioned layout only (no theming): the high-contrast QR plate keeps
// a fixed white background + padding so the symbol scans reliably regardless of
// the app theme. This is the single intentional non-token surface in the file.
const styles = StyleSheet.create({
  qrPlate: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: QR_PLATE_BG,
  },
});

export default AnotherDeviceQR;
