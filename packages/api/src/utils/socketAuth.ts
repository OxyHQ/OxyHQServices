/**
 * Socket.IO handshake → room identity, resolved WITHOUT ever trusting a
 * client-supplied user or device id.
 *
 * This is the single authority for who a socket is allowed to be. A socket must
 * present a valid bearer access token: it becomes an AUTHENTICATED user socket
 * that joins the `user:<id>` room AND the `device:<deviceId>` room (deviceId from
 * the JWT claim). A signed-out device never needs real-time sync, so there is no
 * anonymous device socket — a handshake without a resolvable bearer is rejected.
 */
import jwt from 'jsonwebtoken';
import { logger } from './logger';

/** An authenticated user socket: full identity, both `user:` and `device:` rooms. */
export interface SocketUserIdentity {
  kind: 'user';
  user: { id: string; deviceId?: string; [key: string]: unknown };
}

/** Resolved handshake identity, or `null` to reject the connection. */
export type SocketIdentity = SocketUserIdentity | null;

/** The subset of a Socket.IO `Handshake` this resolver reads. */
export interface SocketHandshakeAuthInput {
  auth?: Record<string, unknown>;
}

interface AccessTokenClaims extends jwt.JwtPayload {
  userId?: string;
  id?: string;
  deviceId?: string;
}

export async function resolveSocketIdentity(
  handshake: SocketHandshakeAuthInput,
): Promise<SocketIdentity> {
  // Bearer access token → authenticated user socket. No bearer → reject.
  const rawToken = handshake.auth?.token;
  const token = typeof rawToken === 'string' ? rawToken : '';
  if (token) {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret) {
      // Misconfiguration — never crash the handshake; reject below.
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
        // signed out) is not a hard error — fall through to the reject below.
        logger.debug('resolveSocketIdentity: bearer verify failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // No resolvable bearer → reject.
  return null;
}
