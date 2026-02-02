import Session, { ISession } from '../models/Session';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import sessionCache from '../utils/sessionCache';
import userCache from '../utils/userCache';
import { Types } from 'mongoose';
import securityActivityService from './securityActivityService';
import { 
  extractDeviceInfo, 
  generateDeviceFingerprint, 
  registerDevice,
  DeviceFingerprint 
} from '../utils/deviceUtils';
import { generateSessionTokens, validateAccessToken, validateRefreshToken } from '../utils/sessionUtils';
import { Request } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  SessionValidationResult,
  SessionCreateOptions,
  SessionRefreshResult,
} from '../types/session.types';

const SESSION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';
const OBJECT_ID_LENGTH = 24; // MongoDB ObjectId hex string length

/**
 * Extract userId string from various possible formats (ObjectId, populated object, string)
 * Handles edge cases and corrupted cache entries gracefully
 * 
 * @param userIdValue - The userId value which could be ObjectId, populated object, or string
 * @returns Extracted userId string or undefined if invalid
 */
function extractUserIdFromCache(userIdValue: unknown): string | undefined {
  if (!userIdValue) return undefined;

  try {
    if (userIdValue instanceof Types.ObjectId) {
      return userIdValue.toString();
    }

    if (typeof userIdValue === 'object' && userIdValue !== null && '_id' in userIdValue) {
      const extractedId = (userIdValue as { _id?: unknown })._id;
      if (extractedId instanceof Types.ObjectId) {
        return extractedId.toString();
      }
      if (typeof extractedId === 'string' && Types.ObjectId.isValid(extractedId) && extractedId.length === OBJECT_ID_LENGTH) {
        return extractedId;
      }
      return undefined;
    }

    if (typeof userIdValue === 'string') {
      if (Types.ObjectId.isValid(userIdValue) && userIdValue.length === OBJECT_ID_LENGTH) {
        return userIdValue;
      }
      return undefined;
    }

    if (typeof userIdValue === 'object' && userIdValue !== null && 'toString' in userIdValue) {
      const idString = String(userIdValue);
      if (Types.ObjectId.isValid(idString) && idString.length === OBJECT_ID_LENGTH) {
        return idString;
      }
    }
  } catch {
    // Silently handle extraction errors
  }

  return undefined;
}

class SessionService {
  /**
   * Get session by sessionId with caching
   * 
   * Optimized for high-scale usage with in-memory caching to minimize database queries.
   * Cache is automatically managed with TTL and cleanup.
   * 
   * @param sessionId - The session ID to lookup
   * @param useCache - Whether to use cache (default: true)
   * @returns Session object or null if not found or expired
   */
  async getSession(sessionId: string, useCache: boolean = true): Promise<ISession | null> {
    try {
      // Try cache first
      if (useCache) {
        const cached = sessionCache.get(sessionId);
        if (cached) {
          return cached;
        }
      }

      // Fallback to database
      const session = await Session.findOne({
        sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).lean();

      if (!session) {
        return null;
      }

      // Cache the session
      if (useCache) {
        sessionCache.set(sessionId, session as unknown as ISession);
      }

      return session as unknown as ISession;
    } catch (error) {
      logger.error('[SessionService] Failed to get session', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'getSession',
      });
      // Return null on error to allow graceful degradation
      // Caller should handle null case appropriately
      return null;
    }
  }

