/**
 * Shared, pure orchestration for completing the cross-app device-flow sign-in
 * (the QR-code / "Open Oxy Auth" path used on native and web).
 *
 * THE BUG THIS FIXES (native): once another authenticated device approves the
 * pending AuthSession, the originating client is notified (socket / poll /
 * deep-link) with the authorized `sessionId`. Before any session-management
 * code can use it, the client MUST exchange the secret 128-bit `sessionToken`
 * (held only by this client, generated for THIS flow) for the first access
 * token via `claimSessionByToken` — the device-flow equivalent of OAuth's
 * code-for-token exchange (RFC 8628 §3.4).
 *
 * Skipping the claim leaves the SDK with NO bearer token: the session is
 * authorized server-side but the app never becomes authenticated and the UI
 * sits "Waiting for authorization..." forever. Consolidating the claim→switch
 * sequence here keeps native and web identical and unit-testable.
 */

import { KeyManager, type User } from '@oxyhq/core';

interface DeviceFlowClaimResult {
  accessToken?: string;
  sessionId?: string;
}

/**
 * The minimal `OxyServices` surface this orchestration needs. Kept as a
 * structural type (rather than importing the full client) so the helper is
 * trivially unit-testable with a stub and never pulls the RN/Expo runtime into
 * a test bundle.
 */
export interface DeviceFlowClient {
  /**
   * Exchange the device-flow `sessionToken` for the first access + refresh
   * token, planting them on the client. Single-use; replay is rejected by the
   * API. No bearer required — the high-entropy `sessionToken` IS the credential.
   */
  claimSessionByToken: (sessionToken: string) => Promise<DeviceFlowClaimResult | undefined>;
}

export interface CompleteDeviceFlowSignInOptions {
  /** The OxyServices client (or any object exposing `claimSessionByToken`). */
  oxyServices: DeviceFlowClient;
  /** The authorized device session id, delivered by the socket / poll / link. */
  sessionId: string;
  /**
   * The secret `sessionToken` generated for THIS flow and registered via
   * `POST /auth/session/create`. Required to claim the first access token.
   */
  sessionToken: string;
  /**
   * The session-management `switchSession` from `useOxy()`. Hydrates the
   * activated session (validates, fetches the user, persists, updates state).
   * Runs AFTER the bearer is planted so its bearer-protected calls succeed.
   */
  switchSession: (sessionId: string) => Promise<User>;
}

/**
 * Complete a device-flow sign-in: claim the first access token with the secret
 * `sessionToken` (planting the bearer), then hydrate the session via
 * `switchSession`. Returns the authenticated user.
 *
 * Throws if either the claim or the switch fails; callers surface a retry UI.
 */
export async function completeDeviceFlowSignIn({
  oxyServices,
  sessionId,
  sessionToken,
  switchSession,
}: CompleteDeviceFlowSignInOptions): Promise<User> {
  // 1) Plant the bearer + refresh tokens. The claim response is also persisted
  //    to native shared secure storage so a later cold boot has a bearer before
  //    it validates stored sessions. On web this is a no-op.
  const claimed = await oxyServices.claimSessionByToken(sessionToken);
  if (claimed?.accessToken) {
    await KeyManager.storeSharedSession(claimed.sessionId || sessionId, claimed.accessToken);
  }

  // 2) Bearer is now planted — hydrate the session through the normal path.
  return switchSession(sessionId);
}
