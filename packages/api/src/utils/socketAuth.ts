/**
 * Socket.IO handshake → room identity, resolved WITHOUT ever trusting a
 * client-supplied user or device id.
 *
 * This is the single authority for who a socket is allowed to be. It powers two
 * kinds of connection:
 *
 *  - AUTHENTICATED user socket — a valid bearer access token. Joins the
 *    `user:<id>` room AND the `device:<deviceId>` room (deviceId from the JWT
 *    claim).
 *  - ANONYMOUS device socket — NO (or invalid) bearer, but a resolvable device
 *    anchor: the first-party `oxy_device` cookie (same-site `*.oxy.so`
 *    handshake) or, on native (no cookie jar), the shared device token in the
 *    handshake auth. Joins ONLY `device:<deviceId>` — the deviceId is derived
 *    SERVER-SIDE from the cookie's / token's hash, never from client input, and
 *    the socket carries ZERO user identity.
 *
 * Why this is safe: an anonymous device socket can only ever LEARN that its own
 * device's session set changed — it receives the state-only `session_state`
 * broadcast (account ids + revision, NEVER tokens), cannot mutate anything, and
 * cannot join another device's room (the room is the server-resolved deviceId).
 * This is the same posture as the device-first `oxy_device` cookie itself.
 */
import jwt from 'jsonwebtoken';
import type { IncomingHttpHeaders } from 'http';
import deviceSessionService from '../services/deviceSession.service';
import { resolveDeviceToken } from '../services/deviceToken.service';
import { readDeviceCookieFromHeader } from './deviceCookie';
import { logger } from './logger';

/** An authenticated user socket: full identity, both `user:` and `device:` rooms. */
export interface SocketUserIdentity {
  kind: 'user';
  user: { id: string; deviceId?: string; [key: string]: unknown };
}

/** An anonymous device socket: `device:` room only, no user identity. */
export interface SocketDeviceIdentity {
  kind: 'device';
  deviceId: string;
}

/** Resolved handshake identity, or `null` to reject the connection. */
export type SocketIdentity = SocketUserIdentity | SocketDeviceIdentity | null;

/** The subset of a Socket.IO `Handshake` this resolver reads. */
export interface SocketHandshakeAuthInput {
  auth?: Record<string, unknown>;
  headers: IncomingHttpHeaders;
}

interface AccessTokenClaims extends jwt.JwtPayload {
  userId?: string;
  id?: string;
  deviceId?: string;
}

export async function resolveSocketIdentity(
  handshake: SocketHandshakeAuthInput,
): Promise<SocketIdentity> {
  // 1. Bearer access token → authenticated user socket.
  const rawToken = handshake.auth?.token;
  const token = typeof rawToken === 'string' ? rawToken : '';
  if (token) {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret) {
      // Misconfiguration — never crash the handshake; degrade to the device
      // paths below (which may still resolve) or reject.
      logger.error('resolveSocketIdentity: ACCESS_TOKEN_SECRET is not configured');
    } else {
      try {
        const decoded = jwt.verify(token, secret);
        if (typeof decoded !== 'string') {
          const claims = decoded as AccessTokenClaims;
          const userId = claims.userId ?? claims.id;
          if (userId) {
            return { kind: 'user', user: { id: userId, ...claims } };
          }
        }
      } catch (error) {
        // A present-but-invalid bearer (e.g. an expired token on a tab that just
        // signed out) is NOT a hard reject — fall through to the anonymous
        // device paths, which may still resolve a valid `oxy_device` cookie.
        logger.debug('resolveSocketIdentity: bearer verify failed; trying device paths', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // 2. First-party `oxy_device` cookie (same-site `*.oxy.so`) → anonymous device
  //    socket. deviceId derived from the cookie's SHA-256, server-side only.
  const cookieKey = readDeviceCookieFromHeader(handshake.headers?.cookie);
  if (cookieKey) {
    const state = await deviceSessionService.getStateByCookieKey(cookieKey);
    if (state?.deviceId) {
      return { kind: 'device', deviceId: state.deviceId };
    }
  }

  // 3. Native shared device token in the handshake auth (RN has no cookie jar)
  //    → anonymous device socket. deviceId derived from the token hash.
  const rawDeviceToken = handshake.auth?.deviceToken;
  const deviceToken = typeof rawDeviceToken === 'string' ? rawDeviceToken : '';
  if (deviceToken) {
    const resolved = await resolveDeviceToken(deviceToken, { headers: handshake.headers });
    if (resolved?.deviceId) {
      return { kind: 'device', deviceId: resolved.deviceId };
    }
  }

  // 4. No bearer, no resolvable device anchor → reject.
  return null;
}