  /**
   * Get session with user populated
   * 
   * Optimized for high-scale usage with caching. When cache hit occurs,
   * still requires a user lookup as user data is not cached with session
   * (by design, to keep cache size manageable and user data fresh).
   * 
   * @param sessionId - The session ID to lookup
   * @param options - Configuration options
   * @param options.useCache - Whether to use cache (default: true)
   * @param options.select - User fields to select (default: '-password')
   * @returns Session and user object, or null if not found
   */
  async getSessionWithUser(
    sessionId: string, 
    options: { useCache?: boolean; select?: string } = {}
  ): Promise<{ session: ISession; user: any } | null> {
    try {
      const { useCache = true, select = '-password' } = options;

      // Try cache first for session (fast path)
      if (useCache) {
        const cached = sessionCache.get(sessionId);
        if (cached) {
          // Extract userId from cached session (handles various formats)
          const userId = extractUserIdFromCache(cached.userId);
          
          if (!userId) {
            sessionCache.invalidate(sessionId);
          } else {
            const cachedUser = userCache.get(userId);
            if (cachedUser) {
              return { session: cached, user: cachedUser };
            }
            
            const user = await User.findById(userId).select(select).lean();
            if (user) {
              userCache.set(userId, user as any);
              return { session: cached, user };
            }
            
            sessionCache.invalidate(sessionId);
            return null;
          }
        }
      }

      const sessionDoc = await Session.findOne({
        sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).lean();

      if (!sessionDoc?.userId) {
        return null;
      }

      if (useCache) {
        sessionCache.set(sessionId, sessionDoc as unknown as ISession);
      }

      const userId = sessionDoc.userId.toString();
      let user = userCache.get(userId);
      
      if (!user) {
        const userDoc = await User.findById(userId).select(select).lean();
        if (!userDoc) {
          return null;
        }
        user = userDoc as any;
        if (useCache && user) {
          userCache.set(userId, user);
        }
      }

      const session = {
        ...sessionDoc,
        userId: user
      } as unknown as ISession;

      return { session, user };
    } catch (error) {
      logger.error('[SessionService] Failed to get session with user', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'getSessionWithUser',
        sessionId,
      });
      // Return null on error for graceful degradation - consistent error handling pattern
      // Caller should handle null case appropriately
      return null;
    }
  }

