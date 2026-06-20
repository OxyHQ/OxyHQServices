/**
 * Optional Authentication Middleware
 * 
 * Similar to authMiddleware but doesn't reject requests without authentication.
 * Sets req.user if a valid token is present, otherwise leaves it undefined.
 * This allows routes to serve public content while still identifying authenticated users.
 */

import { Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { logger } from '../utils/logger';
import { authenticateRequestNonBlocking, AuthenticatedRequest, extractTokenFromRequest } from './authUtils';
import { verifyServiceToken, type ServiceTokenPayload } from './auth';

/**
 * Optional authentication middleware
 * Attempts to authenticate but doesn't block if authentication fails
 * Uses session-based tokens only
 */
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { user, source } = await authenticateRequestNonBlocking(req, false);
    
    if (user) {
      req.user = user;
      logger.debug('Optional auth: User authenticated', { 
        userId: user._id, 
        source: source || 'unknown'
      });
    }
    
    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    // Even on error, continue without blocking the request
    next();
  }
}

/**
 * Extract user ID from request (works with both auth and optional auth)
 */
export function getUserId(req: AuthenticatedRequest): string | undefined {
  return req.user?._id;
}

/**
 * The HTTP header a calling SERVICE sets to name the end-user (viewer) it is
 * acting on behalf of for personalization. Mirrors the platform convention used
 * by `@oxyhq/core` `makeServiceRequest(..., userId)` and `@oxyhq/core/server`.
 */
const OXY_USER_ID_HEADER = 'x-oxy-user-id';

/**
 * Scope a service credential must hold to supply a personalization viewer via
 * `X-Oxy-User-Id`. `user:read` is the minimal existing scope every first-party
 * consumer (e.g. Mention) already holds; it authorises reading public user data
 * — which is exactly what a personalized (re-ordered public profiles) ranking
 * is. It does NOT grant acting-as-user mutation authority.
 */
const VIEWER_DELEGATION_SCOPE = 'user:read';

/**
 * A request that may carry EITHER an optional authenticated user (`req.user`,
 * from a session bearer token) OR a verified service principal (`req.serviceApp`,
 * from a service token). Used by dual-auth optional surfaces such as the
 * recommendation endpoints.
 */
export interface OptionalUserOrServiceRequest extends AuthenticatedRequest {
  serviceApp?: ServiceTokenPayload;
}

/**
 * Optional DUAL authentication for read surfaces that personalize for a viewer.
 *
 * Resolution order, all NON-BLOCKING (an unauthenticated/invalid caller is
 * simply treated as anonymous — the request is never rejected here):
 *  1. If the bearer token is a VALID service token, attach `req.serviceApp`.
 *     The viewer is resolved later from `X-Oxy-User-Id` (see {@link resolveViewerId})
 *     only when the credential holds the delegation scope.
 *  2. Otherwise fall back to the existing optional user-session auth, attaching
 *     `req.user` when a valid session token is present.
 *
 * An INVALID/expired token attaches neither principal → anonymous. A user-token
 * caller never gets `req.serviceApp`, so `X-Oxy-User-Id` is ignored for it
 * (anti-impersonation — see {@link resolveViewerId}).
 */
export async function optionalUserOrServiceAuth(
  req: OptionalUserOrServiceRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractTokenFromRequest(req);

    if (token) {
      const verification = verifyServiceToken(token);
      if (verification.ok) {
        // Valid service token → service principal. Do NOT also attempt user
        // session auth (a service token has no session).
        req.serviceApp = verification.payload;
        logger.debug('Optional dual auth: service principal', {
          appId: verification.payload.appId,
        });
        next();
        return;
      }
      // `not_service` means a verified user/session token (or a token missing
      // service claims). `expired`/`invalid` means it does not verify at all.
      // In both cases fall through to the optional user-session path, which
      // safely yields anonymous when the token is not a valid session token.
    }

    const { user, source } = await authenticateRequestNonBlocking(req, false);
    if (user) {
      req.user = user;
      logger.debug('Optional dual auth: user authenticated', {
        userId: user._id,
        source: source || 'unknown',
      });
    }
    next();
  } catch (error) {
    logger.error('Optional dual auth middleware error:', error);
    // Never block — degrade to anonymous.
    next();
  }
}

/**
 * Resolve the personalization viewer id for a dual-auth request.
 *
 * - USER token: the viewer is the session's own user (`req.user._id`). Any
 *   `X-Oxy-User-Id` header is IGNORED so a user cannot impersonate another.
 * - SERVICE token: the viewer is the `X-Oxy-User-Id` header — but ONLY when the
 *   credential holds {@link VIEWER_DELEGATION_SCOPE} and the header is a valid
 *   ObjectId. A service with no/invalid header (or lacking the scope) resolves
 *   to `undefined` → the caller is treated as anonymous/public.
 * - No principal: `undefined` (anonymous).
 */
export function resolveViewerId(req: OptionalUserOrServiceRequest): string | undefined {
  // A user session always derives the viewer from its own token. Ignore any
  // X-Oxy-User-Id on a user request to prevent impersonation.
  if (req.user?._id) {
    return req.user._id;
  }

  const serviceApp = req.serviceApp;
  if (!serviceApp) {
    return undefined;
  }

  if (!serviceApp.scopes.includes(VIEWER_DELEGATION_SCOPE)) {
    logger.debug('resolveViewerId: service lacks viewer-delegation scope', {
      appId: serviceApp.appId,
    });
    return undefined;
  }

  const raw = req.headers[OXY_USER_ID_HEADER];
  const viewerId = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  if (!viewerId || !Types.ObjectId.isValid(viewerId)) {
    return undefined;
  }
  return viewerId;
}
