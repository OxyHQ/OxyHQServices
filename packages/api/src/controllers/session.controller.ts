import type { Request, Response } from 'express';
import { User, buildAuthMethod } from '../models/User';
import Session from '../models/Session';
import AuthChallenge from '../models/AuthChallenge';
import type { SessionAuthResponse, ClientSession } from '../types/session';
import {
  getDeviceActiveSessions,
  logoutAllDeviceSessions
} from '../utils/deviceUtils';
import { emitSessionUpdate } from '../server';
import Notification from '../models/Notification';
import SignatureService from '../services/signature.service';
import sessionService from '../services/session.service';
import sessionCache from '../utils/sessionCache';
import { logger } from '../utils/logger';
import { formatUserResponse, type UserLike } from '../utils/userTransform';
import securityActivityService from '../services/securityActivityService';
import { finalizeDeviceLogin } from '../services/deviceLogin.service';
import type { AuthRequest } from '../middleware/auth';
import { exactCaseInsensitiveUsernameRegex } from '../utils/resolveUserIdentifier';
import { INVALID_USERNAME_MESSAGE, USERNAME_PATTERN, normalizeUsername } from '../utils/username';
import type { SessionCreateOptions } from '../types/session.types';

export function sessionCreateOptionsFromBody(body: {
  deviceName?: string;
  deviceFingerprint?: string;
  deviceId?: string;
}): SessionCreateOptions {
  const opts: SessionCreateOptions = {
    deviceName: body.deviceName,
    deviceFingerprint: body.deviceFingerprint,
  };
  if (typeof body.deviceId === 'string' && body.deviceId.trim()) {
    opts.deviceId = body.deviceId.trim();
  }
  return opts;
}

/**
 * Extract the authenticated user's MongoDB ObjectId string from an
 * `AuthRequest` populated by `authMiddleware`. The middleware sets
 * `req.user._id` to the canonical Mongo ObjectId, but the IUser interface
 * also exposes a virtual `id` (which may equal `publicKey`). We always
 * want the ObjectId here so we can compare against Session.userId.
 */
function getAuthenticatedUserId(req: AuthRequest): string | null {
  const user = req.user;
  if (!user) return null;
  if (user._id) return user._id.toString();
  return null;
}

// Challenge expiration time (5 minutes)
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// More robust email validation regex (RFC 5322 compliant)
// Validates: local-part@domain with proper character restrictions
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildSessionAuthResponse(session: { sessionId: string; deviceId: string; expiresAt: Date; accessToken?: string }, user: UserLike): SessionAuthResponse | null {
  const userData = formatUserResponse(user);
  if (!userData) {
    return null;
  }

  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    expiresAt: session.expiresAt.toISOString(),
    accessToken: session.accessToken,
    user: {
      id: userData.id,
      username: userData.username,
      avatar: userData.avatar,
    },
  };
}

export class SessionController {
  