  /**
   * Validate session by access token
   * 
   * High-performance session validation with caching and token verification.
   * Returns session and user data for use in authentication middleware.
   * 
   * @param accessToken - The JWT access token to validate
   * @returns Validation result with session, user, and payload, or null if invalid
   */
  async validateSession(accessToken: string): Promise<SessionValidationResult | null> {
    try {
      const validationResult = validateAccessToken(accessToken);
      if (!validationResult.valid || !validationResult.payload?.sessionId) {
        return null;
      }

      const sessionId = validationResult.payload.sessionId;
      const result = await this.getSessionWithUser(sessionId, { useCache: true });
      if (!result) {
        return null;
      }

      const { session } = result;

      if (sessionCache.shouldUpdateLastActive(sessionId)) {
        this.updateLastActivity(sessionId).catch(() => {
          // Silently fail - non-critical operation
        });
      }

      return {
        session,
        user: result.user,
        payload: validationResult.payload
      };
    } catch (error) {
      logger.error('[SessionService] Session validation failed', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'validateSession',
      });
      return null;
    }
  }

  /**
   * Update session last activity (non-blocking, batched)
   * 
   * Optimized for high-scale usage - updates are batched and throttled
   * to reduce database load while maintaining accurate last activity tracking.
   */
  async updateLastActivity(sessionId: string): Promise<void> {
    try {
      const now = new Date();
      
      await Session.updateOne(
        { sessionId, isActive: true },
        { 
          $set: { 
            'deviceInfo.lastActive': now,
            updatedAt: now
          } 
        }
      );

      const cached = sessionCache.get(sessionId);
      if (cached) {
        cached.deviceInfo.lastActive = now;
        sessionCache.set(sessionId, cached);
      }
    } catch (error) {
      logger.error('[SessionService] Failed to update last activity', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'updateLastActivity',
        sessionId,
      });
      sessionCache.clearPendingLastActive(sessionId);
    }
  }

  /**
   * Create a new session for a user
   * 
   * Optimized for high-scale usage:
   * - Reuses existing active sessions on the same device to reduce session proliferation
   * - Automatically caches new sessions for fast subsequent lookups
   * - Handles device fingerprinting and registration
   * 
   * @param userId - The user ID to create session for
   * @param req - Express request object for extracting device info
   * @param options - Session creation options (deviceName, deviceFingerprint)
   * @returns The created or reused session
   * @throws Error if session creation fails
   */
  async createSession(
    userId: string,
    req: Request,
    options: SessionCreateOptions = {}
  ): Promise<ISession> {
    try {
      const { deviceName, deviceFingerprint } = options;
      let deviceInfo = extractDeviceInfo(req, undefined, deviceName);
      
      // Pass userId to optimize device lookup - reduces Session collection scan
      if (deviceFingerprint) {
        deviceInfo = await registerDevice(deviceInfo, generateDeviceFingerprint(deviceFingerprint), userId);
      }

      // Check if this is a new device for this user (no previous sessions on this device)
      const isNewDevice = !(await Session.findOne({
        userId,
        deviceId: deviceInfo.deviceId,
      }).select('_id').lean());

      const existingSession = await Session.findOne({
        userId,
        deviceId: deviceInfo.deviceId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).select('_id sessionId deviceInfo').lean();

      if (existingSession) {
        const sessionId = existingSession.sessionId;
        const expiresAt = new Date(Date.now() + SESSION_EXPIRES_IN);
        const now = new Date();
        const { accessToken, refreshToken } = generateSessionTokens(userId, sessionId, deviceInfo.deviceId);

        const updated = await Session.findOneAndUpdate(
          { _id: existingSession._id },
          {
            $set: {
              accessToken,
              refreshToken,
              expiresAt,
              lastRefresh: now,
              'deviceInfo.lastActive': now,
              'deviceInfo.deviceName': deviceName || existingSession.deviceInfo?.deviceName,
              'deviceInfo.ipAddress': deviceInfo.ipAddress,
              'deviceInfo.userAgent': deviceInfo.userAgent,
              updatedAt: now
            }
          },
          { new: true }
        );

        if (updated) {
          sessionCache.set(sessionId, updated as ISession);
          return updated as ISession;
        }
      }

      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_EXPIRES_IN);
      const now = new Date();
      const { accessToken, refreshToken } = generateSessionTokens(userId, sessionId, deviceInfo.deviceId);

      const session = new Session({
        sessionId,
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
          lastActive: now
        },
        accessToken,
        refreshToken,
        isActive: true,
        expiresAt,
        lastRefresh: now
      });

      await session.save();
      sessionCache.set(sessionId, session);

      // Log security event for new device (only if this is the first session on this device)
      if (isNewDevice) {
        try {
          await securityActivityService.logDeviceAdded(
            userId,
            deviceInfo.deviceId,
            deviceInfo.deviceName || 'Unknown Device',
            req
          );
        } catch (error) {
          // Don't fail session creation if logging fails
          logger.error('Failed to log security event for device added:', error);
        }
      }

      return session;
    } catch (error) {
      logger.error('[SessionService] Failed to create session', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'createSession',
        userId,
      });
      throw error;
    }
  }

  /**
   * Refresh session tokens
   * 
   * Security-optimized: Always bypasses cache to ensure fresh token validation.
   * Invalidates old cache entry and caches new tokens after successful refresh.
   * 
   * @param refreshToken - The refresh token to validate and use for token refresh
   * @returns New access and refresh tokens with session, or null if refresh fails
   */
  async refreshTokens(refreshToken: string): Promise<SessionRefreshResult | null> {
    try {
      const validationResult = validateRefreshToken(refreshToken);
      if (!validationResult.valid || !validationResult.payload?.sessionId) {
        return null;
      }

      const payload = validationResult.payload;
      const sessionId = payload.sessionId;

      const session = await Session.findOne({
        sessionId,
        refreshToken,
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      if (!session) {
        return null;
      }

      const now = new Date();
      const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateSessionTokens(
        payload.userId || session.userId.toString(),
        sessionId,
        payload.deviceId || session.deviceId
      );

      session.accessToken = newAccessToken;
      session.refreshToken = newRefreshToken;
      session.lastRefresh = now;
      session.deviceInfo.lastActive = now;
      await session.save();

      sessionCache.invalidate(sessionId);
      sessionCache.set(sessionId, session);
      
      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        session
      };
    } catch (error) {
      logger.error('[SessionService] Failed to refresh tokens', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'refreshTokens',
      });
      return null;
    }
  }

  /**
   * Deactivate a session
   * 
   * Consistent error handling: Returns false on error (non-throwing pattern)
   * for operations that should gracefully degrade.
   * 
   * @param sessionId - The session ID to deactivate
   * @returns true if session was deactivated, false otherwise
   */
  async deactivateSession(sessionId: string): Promise<boolean> {
    try {
      const result = await Session.updateOne(
        { sessionId, isActive: true },
        { $set: { isActive: false, updatedAt: new Date() } }
      );

      // Invalidate cache
      sessionCache.invalidate(sessionId);

      logger.info('[SessionService] Deactivated session', { sessionId: sessionId.substring(0, 8) });
      return result.modifiedCount > 0;
    } catch (error) {
      logger.error('[SessionService] Failed to deactivate session', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'deactivateSession',
        sessionId,
      });
      // Return false on error for graceful degradation - consistent with other non-critical operations
      return false;
    }
  }

  /**
   * Deactivate all sessions for a user
   * 
   * Consistent error handling: Returns 0 on error (non-throwing pattern)
   * for operations that should gracefully degrade.
   * 
   * @param userId - The user ID whose sessions should be deactivated
   * @param excludeSessionId - Optional session ID to exclude from deactivation
   * @returns Number of sessions deactivated (0 on error)
   */
  async deactivateAllUserSessions(userId: string, excludeSessionId?: string): Promise<number> {
    try {
      const filter: any = { userId, isActive: true };
      if (excludeSessionId) {
        filter.sessionId = { $ne: excludeSessionId };
      }

      const result = await Session.updateMany(
        filter,
        { $set: { isActive: false, updatedAt: new Date() } }
      );

      // Invalidate all cached sessions for this user
      sessionCache.invalidateUserSessions(userId);

      logger.info('[SessionService] Deactivated sessions for user', { count: result.modifiedCount, userId });
      return result.modifiedCount;
    } catch (error) {
      logger.error('[SessionService] Failed to deactivate all user sessions', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'deactivateAllUserSessions',
        userId,
      });
      // Return 0 on error for graceful degradation - consistent error handling pattern
      return 0;
    }
  }

  /**
   * Get all active sessions for a user
   * 
   * Consistent error handling: Returns empty array on error (non-throwing pattern)
   * for operations that should gracefully degrade.
   * 
   * @param userId - The user ID to get sessions for
   * @returns Array of active sessions (empty array on error)
   */
  async getUserActiveSessions(userId: string): Promise<ISession[]> {
    try {
      const sessions = await Session.find({
        userId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      })
      .sort({ 
        'deviceInfo.lastActive': -1, // Most recent first
        'sessionId': 1 // Secondary sort by sessionId for stability
      })
      .lean();

      return sessions as unknown as ISession[];
    } catch (error) {
      logger.error('[SessionService] Failed to get user active sessions', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'getUserActiveSessions',
        userId,
      });
      // Return empty array on error for graceful degradation - consistent error handling pattern
      return [];
    }
  }

  /**
   * Validate session and get user by sessionId (for direct sessionId lookups)
   * 
   * Consistent error handling: Returns null on error (non-throwing pattern)
   * for operations that should gracefully degrade.
   * 
   * @param sessionId - The session ID to validate
   * @param populateUser - Whether to populate user data (default: true)
   * @returns Session and optional user, or null if not found or error
   */
  async validateSessionById(
    sessionId: string, 
    populateUser: boolean = true
  ): Promise<{ session: ISession; user?: any } | null> {
    try {
      if (populateUser) {
        return await this.getSessionWithUser(sessionId, { useCache: true });
      }

      const session = await this.getSession(sessionId, true);
      if (!session) {
        return null;
      }

      return { session };
    } catch (error) {
      logger.error('[SessionService] Failed to validate session by ID', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'validateSessionById',
        sessionId,
      });
      // Return null on error for graceful degradation - consistent error handling pattern
      return null;
    }
  }

  /**
   * Get access token by session ID (with auto-refresh if expired)
   * 
   * Consistent error handling: Returns null on error (non-throwing pattern)
   * for operations that should gracefully degrade.
   * 
   * @param sessionId - The session ID to get access token for
   * @returns Access token and expiration date, or null if not found or error
   */
  async getAccessToken(sessionId: string): Promise<{ accessToken: string; expiresAt: Date } | null> {
    try {
      const session = await this.getSession(sessionId, true);
      if (!session) {
        return null;
      }

      // Check if access token is expired
      try {
        const decoded = jwt.verify(session.accessToken, process.env.ACCESS_TOKEN_SECRET!) as any;
        const currentTime = Math.floor(Date.now() / 1000);
        
        if (decoded.exp && decoded.exp < currentTime) {
          // Token expired, refresh it
          const refreshResult = await this.refreshTokens(session.refreshToken);
          if (!refreshResult) {
            return null;
          }
          
          return {
            accessToken: refreshResult.accessToken,
            expiresAt: refreshResult.session.expiresAt
          };
        }
      } catch (tokenError) {
        // Token invalid, try to refresh
        const refreshResult = await this.refreshTokens(session.refreshToken);
        if (!refreshResult) {
          return null;
        }
        
        return {
          accessToken: refreshResult.accessToken,
          expiresAt: refreshResult.session.expiresAt
        };
      }

      return {
        accessToken: session.accessToken,
        expiresAt: session.expiresAt
      };
    } catch (error) {
      logger.error('[SessionService] Failed to get access token', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'getAccessToken',
        sessionId,
      });
      // Return null on error for graceful degradation - consistent error handling pattern
      return null;
    }
  }
}

// Export singleton instance
const sessionService = new SessionService();
export default sessionService;

