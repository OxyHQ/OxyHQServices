/**
 * Passkey / WebAuthn ceremony client — clean default (non-web) implementation.
 *
 * This is the base module TypeScript resolves for TYPES and any bundler that
 * does not pick a platform variant. It intentionally imports NOTHING browser-
 * specific (no `@simplewebauthn/browser`) so it stays safe for Metro, native
 * builds, and SSR. The real ceremony lives in `passkeyClient.web.ts`; native
 * passkeys are Commons' job, so there is no WebAuthn ceremony here.
 *
 * `isPasskeySupported()` returns `false` (no relying-party origin / no browser
 * WebAuthn API), and the ceremony helpers throw a clear error so a caller that
 * skipped the support gate fails loudly instead of silently.
 */

const WEBAUTHN_WEB_ONLY_MESSAGE =
  'WebAuthn is web-only; native uses Commons. Passkeys are not available on this platform.';

/** Always `false` off the web — there is no relying-party origin or WebAuthn API. */
export function isPasskeySupported(): boolean {
  return false;
}

/** Not available off the web — throws. Guard with {@link isPasskeySupported} first. */
export async function runRegistrationCeremony(_optionsJSON: unknown): Promise<unknown> {
  throw new Error(WEBAUTHN_WEB_ONLY_MESSAGE);
}

/** Not available off the web — throws. Guard with {@link isPasskeySupported} first. */
export async function runAuthenticationCeremony(_optionsJSON: unknown): Promise<unknown> {
  throw new Error(WEBAUTHN_WEB_ONLY_MESSAGE);
}
