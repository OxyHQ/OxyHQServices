import { StyleSheet } from 'react-native';

/** High-contrast QR plate background — kept in sync with `OxyAuthChooser`'s QR colors. */
const QR_PLATE_BG = '#FFFFFF';

/**
 * Shared styles for `OxyAuthChooser`'s views. Extracted from `OxyAccountDialogScreen`
 * so both the Dialog-wrapped host and any bare host (e.g. a future
 * auth.oxy.so hub page) render identically without duplicating a StyleSheet.
 */
export const authChooserStyles = StyleSheet.create({
  rows: {
    width: '100%',
    gap: 8,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rowDisabled: {
    opacity: 0.6,
  },
  avatarRing: {
    borderRadius: 9999,
    borderWidth: 2,
    padding: 1,
  },
  rowMeta: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowHandle: {
    fontSize: 12.5,
    marginTop: 1,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  addBadge: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLinks: {
    alignItems: 'center',
    marginTop: 16,
  },
  footerLink: {
    alignSelf: 'center',
    paddingVertical: 10,
    marginTop: 12,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  signInBlock: {
    width: '100%',
  },
  primaryButton: {
    width: '100%',
    borderRadius: 14,
    marginTop: 8,
  },
  secondaryButton: {
    width: '100%',
    borderRadius: 14,
    marginTop: 10,
  },
  usernameInput: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    marginTop: 8,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  mutedText: {
    fontSize: 14,
    textAlign: 'center',
  },
  qrHeadline: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  qrPlate: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: QR_PLATE_BG,
  },
});
