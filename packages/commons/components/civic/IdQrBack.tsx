import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { LogoIcon } from '@oxyhq/services';

interface IdQrBackProps {
  /** The Oxy ID QR payload (`oxycommons://card?did=…&v=1`) to encode. */
  payload: string;
  /** Localized caption shown under the QR (e.g. "Scan to verify with Oxy"). */
  caption: string;
}

/**
 * Back side of the flippable Oxy ID card: a QR of the user's ID payload, laid
 * out like the front — an issuer header, the QR in a framed "verification zone",
 * and a footer note — so both faces read as one official document.
 *
 * The payload encodes ONLY the DID (no trust data) — a scanner resolves and
 * re-verifies the signed card server-side. The parent `Ticket` already
 * compensates for the 180° flip (`scaleX: -1`) so this reads upright.
 */
export function IdQrBack({ payload, caption }: IdQrBackProps) {
  return (
    <View style={styles.container}>
      {/* Header — mirrors the front. */}
      <View style={styles.header}>
        <LogoIcon height={20} />
        <Text style={styles.docType}>VERIFY</Text>
      </View>

      {/* Verification zone. */}
      <View style={styles.qrZone}>
        <View style={styles.qrFrame}>
          <QRCode value={payload} size={150} color="#1C1C1E" backgroundColor="transparent" />
        </View>
        <Text style={styles.caption} numberOfLines={2}>
          {caption}
        </Text>
      </View>

      {/* Footer note. */}
      <View style={styles.footer}>
        <Text style={styles.footerStrong}>SIGNED · SELF-CUSTODY IDENTITY</Text>
        <Text style={styles.footerNote}>Resolves & verifies on the Oxy network</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 18,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.18)',
    paddingBottom: 6,
  },
  docType: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.2,
    color: '#6E6E73',
  },
  qrZone: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  qrFrame: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  caption: {
    color: '#3A3A3C',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.18)',
    paddingTop: 8,
    gap: 2,
  },
  footerStrong: {
    color: '#2B2B2E',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  footerNote: {
    color: '#6E6E73',
    fontSize: 9,
    letterSpacing: 0.3,
  },
});
