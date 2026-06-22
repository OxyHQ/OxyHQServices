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
 * reliable scanning regardless of the app theme.
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from '@oxyhq/bloom/theme';

export interface AnotherDeviceQRProps {
  /** The QR payload (`oxyauth://<token>`). Empty string renders nothing. */
  qrData: string;
}

/** Size, in px, of the rendered QR symbol. */
const QR_SIZE = 200;

/**
 * Collapsed disclosure that reveals a high-contrast QR for signing in on a
 * second device with the Oxy Accounts app.
 */
const AnotherDeviceQR: React.FC<AnotherDeviceQRProps> = ({ qrData }) => {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  if (!qrData) {
    return null;
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.toggle}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityHint="Reveals a QR code to sign in using the Oxy Accounts app on another device"
      >
        <Text style={styles.toggleText} className="text-muted-foreground">
          Sign in on another device
        </Text>
        <Text style={styles.chevron} className="text-muted-foreground">
          {expanded ? '✕' : '›'}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          {/* The QR plate is intentionally white for scan reliability. */}
          <View style={[styles.qrPlate, { backgroundColor: '#FFFFFF' }]}>
            <QRCode value={qrData} size={QR_SIZE} backgroundColor="#FFFFFF" color="#000000" />
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Scan with the Oxy Accounts app
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 16,
    marginLeft: 8,
  },
  body: {
    alignItems: 'center',
    marginTop: 8,
  },
  qrPlate: {
    padding: 16,
    borderRadius: 16,
  },
  hint: {
    marginTop: 12,
    fontSize: 12,
    textAlign: 'center',
  },
});

export default AnotherDeviceQR;
