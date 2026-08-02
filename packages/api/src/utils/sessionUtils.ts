import { logger } from "./logger";
import jwt from "jsonwebtoken";

/**
 * Access-token lifetime in seconds. Exported because `POST /auth/oauth/token`
 * must report it as RFC 6749 §5.1 `expires_in`, and a hard-coded copy there
 * would start lying the moment this value changes.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // Short-lived access tokens
const ACCESS_TOKEN_EXPIRES_IN = `${ACCESS_TOKEN_TTL_SECONDS}s`;
const REFRESH_TOKEN_EXPIRES_IN = '7d'; // Longer refresh tokens

/**
 * Generate JWT tokens for a session
 *
 * KNOWN PROPERTY — the minted pair is DETERMINISTIC within one second. The
 * payload is `{userId, sessionId, deviceId, type}` with no nonce, and a JWT's
 * `iat`/`exp` carry one-second resolution, so two mints for the same session
 * inside the same second produce BYTE-IDENTICAL tokens. The consequence is on
 * the rotation path: `sessionService.refreshTokens` writes the outgoing token
 * to `previous_refresh_token` and the new one to `refresh_token`, so a rotation
 * that fast leaves the two EQUAL and does not invalidate a presented token.
 *
 * This is long-standing behaviour, unchanged by the Postgres port, and is
 * reported/escalated rather than patched here: adding a per-mint nonce (`jti`)
 * changes the token format, which is a wire contract every ecosystem app parses.
 * `services/__tests__/session.service.test.ts` crosses a second boundary in its
 * rotation cases specifically so they exercise a real rotation instead of
 * passing against this collision — see the `nextSecond` helper there before
 * changing either side.
 *
 * @param userId - The user ID
 * @param sessionId - The session ID
 * @param deviceId - The device ID
 * @returns Object containing access and refresh tokens
 */
export const generateSessionTokens = (userId: string, sessionId: string, deviceId: string) => {
  const accessSecret = process.env.ACCESS_TOKEN_SECRET;
  const refreshSecret = process.env.REFRESH_TOKEN_SECRET;
  if (!accessSecret || !refreshSecret) {
    throw new Error('Token secrets are not configured (ACCESS_TOKEN_SECRET / REFRESH_TOKEN_SECRET)');
  }

  const payload = {
    userId,
    sessionId,
    deviceId,
    type: 'access'
  };

  const accessToken = jwt.sign(payload, accessSecret, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN
  });

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    refreshSecret,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );

  return { accessToken, refreshToken };
};

/**
 * Decoded claims carried by the session access/refresh JWTs minted here.
 * Extends `JwtPayload` so the standard registered claims (`iat`, `exp`, …) and
 * its index signature remain available on the decoded token.
 */
export interface SessionTokenPayload extends jwt.JwtPayload {
  userId: string;
  sessionId: string;
  deviceId: string;
  type: 'access' | 'refresh';
}

/**
 * Token validation result with error information
 */
export interface TokenValidationResult {
  valid: boolean;
  payload?: SessionTokenPayload;
  error?: 'expired' | 'invalid' | 'malformed';
}

/**
 * Validate and decode an access token
 * 
 * Enhanced error handling: Returns specific error types for better debugging
 * and to distinguish between expired tokens (should refresh) vs invalid tokens.
 * 
 * @param token - The access token to validate
 * @returns Validation result with payload if valid, or error information if invalid
 */
export const validateAccessToken = (token: string): TokenValidationResult => {
  try {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret) {
      logger.error('[SessionUtils] ACCESS_TOKEN_SECRET is not configured');
      return { valid: false, error: 'invalid' };
    }
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'string') {
      return { valid: false, error: 'malformed' };
    }
    return { valid: true, payload: decoded as SessionTokenPayload };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.debug('[SessionUtils] Access token expired');
      return { valid: false, error: 'expired' };
    }
    if (error instanceof jwt.JsonWebTokenError) {
      logger.debug('[SessionUtils] Access token invalid', { error: error.message });
      return { valid: false, error: 'invalid' };
    }
    logger.debug('[SessionUtils] Access token validation failed', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return { valid: false, error: 'malformed' };
  }
};

/**
 * Validate and decode a refresh token
 * 
 * Enhanced error handling: Returns specific error types for better debugging
 * and to distinguish between expired tokens vs invalid tokens.
 * 
 * @param token - The refresh token to validate
 * @returns Validation result with payload if valid, or error information if invalid
 */
export const validateRefreshToken = (token: string): TokenValidationResult => {
  try {
    const secret = process.env.REFRESH_TOKEN_SECRET;
    if (!secret) {
      logger.error('[SessionUtils] REFRESH_TOKEN_SECRET is not configured');
      return { valid: false, error: 'invalid' };
    }
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'string') {
      return { valid: false, error: 'malformed' };
    }
    return { valid: true, payload: decoded as SessionTokenPayload };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.debug('[SessionUtils] Refresh token expired');
      return { valid: false, error: 'expired' };
    }
    if (error instanceof jwt.JsonWebTokenError) {
      logger.debug('[SessionUtils] Refresh token invalid', { error: error.message });
      return { valid: false, error: 'invalid' };
    }
    logger.debug('[SessionUtils] Refresh token validation failed', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return { valid: false, error: 'malformed' };
  }
};
