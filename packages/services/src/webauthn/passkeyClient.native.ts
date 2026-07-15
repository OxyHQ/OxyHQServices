/**
 * Passkey / WebAuthn ceremony client — NATIVE implementation.
 *
 * React Native has no browser WebAuthn API, and Oxy's native passkey story is
 * Commons (shared-keychain / QR handoff), NOT `navigator.credentials`. So this
 * variant imports NOTHING browser-specific and mirrors the clean default:
 * unsupported, and the ceremony helpers throw if a caller skipped the gate.
 */

const WEBAUTHN_WEB_ONLY_MESSAGE =
  'WebAuthn is web-only; native uses Commons. Passkeys are not available on this platform.';

/** Always `false` on native — there is no browser WebAuthn API. */
export function isPasskeySupported(): boolean {
  return false;
}

/** Not available on native — throws. Guard with {@link isPasskeySupported} first. */
export async function runRegistrationCeremony(_optionsJSON: unknown): Promise<unknown> {
  throw new Error(WEBAUTHN_WEB_ONLY_MESSAGE);
}

/** Not available on native — throws. Guard with {@link isPasskeySupported} first. */
export async function runAuthenticationCeremony(_optionsJSON: unknown): Promise<unknown> {
  throw new Error(WEBAUTHN_WEB_ONLY_MESSAGE);
}
