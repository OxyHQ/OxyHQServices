import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

/**
 * Service-token verification — the pure JWT half of the service-auth contract.
 *
 * Kept in its OWN module (importing only `jsonwebtoken` + `logger`) so it can be
 * reused by request-path code — the blocking `serviceAuthMiddleware`, the
 * optional/dual-auth path, and the rate-limiter's service-to-service exemption
 * predicate — WITHOUT dragging in the session-service / Mongoose model graph
 * that `middleware/auth.ts` pulls in. `verifyServiceToken` is the SINGLE SOURCE
 * OF TRUTH for the service-token contract; every consumer verifies through here.
 */

/**
 * Decoded payload for service-to-service JWTs minted via
 * `POST /auth/service-token`. Carries the `scopes` granted to the Application so
 * downstream middleware can do per-scope authorisation. The `appId` claim is the
 * Application `_id`.
 */
export interface ServiceTokenPayload {
  type: 'service';
  appId: string;
  appName: string;
  /** The specific ApplicationCredential `_id` that minted this token. */
  credentialId: string;
  scopes: string[];
  iat?: number;
  exp?: number;
}

/**
 * Outcome of {@link verifyServiceToken}. The verification is deliberately
 * tri-state so callers can produce the precise 4xx (blocking middleware) or
 * silently fall back to anonymous (non-blocking optional auth):
 *  - `{ ok: true, payload }` — a valid `service`-type token.
 *  - `{ ok: false, reason: 'not_service' }` — verified, but not a service token
 *    (a user session token, or missing required service claims).
 *  - `{ ok: false, reason: 'expired' | 'invalid' }` — verification failed.
 */
export type ServiceTokenVerification =
  | { ok: true; payload: ServiceTokenPayload }
  | { ok: false; reason: 'not_service' | 'expired' | 'invalid' };

/**
 * Pure verification of a service JWT. SINGLE SOURCE OF TRUTH for the service
 * token contract — the blocking `serviceAuthMiddleware`, any optional /
 * dual-auth path, and the rate-limiter exemption verify through here so they
 * cannot drift. Performs the full `jwt.verify` (signature + expiry) and the
 * required-claim checks; never throws.
 */
export function verifyServiceToken(token: string): ServiceTokenVerification {
  if (!process.env.ACCESS_TOKEN_SECRET) {
    logger.error('ACCESS_TOKEN_SECRET not configured');
    return { ok: false, reason: 'invalid' };
  }

  let decoded: {
    type?: string;
    appId?: string;
    appName?: string;
    credentialId?: string;
    scopes?: unknown;
    iat?: number;
    exp?: number;
    [key: string]: unknown;
  };
  try {
    decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET) as typeof decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'invalid' };
  }

  if (decoded.type !== 'service') {
    return { ok: false, reason: 'not_service' };
  }

  if (
    typeof decoded.appId !== 'string' ||
    typeof decoded.appName !== 'string' ||
    typeof decoded.credentialId !== 'string' ||
    decoded.credentialId.length === 0
  ) {
    return { ok: false, reason: 'not_service' };
  }

  const scopes = Array.isArray(decoded.scopes)
    ? decoded.scopes.filter((s): s is string => typeof s === 'string')
    : [];

  return {
    ok: true,
    payload: {
      type: 'service',
      appId: decoded.appId,
      appName: decoded.appName,
      credentialId: decoded.credentialId,
      scopes,
      iat: decoded.iat,
      exp: decoded.exp,
    },
  };
}
