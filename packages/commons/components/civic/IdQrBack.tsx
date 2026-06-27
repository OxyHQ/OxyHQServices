import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

interface IdQrBackProps {
  /** The Oxy ID QR payload (`oxycommons://card?did=…&v=1`) to encode. */
  payload: string;
  /** Localized caption shown under the QR (e.g. "Scan to verify with Oxy"). */
  caption: string;
}

/**
 * Back side of the flippable Oxy ID card: a QR code of the user's ID payload.
 *
 * The payload encodes ONLY the DID (no trust data) — a scanner resolves and
 * re-verifies the signed card server-side. Rendered on a light card face to
 * match the OxyID front; the parent `Ticket` already compensates for the 180°
 * flip (`scaleX: -1`) so the QR reads in the correct orientation.
 */
export function IdQrBack({ payload, caption }: IdQrBackProps) {
  return (
    <View style={styles.container}>
      <View style={styles.qrWrapper}>
        <QRCode value={payload} size={128} color="#1C1C1E" backgroundColor="transparent" />
      </View>
      <Text style={styles.caption} numberOfLines={2}>
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  qrWrapper: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  caption: {
    color: '#3A3A3C',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
});
