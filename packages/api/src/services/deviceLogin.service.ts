/**
 * Device-first login attribution — shared across the first-party auth flows
 * (`/auth/login`, `/auth/signup`, `/auth/verify`, `/security/2fa/verify-login`).
 *
 * ADD-ONLY: this never reads or overrides an existing active account. It only
 *  - resolves WHICH device a fresh sign-in belongs to (cookie > deviceToken),
 *  - registers the freshly-credentialed session into that device's set WITHOUT
 *    stealing the active account (`activate: 'if-empty'`), and
 *  - decides whether the response may carry a persisted rotating refresh token.
 *
 * A stolen deviceToken can therefore only ADD an already-authenticated session
 * to a device set (a detectable set-pollution), never flip the active account or
 * read state.
 *
 * `deviceSession.service` / `deviceToken.service` are imported LAZILY (only when
 * a cookie/deviceToken/deviceId is actually present) so that merely importing
 * this helper — which the hot auth controllers do at module load — never forces
 * the `DeviceSession`/`DeviceToken` Mongoose models to evaluate. This matches the
 * existing `session.service` lazy-`import('./account.service.js')` convention and
 * keeps unit tests that mock only the models they touch working unchanged.
 */

import type { Request } from 'express';
import { readDeviceCookie } from '../utils/deviceCookie';
import { normaliseOrigin, isLoopbackOrigin } from '../utils/origin';
import { isTrustedOrigin } from '../config/dynamicOriginRegistry';
import { isSameSiteTrustedRequest } from '../utils/sameSite';
import { issueRefreshToken } from './refreshToken.service';
import { broadcastDeviceState } from '../utils/socket';
import { logger } from '../utils/logger';

/**
 * Resolve the device a fresh sign-in should attach to. Precedence:
 *   1. the `oxy_device` cookie when it maps to a known device,
 *   2. an add-only `deviceToken` (channel-policy verified against the request),
 *   3. none.
 * Returns the deviceId or null. Never throws.
 */
export async function resolveLoginDeviceId(
  req: Request,
  deviceToken: unknown,
): Promise<string | null> {
  try {
    const rawCookie = readDeviceCookie(req);
    const hasDeviceToken = typeof deviceToken === 'string' && deviceToken.length > 0;
    if (!rawCookie && !hasDeviceToken) {
      return null;
    }

    const { deviceSessionService } = await import('./deviceSession.service.js');
    if (rawCookie) {
      const state = await deviceSessionService.getStateByCookieKey(rawCookie);
      if (state) return state.deviceId;
    }
    if (hasDeviceToken) {
      const { resolveDeviceToken } = await import('./deviceToken.service.js');
      const resolved = await resolveDeviceToken(deviceToken as string, req);
      if (resolved) return resolved.deviceId;
    }
  } catch (error) {
    logger.warn('resolveLoginDeviceId failed', { error });
  }
  return null;
}

/**
 * Resolve the login device, MINTING a device cookie when appropriate. Precedence:
 *   1. an existing binding (oxy_device cookie > deviceToken), OR
 *   2. for a SAME-SITE TRUSTED login with no existing binding — the IdP form on
 *      auth.oxy.so and oxy.so apps hitting api.oxy.so — mint a fresh device +
 *      `oxy_device` cookie so a first-ever sign-in gets a durable device identity
 *      WITHOUT a bootstrap hop (this is what feeds the IdP chooser its own logins
 *      and gives new oxy.so users a device to converge on).
 *   3. otherwise no device (cross-site callers stay on the deviceToken lane).
 *
 * Returns the deviceId (or null) plus, when a cookie was minted, the raw secret
 * the caller must Set-Cookie on the login response. Never throws.
 */
export async function resolveLoginDevice(
  req: Request,
  deviceToken: unknown,
): Promise<{ deviceId: string | null; setCookieSecret?: string }> {
  const existing = await resolveLoginDeviceId(req, deviceToken);
  if (existing) return { deviceId: existing };

  if (isSameSiteTrustedRequest(req)) {
    try {
      const { deviceSessionService } = await import('./deviceSession.service.js');
      const { deviceId, rawCookieKey } = await deviceSessionService.ensureDeviceForCookie();
      return { deviceId, setCookieSecret: rawCookieKey };
    } catch (error) {
      logger.warn('resolveLoginDevice: same-site cookie mint failed', { error });
    }
  }
  return { deviceId: null };
}

/**
 * Whether the response may carry a persisted rotating refresh token: yes when a
 * device binding resolved, OR the request Origin is on the trusted lane
 * (first-party/internal/official/loopback) or ABSENT (native / non-browser).
 * Third-party-lane browser origins get today's response shape exactly (no
 * refreshToken), so a third-party page can never obtain a long-lived refresh
 * token from a first-party login.
 */
function shouldReturnRotatingRefresh(req: Request, hasDeviceBinding: boolean): boolean {
  if (hasDeviceBinding) return true;
  const originRaw = req.headers.origin;
  if (typeof originRaw !== 'string' || originRaw.length === 0) return true;
  const normalized = normaliseOrigin(originRaw);
  if (!normalized) return false;
  if (isLoopbackOrigin(normalized)) return true;
  return isTrustedOrigin(normalized);
}

/**
 * Finalize a fresh sign-in for the device-first lane: register the session into
 * the resolved device's set (add-only, never flips active) + broadcast, and mint
 * a rotating refresh token for the response when the lane allows it. Everything
 * is best-effort — a failure here never breaks the sign-in.
 *
 * Returns `{ refreshToken? }` to be merged additively into the auth response.
 */
export async function finalizeDeviceLogin(opts: {
  req: Request;
  deviceId: string | null;
  session: { sessionId: string; deviceId: string };
  userId: string;
  operatedByUserId?: string;
}): Promise<{ refreshToken?: string }> {
  const { req, deviceId, session, userId, operatedByUserId } = opts;

  if (deviceId) {
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
    } catch (error) {
      logger.warn('finalizeDeviceLogin: device registration failed', { userId, error });
    }
  }

  if (shouldReturnRotatingRefresh(req, !!deviceId)) {
    try {
      const refresh = await issueRefreshToken({ sessionId: session.sessionId, userId });
      return { refreshToken: refresh.token };
    } catch (error) {
      logger.warn('finalizeDeviceLogin: refresh mint failed', { userId, error });
    }
  }
  return {};
}
