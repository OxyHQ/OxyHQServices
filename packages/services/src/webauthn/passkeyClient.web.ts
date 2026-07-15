/**
 * Passkey / WebAuthn ceremony client — WEB implementation.
 *
 * The browser half of the passkey flow: it drives `navigator.credentials`
 * through `@simplewebauthn/browser`, turning the OPAQUE options the server
 * emitted (`OxyServices.webauthn{Register,Login}Options`) into the opaque
 * response the matching `verify` endpoint consumes. Oxy never owns those wire
 * shapes — `@simplewebauthn/browser` does — so options flow in as `unknown` and
 * the single cast at this boundary hands them to the library's own types.
 *
 * This file is selected ONLY on web (react-native-web / Vite RNW): the sibling
 * `passkeyClient.native.ts` + the clean default `passkeyClient.ts` deliberately
 * do NOT import `@simplewebauthn/browser` (a browser-only dependency), per the
 * platform-split rule. Native passkeys are Commons' job — there is no WebAuthn
 * ceremony off the web.
 */

import {
  startRegistration,
  startAuthentication,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/browser';

/**
 * True iff this browser can run a WebAuthn ceremony (exposes the
 * `PublicKeyCredential` global). Gate all passkey UI/entrypoints on this so an
 * unsupported browser fails loudly rather than throwing mid-ceremony.
 */
export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';
}

/**
 * Run the WebAuthn REGISTRATION ceremony (`navigator.credentials.create`) from
 * the server's opaque creation options, returning the opaque attestation
 * response for `OxyServices.webauthnRegisterVerify`.
 */
export async function runRegistrationCeremony(
  optionsJSON: unknown,
): Promise<RegistrationResponseJSON> {
  return startRegistration({ optionsJSON: optionsJSON as PublicKeyCredentialCreationOptionsJSON });
}

/**
 * Run the WebAuthn AUTHENTICATION ceremony (`navigator.credentials.get`) from
 * the server's opaque request options, returning the opaque assertion response
 * for `OxyServices.webauthnLoginVerify`.
 */
export async function runAuthenticationCeremony(
  optionsJSON: unknown,
): Promise<AuthenticationResponseJSON> {
  return startAuthentication({ optionsJSON: optionsJSON as PublicKeyCredentialRequestOptionsJSON });
}
