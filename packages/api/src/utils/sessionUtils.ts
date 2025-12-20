import { logger } from "./logger";
import jwt from "jsonwebtoken";

const ACCESS_TOKEN_EXPIRES_IN = '15m'; // Short-lived access tokens
const REFRESH_TOKEN_EXPIRES_IN = '7d'; // Longer refresh tokens

/**
 * JWT Token Payload Types
 * userId is always MongoDB ObjectId (24 hex characters), never publicKey
 */
export interface AccessTokenPayload {
  userId: string;      // MongoDB ObjectId - PRIMARY IDENTIFIER
  sessionId: string;   // Session UUID
  deviceId: string;   // Device identifier
  type: 'access';
  iat?: number;        // Issued at (added by JWT)
  exp?: number;        // Expiration (added by JWT)
}

export interface RefreshTokenPayload {
  userId: string;      // MongoDB ObjectId - PRIMARY IDENTIFIER
  sessionId: string;   // Session UUID
  deviceId: string;   // Device identifier
  type: 'refresh';    // Different from AccessTokenPayload
  iat?: number;        // Issued at (added by JWT)
  exp?: number;        // Expiration (added by JWT)
}

/**
 * Generate JWT tokens for a session
 * @param userId - The user ID (MongoDB ObjectId, not publicKey)
 * @param sessionId - The session ID
 * @param deviceId - The device ID
 * @returns Object containing access and refresh tokens
 */
export const generateSessionTokens = (userId: string, sessionId: string, deviceId: string) => {
  // Validate userId is ObjectId format (24 hex characters)
  if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
    throw new Error(`Invalid userId format: expected MongoDB ObjectId (24 hex chars), got: ${userId.substring(0, 20)}...`);
  }
  
  const payload: AccessTokenPayload = { 
    userId,  // Always ObjectId, never publicKey
    sessionId,
    deviceId,
    type: 'access'
  };
  
  const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET!, { 
    expiresIn: ACCESS_TOKEN_EXPIRES_IN 
  });
  
  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' }, 
    process.env.REFRESH_TOKEN_SECRET!, 
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );
  
  return { accessToken, refreshToken };
};

/**
 * Token validation result with error information
 */
export interface TokenValidationResult {
  valid: boolean;
  payload?: AccessTokenPayload | RefreshTokenPayload;
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
    const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as AccessTokenPayload;
    
    // Validate userId is ObjectId format
    if (payload.userId && !/^[0-9a-fA-F]{24}$/.test(payload.userId)) {
      logger.warn('[SessionUtils] Invalid userId format in token', { userId: payload.userId?.substring(0, 20) });
      return { valid: false, error: 'invalid' };
    }
    
    return { valid: true, payload };
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
    const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!) as RefreshTokenPayload;
    
    // Validate userId is ObjectId format
    if (payload.userId && !/^[0-9a-fA-F]{24}$/.test(payload.userId)) {
      logger.warn('[SessionUtils] Invalid userId format in refresh token', { userId: payload.userId?.substring(0, 20) });
      return { valid: false, error: 'invalid' };
    }
    
    return { valid: true, payload };
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
