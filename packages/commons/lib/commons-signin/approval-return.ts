/**
 * What Commons does AFTER a successful "Sign in with Oxy" approval.
 *
 *   'return-to-caller' — background Commons so the OS returns to the app/site
 *                        that launched it. Only possible on Android, and only
 *                        for the same-device deep-link handoff (Commons was
 *                        foregrounded by the caller's intent).
 *   'close'            — dismiss the sheet and stay in Commons. Used for the
 *                        cross-device QR scanner path (there is no caller to
 *                        return to on THIS device) and on iOS, where no
 *                        programmatic backgrounding exists.
 */
export type ApprovedAction = 'return-to-caller' | 'close';

/** Threaded by the in-app scanner so we can tell it apart from a deep link. */
export const SCANNER_SOURCE = 'scanner';

/**
 * Decide the post-approval behavior.
 *
 * The discriminator is the explicit `source` route param — the scanner threads
 * `source=scanner` when it `replace`s into the approval route; an external deep
 * link (`oxycommons://approve?…` / `commons://approve?…`) never carries it. We
 * do NOT infer the path from navigation history (ambiguous on warm launches).
 *
 * @param source     - The `source` route param (`'scanner'` for the in-app scanner).
 * @param platformOS - `Platform.OS` of the running device.
 */
export function resolveApprovedAction(
  source: string | undefined,
  platformOS: string,
): ApprovedAction {
  const fromScanner = source === SCANNER_SOURCE;
  // A same-device deep-link handoff on Android is the only case where a caller
  // exists on THIS device AND the OS can return to it (by backgrounding us).
  if (!fromScanner && platformOS === 'android') {
    return 'return-to-caller';
  }
  return 'close';
}
