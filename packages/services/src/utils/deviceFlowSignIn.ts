/**
 * Shared, pure orchestration for completing the cross-app device-flow sign-in
 * (the QR-code / "Open Oxy Auth" path used on native and web).
 *
 * THE FIRST BUG THIS FIXES (native): once another authenticated device
 * approves the pending AuthSession, the originating client is notified
 * (socket / poll / deep-link) with the authorized `sessionId`. Before any
 * session-management code can use it, the client MUST exchange the secret
 * 128-bit `sessionToken` (held only by this client, generated for THIS flow)
 * for the first access token via `claimSessionByToken` — the device-flow
 * equivalent of OAuth's code-for-token exchange (RFC 8628 §3.4).
 *
 * THE SECOND BUG THIS FIXES (session-sync cutover regression): the
 * freshly-claimed session is NOT yet registered in the device's
 * server-authoritative session set — nothing has run
 * `sessionClient.addCurrentAccount()` for it — so it must NOT be committed
 * through `switchSession`. That path is now an account-SWITCH between
 * accounts already registered on this device (`OxyContext`'s
 * `switchSessionForContext`), and throws `No device account found for
 * session "..."` for anything else, surfacing as "Authorization successful
 * but failed to complete sign in." Instead the claimed session must be
 * committed through the SAME path a fresh password sign-in uses —
 * `useOxy().handleWebSession` (`OxyContext`'s `handleWebSSOSession`) — which
 * registers the account into the device set, persists it durably, and
 * hydrates the full user profile.
 *
 * Skipping the claim leaves the SDK with NO bearer token: the session is
 * authorized server-side but the app never becomes authenticated and the UI
 * sits "Waiting for authorization..." forever. Consolidating the
 * claim->commit sequence here keeps native and web identical and
 * unit-testable.
 */

import { KeyManager, type MinimalUserData, type SessionLoginResponse, type User } from '@oxyhq/core';

interface DeviceFlowClaimResult {
  accessToken?: string;
  sessionId?: string;
  deviceId?: string;
  expiresAt?: string;
  user?: User;
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
   * `useOxy().handleWebSession` — commits the freshly-claimed session into
   * context state through the SAME path a password sign-in uses:
   * registers the account into the device's server-authoritative session set,
   * persists it durably, and hydrates the full user profile. Runs AFTER the
   * bearer is planted so its bearer-protected calls succeed.
   */
  commitSession: (session: SessionLoginResponse) => Promise<void>;
}

/**
 * Complete a device-flow sign-in: claim the first access token with the secret
 * `sessionToken` (planting the bearer), then commit the resulting session via
 * `commitSession` (registers it into the device's server-authoritative session
 * set and hydrates the full user). Returns the authenticated user.
 *
 * Throws if the claim did not return a usable session, or if either the claim
 * or the commit fails; callers surface a retry UI.
 */
export async function completeDeviceFlowSignIn({
  oxyServices,
  sessionId,
  sessionToken,
  commitSession,
}: CompleteDeviceFlowSignInOptions): Promise<User> {
  // 1) Plant the bearer + refresh tokens. The claim response is also persisted
  //    to native shared secure storage so a later cold boot has a bearer before
  //    it validates stored sessions. On web this is a no-op.
  const claimed = await oxyServices.claimSessionByToken(sessionToken);
  if (claimed?.accessToken) {
    await KeyManager.storeSharedSession(claimed.sessionId || sessionId, claimed.accessToken);
  }

  if (!claimed?.accessToken || !claimed.user) {
    throw new Error('Device-flow claim did not return a usable session');
  }

  // `SessionLoginResponse.user` is the minimal session-carried shape (avatar
  // is `string | undefined`); the claim response returns the full `User`
  // (avatar is `string | null | undefined`). Normalize rather than widening
  // `SessionLoginResponse.user` to accept `null`.
  const minimalUser: MinimalUserData = {
    id: claimed.user.id,
    username: claimed.user.username,
    name: claimed.user.name,
    avatar: claimed.user.avatar ?? undefined,
  };

  // 2) Bearer is now planted — commit the session through the same path a
  //    fresh sign-in uses so it is registered into the device's
  //    server-authoritative session set instead of an account switch.
  await commitSession({
    sessionId: claimed.sessionId || sessionId,
    deviceId: claimed.deviceId ?? '',
    expiresAt: claimed.expiresAt ?? '',
    user: minimalUser,
    accessToken: claimed.accessToken,
  });

  return claimed.user;
}