  /**
   * Register a new user with public key authentication
   * No passwords needed - identity is verified via signature
   */
  static async register(req: Request, res: Response) {
    try {
      const { publicKey, signature, timestamp, email, username } = req.body;

      // Validate required fields
      if (!publicKey || !signature || !timestamp) {
        return res.status(400).json({ 
          message: 'Public key, signature, and timestamp are required' 
        });
      }

      // Validate public key format
      if (!SignatureService.isValidPublicKey(publicKey)) {
        return res.status(400).json({ message: 'Invalid public key format' });
      }

      // Verify the registration signature
      const isValidSignature = SignatureService.verifyRegistrationSignature(
        publicKey,
        signature,
        timestamp
      );

      if (!isValidSignature) {
        return res.status(401).json({ 
          message: 'Invalid signature. Please sign the registration request with your private key.' 
        });
      }

      // Check if user already exists (by publicKey only - that's the identity)
      const existingUser = await User.findOne({ publicKey });

      if (existingUser) {
        return res.status(409).json({
          message: 'Identity already registered'
        });
      }

      let normalizedEmail: string | undefined;
      if (email) {
        if (typeof email !== 'string') {
          return res.status(400).json({ message: 'Please provide a valid email address' });
        }

        normalizedEmail = normalizeEmail(email);
        if (!EMAIL_REGEX.test(normalizedEmail)) {
          return res.status(400).json({ message: 'Please provide a valid email address' });
        }
      }

      let normalizedUsername: string | undefined;
      if (username) {
        if (typeof username !== 'string') {
          return res.status(400).json({ message: 'Username must be a string' });
        }

        normalizedUsername = normalizeUsername(username);
        if (!USERNAME_PATTERN.test(normalizedUsername)) {
          return res.status(400).json({ message: INVALID_USERNAME_MESSAGE });
        }
      }

      if (normalizedEmail) {
        const existingEmail = await User.findOne({ email: normalizedEmail }).select('_id').lean();
        if (existingEmail) {
          return res.status(409).json({ message: 'Email already registered' });
        }
      }

      if (normalizedUsername) {
        const existingUsername = await User.findOne({ username: exactCaseInsensitiveUsernameRegex(normalizedUsername) }).select('_id').lean();
        if (existingUsername) {
          return res.status(409).json({ message: 'Username already taken' });
        }
      }

      // Create new user (identity is the publicKey). Record the origin auth
      // method so the account's provenance is captured consistently with the
      // social-auth path, instead of leaving `authMethods` empty.
      const user = new User({
        publicKey,
        email: normalizedEmail,
        username: normalizedUsername,
        authMethods: [buildAuthMethod('identity', { publicKey })],
      });

      await user.save();

      // Create welcome notification (non-blocking - don't fail registration if this fails)
      try {
        await new Notification({
          recipientId: user._id,
          actorId: user._id,
          type: 'welcome',
          entityId: user._id,
          entityType: 'profile',
          read: false
        }).save();
      } catch (notificationError) {
        logger.error('Failed to create welcome notification during registration', notificationError, {
          component: 'SessionController',
          method: 'register',
          userId: user._id.toString(),
        });
      }

      const userData = formatUserResponse(user);
      if (!userData) {
        return res.status(500).json({ message: 'Failed to format user data' });
      }

      return res.status(201).json({
        message: 'Identity registered successfully',
        user: userData
      });
    } catch (error: any) {
      // Handle MongoDB duplicate key error (E11000) - handles race condition where user was created between check and save
      if (error.code === 11000) {
        if (error.keyPattern?.publicKey) {
          return res.status(409).json({
            message: 'Identity already registered'
          });
        }
        if (error.keyPattern?.email) {
          return res.status(409).json({ message: 'Email already registered' });
        }
        if (error.keyPattern?.username) {
          return res.status(409).json({ message: 'Username already taken' });
        }
      }

      logger.error('Registration error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      logger.error('Registration error details:', { errorMessage });
      
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  /**
   * Request an authentication challenge
   * The client will sign this challenge to prove ownership of the private key
   */
  static async requestChallenge(req: Request, res: Response) {
    try {
      const { publicKey } = req.body;

      if (!publicKey) {
        return res.status(400).json({ message: 'Public key is required' });
      }

      if (!SignatureService.isValidPublicKey(publicKey)) {
        return res.status(400).json({ message: 'Invalid public key format' });
      }

      // Check if user exists (optional - can allow challenges for unregistered keys)
      const user = await User.findOne({ publicKey });
      if (!user) {
        return res.status(404).json({ message: 'User not found. Please register first.' });
      }

      // Generate challenge
      const challenge = SignatureService.generateChallenge();
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

      // Store challenge in database
      await AuthChallenge.create({
        publicKey,
        challenge,
        expiresAt,
        used: false,
      });

      return res.json({
        challenge,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      logger.error('Request challenge error:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  /**
   * Verify a signed challenge and create a session
   * This is the main authentication endpoint
   */
  static async verifyChallenge(req: Request, res: Response) {
    try {
      const { publicKey, challenge, signature, timestamp, deviceName, deviceFingerprint, deviceId } = req.body;

      if (!publicKey || !challenge || !signature || !timestamp) {
        return res.status(400).json({
          message: 'Public key, challenge, signature, and timestamp are required'
        });
      }

      // Find and validate the challenge (read-only query with .lean() for performance)
      const authChallenge = await AuthChallenge.findOne({
        publicKey,
        challenge,
        used: false,
        expiresAt: { $gt: new Date() }
      }).lean();

      if (!authChallenge) {
        return res.status(401).json({ 
          message: 'Invalid or expired challenge. Please request a new one.' 
        });
      }

      // Verify the cryptographic signature
      const isValid = SignatureService.verifyChallengeResponse(
        publicKey,
        challenge,
        signature,
        timestamp
      );

      if (!isValid) {
        return res.status(401).json({ message: 'Invalid signature' });
      }

      // Atomically mark challenge as used (prevents race conditions)
      await AuthChallenge.findOneAndUpdate(
        { _id: authChallenge._id },
        { $set: { used: true } },
        { new: false }
      );

      // Find user by public key (read-only query with .lean() for performance)
      const user = await User.findOne({ publicKey }).lean();
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Create session
      const session = await sessionService.createSession(
        user._id.toString(),
        req,
        sessionCreateOptionsFromBody({ deviceName, deviceFingerprint, deviceId }),
      );
      const sessionAfterCreate = Date.now();

      // Log security event for sign-in only if this is a new session
      // More reliable detection: check if session was created during this request
      // New sessions will have createdAt very close to current time
      // Reused sessions will have createdAt much older
      const sessionCreatedAt = new Date(session.createdAt).getTime();
      const sessionAge = sessionAfterCreate - sessionCreatedAt;
      const isNewSession = sessionAge < 10000; // If session was created within last 10 seconds, it's new

      if (isNewSession) {
        try {
          await securityActivityService.logSignIn(
            user._id.toString(),
            req,
            session.deviceId,
            {
              deviceName: deviceName || session.deviceInfo?.deviceName,
              deviceType: session.deviceInfo?.deviceType,
              platform: session.deviceInfo?.platform,
            }
          );
        } catch (error) {
          // Don't fail the sign-in if logging fails
          logger.error('Failed to log security event for sign-in', error instanceof Error ? error : new Error(String(error)), {
            component: 'SessionController',
            method: 'verifyChallenge',
            userId: user._id.toString(),
          });
        }
      }

      // Emit session update for real-time updates
      emitSessionUpdate(user._id.toString(), {
        type: 'session_created',
        sessionId: session.sessionId,
        deviceId: session.deviceId
      });

      const userData = formatUserResponse(user);
      if (!userData) {
        return res.status(500).json({ message: 'Failed to format user data' });
      }

      const response: SessionAuthResponse & { deviceSecret?: string } = {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        expiresAt: session.expiresAt.toISOString(),
        accessToken: session.accessToken,
        user: {
          id: userData.id,
          username: userData.username,
          avatar: userData.avatar
        }
      };

      // Register into the device set (add-only) + broadcast, and mint the
      // deviceSecret the client persists first-party. Best-effort.
      const verifyDeviceExtras = await finalizeDeviceLogin({
        session,
        userId: user._id.toString(),
      });
      if (verifyDeviceExtras.deviceSecret) {
        response.deviceSecret = verifyDeviceExtras.deviceSecret;
      }

      res.json(response);
    } catch (error) {
      logger.error('Verify challenge error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get user data by session ID. Requires bearer auth (see route mount) and
  // verifies the authenticated user owns the requested session — otherwise
  // returns 404 (do NOT use 403 here, that would leak session existence
  // across user boundaries). Fixes C1 / H3.
  static async getUserBySession(req: AuthRequest, res: Response) {
    try {
      const { sessionId } = req.params;
      const authenticatedUserId = getAuthenticatedUserId(req);

      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }
      if (!authenticatedUserId) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Use session service for optimized lookup with caching
      const result = await sessionService.validateSessionById(sessionId, true);

      if (!result?.session || !result.user) {
        return res.status(404).json({ message: 'Session not found' });
      }

      const sessionOwnerId = result.session.userId?.toString();
      if (sessionOwnerId !== authenticatedUserId) {
        // Treat cross-user lookups as "not found" so callers can't probe.
        return res.status(404).json({ message: 'Session not found' });
      }

      const userData = formatUserResponse(result.user);
      if (!userData) {
        return res.status(500).json({ message: 'Failed to format user data' });
      }

      res.json(userData);
    } catch (error) {
      logger.error('Get user by session error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get all sessions for a user. Requires bearer auth and verifies the
  // authenticated user owns the referenced session — otherwise an attacker
  // with a stolen sessionId could enumerate every active session for the
  // owner (C1 / H3).
  static async getUserSessions(req: AuthRequest, res: Response) {
    try {
      const { sessionId } = req.params;
      const authenticatedUserId = getAuthenticatedUserId(req);

      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }
      if (!authenticatedUserId) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Find current session to get user ID
      const currentSessionResult = await sessionService.validateSessionById(sessionId, false);

      if (!currentSessionResult?.session) {
        return res.status(404).json({ message: 'Session not found' });
      }

      const sessionOwnerId = currentSessionResult.session.userId?.toString();
      if (sessionOwnerId !== authenticatedUserId) {
        return res.status(404).json({ message: 'Session not found' });
      }

      // Get all active sessions for this user using service
      const sessions = await sessionService.getUserActiveSessions(sessionOwnerId);

      // Transform sessions for client
      const clientSessions: ClientSession[] = sessions.map(session => ({
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        deviceName: session.deviceInfo?.deviceName,
        isActive: session.isActive,
        userId: session.userId.toString()
      }));

      res.json(clientSessions);
    } catch (error) {
      logger.error('Get user sessions error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Logout from a specific session
  static async logoutSession(req: Request, res: Response) {
    try {
      const { sessionId, targetSessionId } = req.params;
      const bodyTargetSessionId = req.body?.targetSessionId;

      // Use targetSessionId from URL params if provided, otherwise from body
      const sessionIdToLogout = targetSessionId || bodyTargetSessionId || sessionId;

      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }

      // Get session info before deactivating to retrieve userId and deviceId for socket notification
      const sessionResult = await sessionService.validateSessionById(sessionIdToLogout, false);
      const session = sessionResult?.session;
      const userId = session?.userId?.toString();
      const deviceId = session?.deviceId;

      // Use session service to deactivate
      const success = await sessionService.deactivateSession(sessionIdToLogout);

      if (!success) {
        return res.status(404).json({ message: 'Session not found' });
      }

      // Emit socket notification to notify remote devices
      if (userId) {
        emitSessionUpdate(userId, {
          type: 'session_removed',
          sessionId: sessionIdToLogout,
          deviceId: deviceId || null
        });
      }

      // Log security event for sign-out
      if (userId) {
        try {
          await securityActivityService.logSignOut(
            userId,
            req,
            deviceId || undefined
          );
        } catch (error) {
          // Don't fail the logout if logging fails
          logger.error('Failed to log security event for sign-out:', error);
        }
      }

      logger.info(`Logged out session: ${sessionIdToLogout.substring(0, 8)}...`);
      res.json({ success: true, message: 'Session logged out successfully' });
    } catch (error) {
      logger.error('Logout session error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Logout all sessions for current user
  static async logoutAllSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }

      // Find current session to get user ID
      const currentSessionResult = await sessionService.validateSessionById(sessionId, false);

      if (!currentSessionResult || !currentSessionResult.session) {
        return res.status(401).json({ message: 'Invalid session', code: 'INVALID_SESSION' });
      }

      const userId = currentSessionResult.session.userId.toString();

      // Get list of sessionIds that will be deactivated before deactivating
      const now = new Date();
      const sessionsToDeactivate = await Session.find({
        userId,
        isActive: true,
        sessionId: { $ne: sessionId },
        expiresAt: { $gt: now }
      }).select('sessionId').lean().exec();
      
      const sessionIds = sessionsToDeactivate.map(s => s.sessionId);

      // Deactivate all sessions for this user except the current one
      const count = await sessionService.deactivateAllUserSessions(userId, sessionId);

      // Emit socket notification with list of removed sessionIds
      if (sessionIds.length > 0) {
        emitSessionUpdate(userId, {
          type: 'sessions_removed',
          sessionIds: sessionIds
        });
      }

      logger.info(`Logged out ${count} sessions for user ${userId}`);

      res.json({
        success: true,
        message: `Logged out ${count} sessions`,
        sessionsLoggedOut: count
      });
    } catch (error) {
      logger.error('Logout all sessions error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Validate session with user data included
  static async validateSession(req: Request, res: Response) {
    try {
      // Try to get session ID from header first, then fallback to URL parameter
      const sessionId = req.header('x-session-id') || req.params.sessionId;

      if (!sessionId) {
        return res.status(400).json({ 
          message: 'Session ID is required',
          hint: 'Provide sessionId in URL parameter or x-session-id header'
        });
      }

      // Use session service for optimized validation with caching
      const result = await sessionService.validateSessionById(sessionId, true);

      if (!result || !result.session || !result.user) {
        return res.status(401).json({ 
          message: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      const userData = formatUserResponse(result.user);
      if (!userData) {
        return res.status(500).json({ message: 'Failed to format user data' });
      }

      res.json({
        valid: true,
        expiresAt: result.session.expiresAt.toISOString(),
        lastActivity: result.session.deviceInfo.lastActive.toISOString(),
        deviceId: result.session.deviceId,
        user: userData
      });
    } catch (error) {
      logger.error('Validate session error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Validate session from header with device fingerprint validation
  static async validateSessionFromHeader(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId;

      if (!sessionId) {
        return res.status(400).json({ 
          message: 'Session ID is required',
          hint: 'Provide sessionId as URL parameter'
        });
      }

      // Use session service for optimized validation with caching
      const result = await sessionService.validateSessionById(sessionId, true);

      if (!result || !result.session || !result.user) {
        return res.status(401).json({ 
          message: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      // Optional device fingerprint validation
      const deviceFingerprint = req.header('x-device-fingerprint');
      if (deviceFingerprint && result.session.deviceInfo?.fingerprint) {
        if (deviceFingerprint !== result.session.deviceInfo.fingerprint) {
          logger.debug(`Device fingerprint mismatch for session ${sessionId.substring(0, 8)}...`);
        }
      }

      const userData = formatUserResponse(result.user);
      if (!userData) {
        return res.status(500).json({ message: 'Failed to format user data' });
      }

      res.json({
        valid: true,
        expiresAt: result.session.expiresAt.toISOString(),
        lastActivity: result.session.deviceInfo.lastActive.toISOString(),
        deviceId: result.session.deviceId,
        user: userData,
        sessionId: result.session.sessionId
      });
    } catch (error) {
      logger.error('Validate session from header error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get device sessions for a specific device
  static async getDeviceSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }

      const currentSessionResult = await sessionService.validateSessionById(sessionId, false);
      if (!currentSessionResult || !currentSessionResult.session) {
        return res.status(401).json({ message: 'Invalid session', code: 'INVALID_SESSION' });
      }

      const deviceSessions = await getDeviceActiveSessions(currentSessionResult.session.deviceId, sessionId);
      res.json(deviceSessions);
    } catch (error) {
      logger.error('Get device sessions error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Batch endpoint to get multiple user profiles by session IDs
  static async getUsersBySessions(req: Request, res: Response) {
    try {
      const { sessionIds } = req.body;

      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        return res.status(400).json({ message: 'sessionIds array is required' });
      }

      // Deduplicate sessionIds before processing
      const uniqueSessionIds = Array.from(new Set(sessionIds));
      
      // Limit batch size to prevent abuse
      const MAX_BATCH_SIZE = 20;
      const limitedSessionIds = uniqueSessionIds.slice(0, MAX_BATCH_SIZE);

      const now = new Date();
      const sessions = await Session.find({
        sessionId: { $in: limitedSessionIds },
        isActive: true,
        expiresAt: { $gt: now }
      })
      .populate('userId', 'username email avatar name publicKey')
      .lean()
      .exec();

      // Transform to user data format
      const usersMap = new Map<string, any>();
      
      for (const session of sessions) {
        if (!session.userId || typeof session.userId !== 'object') continue;
        
        const user = session.userId;
        const userData = formatUserResponse(user);
        if (!userData?.id) continue;
        
        usersMap.set(session.sessionId, userData);
      }

      // Return array matching input order, with null for missing sessions
      const result = limitedSessionIds.map(sessionId => ({
        sessionId,
        user: usersMap.get(sessionId) || null
      }));

      res.json(result);
    } catch (error) {
      logger.error('Get users by sessions batch error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Logout all sessions for a specific device
  static async logoutAllDeviceSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }

      // Get current session using service
      const currentSessionResult = await sessionService.validateSessionById(sessionId, false);
      if (!currentSessionResult || !currentSessionResult.session) {
        return res.status(401).json({ message: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Logout all sessions for this device
      const result = await logoutAllDeviceSessions(currentSessionResult.session.deviceId);

      res.json(result);
    } catch (error) {
      logger.error('Logout all device sessions error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Update device name for a session
  static async updateDeviceName(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const { deviceName } = req.body;

      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }

      if (!deviceName) {
        return res.status(400).json({ message: 'Device name is required' });
      }

      // Get session using service
      const result = await sessionService.validateSessionById(sessionId, false);
      if (!result || !result.session) {
        return res.status(404).json({ message: 'Session not found' });
      }

      // Update device name in database
      await Session.updateOne(
        { sessionId },
        { 
          $set: { 
            'deviceInfo.deviceName': deviceName,
            updatedAt: new Date()
          } 
        }
      );

      // Invalidate cache so next lookup gets fresh data
      sessionCache.invalidate(sessionId);

      res.json({ 
        success: true, 
        message: 'Device name updated successfully',
        deviceName: deviceName
      });
    } catch (error) {
      logger.error('Update device name error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  /**
   * Get user by public key
   * Useful for looking up users without a session
   */
  static async getUserByPublicKey(req: Request, res: Response) {
    try {
      const { publicKey } = req.params;

      if (!publicKey) {
        return res.status(400).json({ message: 'Public key is required' });
      }

      if (!SignatureService.isValidPublicKey(publicKey)) {
        return res.status(400).json({ message: 'Invalid public key format' });
      }

      const user = await User.findOne({ publicKey });

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const userData = formatUserResponse(user);
      if (!userData) {
        return res.status(500).json({ message: 'Failed to format user data' });
      }

      res.json(userData);
    } catch (error) {
      logger.error('Get user by public key error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}
