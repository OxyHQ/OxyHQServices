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

const SESSION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

export interface SessionValidationResult {
  session: ISession;
  user: any;
  payload: any;
}

export interface SessionCreateOptions {
  deviceName?: string;
  deviceFingerprint?: DeviceFingerprint;
}

export interface SessionRefreshResult {
  accessToken: string;
  refreshToken: string;
  session: ISession;
}

class SessionService {
  /**
   * Get session by sessionId with caching
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
      logger.error('[SessionService] Failed to get session:', error);
      return null;
    }
  }

  /**
   * Get session with user populated
   */
  async getSessionWithUser(
    sessionId: string, 
    options: { useCache?: boolean; select?: string } = {}
  ): Promise<{ session: ISession; user: any } | null> {
    try {
      const { useCache = true, select = '-password' } = options;

      // Try cache first
      if (useCache) {
        const cached = sessionCache.get(sessionId);
        if (cached) {
          // Need to populate user separately
          const user = await User.findById(cached.userId).select(select);
          if (user) {
            return { session: cached, user };
          }
        }
      }

      // Fallback to database with populate
      const session = await Session.findOne({
        sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).populate('userId', select);

      if (!session || !session.userId) {
        return null;
      }

      // Cache the session
      if (useCache) {
        sessionCache.set(sessionId, session);
      }

      return {
        session,
        user: typeof session.userId === 'object' ? session.userId : null
      };
    } catch (error) {
      logger.error('[SessionService] Failed to get session with user:', error);
      return null;
    }
  }

  /**
   * Validate session by access token
   */
  async validateSession(accessToken: string): Promise<SessionValidationResult | null> {
    try {
      // First validate the token format
      const payload = validateAccessToken(accessToken);
      if (!payload || !payload.sessionId) {
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
          logger.error('[SessionService] Failed to update last activity:', err);
        });
      }

      return {
        session,
        user: result.user,
        payload
      };
    } catch (error) {
      logger.error('[SessionService] Session validation failed:', error);
      return null;
    }
  }

  /**
   * Update session last activity (non-blocking, batched)
   */
  async updateLastActivity(sessionId: string): Promise<void> {
    try {
      const now = new Date();
      
      // Update in database (optimized query)
      await Session.updateOne(
        { sessionId, isActive: true },
        { 
          $set: { 
            'deviceInfo.lastActive': now,
            updatedAt: now
          } 
        }
      ).lean();

      // Update cache if present
      const cached = sessionCache.get(sessionId);
      if (cached) {
        cached.deviceInfo.lastActive = now;
        sessionCache.set(sessionId, cached);
      }

      logger.debug(`[SessionService] Updated last activity for session: ${sessionId.substring(0, 8)}...`);
    } catch (error) {
      logger.error('[SessionService] Failed to update last activity:', error);
      sessionCache.clearPendingLastActive(sessionId);
    }
  }

  /**
   * Create a new session for a user
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

      logger.info(`[SessionService] Created new session for user: ${userId} on device: ${deviceInfo.deviceId}`);
      return session;
    } catch (error) {
      logger.error('[SessionService] Failed to create session:', error);
      throw error;
    }
  }

  /**
   * Refresh session tokens
   */
  async refreshTokens(refreshToken: string): Promise<SessionRefreshResult | null> {
    try {
      // Validate refresh token
      const payload = validateRefreshToken(refreshToken);
      if (!payload || !payload.sessionId) {
        throw new Error('Invalid refresh token');
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

      logger.info(`[SessionService] Refreshed tokens for session: ${sessionId.substring(0, 8)}...`);
      
      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        session
      };
    } catch (error) {
      logger.error('[SessionService] Failed to refresh tokens:', error);
      return null;
    }
  }

  /**
   * Deactivate a session
   */
  async deactivateSession(sessionId: string): Promise<boolean> {
    try {
      const result = await Session.updateOne(
        { sessionId, isActive: true },
        { $set: { isActive: false, updatedAt: new Date() } }
      );

      // Invalidate cache
      sessionCache.invalidate(sessionId);

      logger.info(`[SessionService] Deactivated session: ${sessionId.substring(0, 8)}...`);
      return result.modifiedCount > 0;
    } catch (error) {
      logger.error('[SessionService] Failed to deactivate session:', error);
      return false;
    }
  }

  /**
   * Deactivate all sessions for a user
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

      logger.info(`[SessionService] Deactivated ${result.modifiedCount} sessions for user: ${userId}`);
      return result.modifiedCount;
    } catch (error) {
      logger.error('[SessionService] Failed to deactivate all user sessions:', error);
      return 0;
    }
  }

  /**
   * Get all active sessions for a user
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
      logger.error('[SessionService] Failed to get user active sessions:', error);
      return [];
    }
  }

  /**
   * Validate session and get user by sessionId (for direct sessionId lookups)
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
      logger.error('[SessionService] Failed to validate session by ID:', error);
      return null;
    }
  }

  /**
   * Get access token by session ID (with auto-refresh if expired)
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
      logger.error('[SessionService] Failed to get access token:', error);
      return null;
    }
  }
}

// Export singleton instance
const sessionService = new SessionService();
export default sessionService;

