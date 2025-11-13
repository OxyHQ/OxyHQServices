import { logger } from "./logger";
import jwt from "jsonwebtoken";

const ACCESS_TOKEN_EXPIRES_IN = '15m'; // Short-lived access tokens
const REFRESH_TOKEN_EXPIRES_IN = '7d'; // Longer refresh tokens

/**
 * Generate JWT tokens for a session
 * @param userId - The user ID
 * @param sessionId - The session ID
 * @param deviceId - The device ID
 * @returns Object containing access and refresh tokens
 */
export const generateSessionTokens = (userId: string, sessionId: string, deviceId: string) => {
  const payload = { 
    userId, 
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
 * Validate and decode an access token
 * @param token - The access token to validate
 * @returns Decoded token payload or null if invalid
 */
export const validateAccessToken = (token: string) => {
  try {
    return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as any;
  } catch (error) {
    logger.debug('[SessionUtils] Access token validation failed:', error);
    return null;
  }
};

/**
 * Validate and decode a refresh token
 * @param token - The refresh token to validate
 * @returns Decoded token payload or null if invalid
 */
export const validateRefreshToken = (token: string) => {
  try {
    return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!) as any;
  } catch (error) {
    logger.debug('[SessionUtils] Refresh token validation failed:', error);
    return null;
  }
};
