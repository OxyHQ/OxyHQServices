import Session from "../models/Session";
import { logger } from "./logger";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { extractDeviceInfo, registerDevice, generateDeviceFingerprint, DeviceFingerprint } from "./deviceUtils";
import { Request } from "express";

const ACCESS_TOKEN_EXPIRES_IN = '15m'; // Short-lived access tokens
const REFRESH_TOKEN_EXPIRES_IN = '7d'; // Longer refresh tokens
const SESSION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * Generate device ID - this should be stored locally on the device
 * @returns A unique device identifier
 */
export const generateDeviceId = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

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

/**
 * Update session activity for the given access token
 * @param accessToken - The access token to update activity for
 */
export const updateSessionActivity = async (accessToken: string): Promise<void> => {
  try {
    if (!accessToken) {
      logger.warn('[SessionUtils] No access token provided for activity update');
      return;
    }

    await Session.updateOne(
      { accessToken, isActive: true },
      { 
        $set: { 
          "deviceInfo.lastActive": new Date() 
        }
      }
    );

    logger.debug(`[SessionUtils] Updated activity for access token session`);
  } catch (error) {
    logger.error('[SessionUtils] Failed to update session activity:', error);
  }
};

/**
 * Create a new session for a user on a device
 * @param userId - The user ID
 * @param req - Express request object for extracting device info
 * @param deviceName - Optional device name
 * @param deviceFingerprint - Optional device fingerprint for device ID reuse
 * @returns The created session
 */
export const createSession = async (
  userId: string,
  req: Request,
  deviceName?: string,
  deviceFingerprint?: DeviceFingerprint
) => {
  try {
    // Extract and register device info
    let deviceInfo = extractDeviceInfo(req, undefined, deviceName);
    
    if (deviceFingerprint) {
      const fingerprint = generateDeviceFingerprint(deviceFingerprint);
      deviceInfo = await registerDevice(deviceInfo, fingerprint);
    }

    // Calculate expiration date
    const expiresAt = new Date(Date.now() + SESSION_EXPIRES_IN);
    
    // Create session document first to get the session ID
    const sessionData = {
      userId,
      deviceId: deviceInfo.deviceId,
      deviceInfo: {
        deviceName: deviceInfo.deviceName,
        deviceType: deviceInfo.deviceType,
        platform: deviceInfo.platform,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        ipAddress: deviceInfo.ipAddress,
        userAgent: deviceInfo.userAgent,
        location: deviceInfo.location,
        fingerprint: deviceInfo.fingerprint,
        lastActive: new Date()
      },
      accessToken: 'temp', // Temporary until we generate real tokens
      refreshToken: 'temp',
      isActive: true,
      expiresAt,
      lastRefresh: new Date()
    };

    const session = new Session(sessionData);
    await session.save();
    
    // Generate tokens with the actual session ID
    const { accessToken, refreshToken } = generateSessionTokens(
      userId, 
      (session._id as any).toString(), 
      deviceInfo.deviceId
    );
    
    // Update the session with real tokens
    session.accessToken = accessToken;
    session.refreshToken = refreshToken;
    await session.save();
    
    logger.info(`[SessionUtils] Created new session for user: ${userId} on device: ${deviceInfo.deviceId}`);
    return session;
  } catch (error) {
    logger.error('[SessionUtils] Failed to create session:', error);
    throw error;
  }
};

/**
 * Refresh tokens for an existing session
 * @param refreshToken - The current refresh token
 * @returns New tokens and updated session
 */
