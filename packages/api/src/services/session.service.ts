import Session, { ISession } from '../models/Session';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import sessionCache from '../utils/sessionCache';
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
        sessionCache.set(sessionId, session as ISession);
      }

      return session as ISession;
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

      // Try cache first for session
      if (useCache) {
        const cached = sessionCache.get(sessionId);
        if (cached) {
          // User data is not cached with session (keeps cache lean and user data fresh)
          // This is a single indexed lookup, optimized for performance
          const user = await User.findById(cached.userId).select(select);
          if (user) {
            return { session: cached, user };
          }
          // If user not found, session is invalid - invalidate cache
          sessionCache.invalidate(sessionId);
          return null;
        }
      }

      // Fallback to database with populate (single query, more efficient)
      const session = await Session.findOne({
        sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).populate('userId', select);

      if (!session || !session.userId) {
        return null;
      }

      // Cache the session (user not cached to keep cache size manageable)
      if (useCache) {
        sessionCache.set(sessionId, session);
      }

      return {
        session,
        user: typeof session.userId === 'object' ? session.userId : null
      };
    } catch (error) {
      logger.error('[SessionService] Failed to get session with user', error instanceof Error ? error : new Error(String(error)), {
        component: 'SessionService',
        method: 'getSessionWithUser',
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
      // First validate the token format with enhanced error handling
      const validationResult = validateAccessToken(accessToken);
      if (!validationResult.valid || !validationResult.payload) {
        // Log specific error type for better debugging
        if (validationResult.error === 'expired') {
          logger.debug('[SessionService] Access token expired');
        } else if (validationResult.error === 'invalid') {
          logger.debug('[SessionService] Access token invalid');
        }
        return null;
      }

      const payload = validationResult.payload;
      if (!payload.sessionId) {
        return null;
      }

      const sessionId = payload.sessionId;

      // Get session (with cache)
      const result = await this.getSessionWithUser(sessionId, { useCache: true });
      if (!result) {
        logger.debug('[SessionService] Session not found or expired');
        return null;
      }

      const { session } = result;

      // Verify access token matches
      if (session.accessToken !== accessToken) {
        logger.debug('[SessionService] Access token mismatch');
        sessionCache.invalidate(sessionId);
        return null;
      }

      // Update last activity (batched/throttled)
      if (sessionCache.shouldUpdateLastActive(sessionId)) {
        // Update in background without blocking
        this.updateLastActivity(sessionId).catch(err => {
          logger.error('[SessionService] Failed to update last activity', err instanceof Error ? err : new Error(String(err)), {
            component: 'SessionService',
            method: 'updateLastActivity',
            sessionId,
          });
        });
      }

      return {
        session,
        user: result.user,
        payload
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
      
      // Update in database (optimized query)
      // Note: updateOne() doesn't return a document, so .lean() is not applicable
      await Session.updateOne(
        { sessionId, isActive: true },
        { 
          $set: { 
            'deviceInfo.lastActive': now,
            updatedAt: now
          } 
        }
      );

      // Update cache if present
      const cached = sessionCache.get(sessionId);
      if (cached) {
        cached.deviceInfo.lastActive = now;
        sessionCache.set(sessionId, cached);
      }

      logger.debug('[SessionService] Updated last activity for session', { sessionId: sessionId.substring(0, 8) });
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

      // Extract and register device info
      let deviceInfo = extractDeviceInfo(req, undefined, deviceName);
      
      if (deviceFingerprint) {
        const fingerprint = generateDeviceFingerprint(deviceFingerprint);
        deviceInfo = await registerDevice(deviceInfo, fingerprint);
      }

      // Check for existing active session on this device
      const existingSession = await Session.findOne({
        userId,
        deviceId: deviceInfo.deviceId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).lean();

      if (existingSession) {
        // Reuse existing session - update and extend
        const sessionId = existingSession.sessionId;
        
        // Update device info and extend expiration
        const expiresAt = new Date(Date.now() + SESSION_EXPIRES_IN);
        const updated = await Session.findOneAndUpdate(
          { _id: existingSession._id },
          {
            $set: {
              expiresAt,
              'deviceInfo.lastActive': new Date(),
              'deviceInfo.deviceName': deviceName || existingSession.deviceInfo?.deviceName,
              'deviceInfo.ipAddress': deviceInfo.ipAddress,
              'deviceInfo.userAgent': deviceInfo.userAgent,
              updatedAt: new Date()
            }
          },
          { new: true }
        );

        if (updated) {
          sessionCache.set(sessionId, updated as ISession);
          logger.info(`[SessionService] Reused existing session for user: ${userId}`);
          return updated as ISession;
        }
      }

      // Create new session
      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_EXPIRES_IN);
      
      // Generate tokens
      const { accessToken, refreshToken } = generateSessionTokens(
        userId, 
        sessionId, 
        deviceInfo.deviceId
      );

      // Create session document
      const sessionData = {
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
          lastActive: new Date()
        },
        accessToken,
        refreshToken,
        isActive: true,
        expiresAt,
        lastRefresh: new Date()
      };

      const session = new Session(sessionData);
      await session.save();

      // Cache the session
      sessionCache.set(sessionId, session);

      logger.info('[SessionService] Created new session', { userId, deviceId: deviceInfo.deviceId });
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
      // Validate refresh token with enhanced error handling
      const validationResult = validateRefreshToken(refreshToken);
      if (!validationResult.valid || !validationResult.payload) {
        // Provide specific error information for better debugging
        if (validationResult.error === 'expired') {
          logger.debug('[SessionService] Refresh token expired');
          throw new Error('Refresh token expired');
        }
        logger.debug('[SessionService] Invalid refresh token', { error: validationResult.error });
        throw new Error('Invalid refresh token');
      }

      const payload = validationResult.payload;
      if (!payload.sessionId) {
        throw new Error('Invalid refresh token: missing sessionId');
      }

      const sessionId = payload.sessionId;

      // Get session (bypass cache for security - always check DB for token refresh)
      const session = await Session.findOne({
        sessionId,
        refreshToken,
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      if (!session) {
        throw new Error('Session not found or expired');
      }

      // Generate new tokens
      const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateSessionTokens(
        payload.userId || session.userId.toString(),
        sessionId,
        payload.deviceId || session.deviceId
      );

      // Update session with new tokens
      session.accessToken = newAccessToken;
      session.refreshToken = newRefreshToken;
      session.lastRefresh = new Date();
      session.deviceInfo.lastActive = new Date();
      await session.save();

      // Invalidate cache and re-cache with new tokens
      sessionCache.invalidate(sessionId);
      sessionCache.set(sessionId, session);

      logger.info('[SessionService] Refreshed tokens for session', { sessionId: sessionId.substring(0, 8) });
      
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

      return sessions as ISession[];
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

