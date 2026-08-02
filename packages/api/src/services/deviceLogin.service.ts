/**
 * Device-first login finalization — shared across the first-party auth flows
 * (`/auth/login`, `/auth/signup`, `/auth/verify`, `/security/2fa/verify-login`).
 *
 * ADD-ONLY: registers the freshly-credentialed session into its device's set
 * WITHOUT stealing the active account (`activate: 'if-empty'`), and mints the
 * rotating `deviceSecret` the client persists first-party. The client presents
 * `deviceId` + `deviceSecret` at `POST /session/device/token` to restore the
 * session (zero-cookie transport); the secret is the SOLE restore credential.
 *
 * `deviceSession.service` is imported LAZILY (only when finalizing a sign-in) so
 * that merely importing this helper — which the hot auth controllers do at module
 * load — never forces the `DeviceSession` Mongoose model to evaluate. This matches
 * the existing `session.service` lazy-`import('./account.service.js')` convention
 * and keeps unit tests that mock only the models they touch working unchanged.
 */

import { broadcastDeviceState } from '../utils/socket';
import { logger } from '../utils/logger';

/**
 * Finalize a fresh sign-in for the device-first lane: register the session into
 * its device's set (add-only, never flips active) + broadcast, and mint the
 * rotating `deviceSecret` for the response. Everything is best-effort — a failure
 * here never breaks the sign-in.
 *
 * Returns `{ deviceSecret? }` to be merged into the auth response. The client
 * persists it alongside the response's `deviceId` and mints access tokens via
 * `POST /session/device/token`.
 */
export async function finalizeDeviceLogin(opts: {
  session: { sessionId: string; deviceId: string };
  userId: string;
  operatedByUserId?: string;
}): Promise<{ deviceSecret?: string }> {
  const { session, userId, operatedByUserId } = opts;

  const result: { deviceSecret?: string } = {};

  try {
    const { deviceSessionService } = await import('./deviceSession.service.js');
    const { state, changed } = await deviceSessionService.addAccount(
      session.deviceId,
      {
        accountId: userId,
        sessionId: session.sessionId,
        ...(operatedByUserId ? { operatedByUserId } : {}),
      },
      { activate: 'if-empty' },
    );
    if (changed) broadcastDeviceState(state);
    const deviceSecret = await deviceSessionService.issueDeviceSecret(session.deviceId);
    if (deviceSecret) result.deviceSecret = deviceSecret;
  } catch (error) {
    logger.warn('finalizeDeviceLogin: device registration failed', { userId, error });
  }

  return result;
}