export const refreshSessionTokens = async (refreshToken: string) => {
  try {
    // Validate refresh token
    const payload = validateRefreshToken(refreshToken);
    if (!payload) {
      throw new Error('Invalid refresh token');
    }

    // Find the session
    const session = await Session.findOne({
      _id: payload.sessionId,
      refreshToken,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    if (!session) {
      throw new Error('Session not found or expired');
    }

    // Generate new tokens
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateSessionTokens(
      payload.userId,
      payload.sessionId,
      payload.deviceId
    );

    // Update session with new tokens
    session.accessToken = newAccessToken;
    session.refreshToken = newRefreshToken;
    session.lastRefresh = new Date();
    session.deviceInfo.lastActive = new Date();
    await session.save();

    logger.info(`[SessionUtils] Refreshed tokens for session: ${payload.sessionId}`);
    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      session
    };
  } catch (error) {
    logger.error('[SessionUtils] Failed to refresh session tokens:', error);
    throw error;
  }
};

/**
 * Validate a session by access token
 * @param accessToken - The access token to validate
 * @returns Session and user info if valid, null otherwise
 */
export const validateSession = async (accessToken: string) => {
  try {
    // First validate the token format
    const payload = validateAccessToken(accessToken);
    if (!payload) {
      return null;
    }

    // Find the session in database using sessionId field
    const session = await Session.findOne({
      sessionId: payload.sessionId,
      accessToken,
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).populate('userId');

    if (!session) {
      logger.debug('[SessionUtils] Session not found or expired');
      return null;
    }

    // Update last activity
    session.deviceInfo.lastActive = new Date();
    await session.save();

    return {
      session,
      user: session.userId,
      payload
    };
  } catch (error) {
    logger.error('[SessionUtils] Session validation failed:', error);
    return null;
  }
};

/**
 * Deactivate a specific session
 * @param sessionId - The session ID to deactivate
 * @returns Success boolean
 */
export const deactivateSession = async (sessionId: string): Promise<boolean> => {
  try {
    const result = await Session.updateOne(
      { _id: sessionId },
      { $set: { isActive: false } }
    );
    
    logger.info(`[SessionUtils] Deactivated session: ${sessionId}`);
    return result.modifiedCount > 0;
  } catch (error) {
    logger.error('[SessionUtils] Failed to deactivate session:', error);
    return false;
  }
};

/**
 * Deactivate all sessions for a user except the current one
 * @param userId - The user ID
 * @param currentSessionId - The current session to keep active
 * @returns Number of sessions deactivated
 */
export const deactivateOtherSessions = async (userId: string, currentSessionId: string): Promise<number> => {
  try {
    const result = await Session.updateMany(
      { 
        userId,
        _id: { $ne: currentSessionId },
        isActive: true 
      },
      { $set: { isActive: false } }
    );
    
    logger.info(`[SessionUtils] Deactivated ${result.modifiedCount} other sessions for user: ${userId}`);
    return result.modifiedCount;
  } catch (error) {
    logger.error('[SessionUtils] Failed to deactivate other sessions:', error);
    return 0;
  }
};

/**
 * Deactivate all sessions for a user
 * @param userId - The user ID
 * @returns Number of sessions deactivated
 */
export const deactivateAllUserSessions = async (userId: string): Promise<number> => {
  try {
    const result = await Session.updateMany(
      { userId, isActive: true },
      { $set: { isActive: false } }
    );
    
    logger.info(`[SessionUtils] Deactivated all ${result.modifiedCount} sessions for user: ${userId}`);
    return result.modifiedCount;
  } catch (error) {
    logger.error('[SessionUtils] Failed to deactivate all user sessions:', error);
    return 0;
  }
};

/**
 * Get all active sessions for a user
 * @param userId - The user ID
 * @returns Array of active sessions
 */
export const getUserActiveSessions = async (userId: string) => {
  try {
    const sessions = await Session.find({
      userId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).sort({ 'deviceInfo.lastActive': -1 });

    return sessions;
  } catch (error) {
    logger.error('[SessionUtils] Failed to get user active sessions:', error);
    return [];
  }
};

/**
 * Get all sessions on a specific device
 * @param deviceId - The device ID
 * @returns Array of sessions on the device
 */
export const getDeviceSessions = async (deviceId: string) => {
  try {
    const sessions = await Session.find({
      deviceId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).populate('userId', 'username email avatar').sort({ 'deviceInfo.lastActive': -1 });

    return sessions;
  } catch (error) {
    logger.error('[SessionUtils] Failed to get device sessions:', error);
    return [];
  }
};
