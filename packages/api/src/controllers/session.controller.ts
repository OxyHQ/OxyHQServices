import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import Session from '../models/Session';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { SessionAuthResponse, ClientSession } from '../types/session';
import { 
  getDeviceActiveSessions,
  logoutAllDeviceSessions
} from '../utils/deviceUtils';
import { emitSessionUpdate } from '../server';
import Notification from '../models/Notification';
import RecoveryCode from '../models/RecoveryCode';
import Totp from '../models/Totp';
import RecoveryFactors from '../models/RecoveryFactors';
import { authenticator } from 'otplib';
import sessionService from '../services/session.service';
import sessionCache from '../utils/sessionCache';
import { logger } from '../utils/logger';

const MFA_TOKEN_SECRET: import('jsonwebtoken').Secret = (process.env.MFA_TOKEN_SECRET || process.env.REFRESH_TOKEN_SECRET!) as import('jsonwebtoken').Secret;
const MFA_TOKEN_TTL_SECONDS: number = Number(process.env.MFA_TOKEN_TTL_SECONDS || 300); // default 5 minutes

export class SessionController {
  
  // Register a new user account
  static async register(req: Request, res: Response) {
    try {
      let { username, email, password } = req.body;

      if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
      }

      // Sanitize username: only allow alphanumeric characters
      username = username.replace(/[^a-zA-Z0-9]/g, '');

      // Validate username format (alphanumeric only, 3-30 chars)
      if (!username || username.length < 3 || username.length > 30) {
        return res.status(400).json({ error: 'Username must be between 3 and 30 characters long' });
      }

      if (!/^[a-zA-Z0-9]{3,30}$/.test(username)) {
        return res.status(400).json({ error: 'Username can only contain letters and numbers' });
      }

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [{ username }, { email }]
      });

      if (existingUser) {
        return res.status(409).json({
          error: 'User already exists',
          details: {
            username: existingUser.username === username ? 'Username is already taken' : null,
            email: existingUser.email === email ? 'Email is already registered' : null
          }
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create new user
      const user = new User({
        username,
        email,
        password: hashedPassword,
      });

      await user.save();

      // Create welcome notification
      await new Notification({
        recipientId: user._id,
        actorId: user._id,
        type: 'welcome',
        entityId: user._id,
        entityType: 'profile',
        read: false
      }).save();

      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          name: user.name,
          privacySettings: user.privacySettings
        }
      });
    } catch (error) {
      logger.error('Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  // Sign in that returns only session data
  static async signIn(req: Request, res: Response) {
    try {
      let { username, password, deviceName, deviceFingerprint, backupCode } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      // Sanitize username for username lookup (remove special characters)
      // Keep original for email lookup since email can contain special characters
      const sanitizedUsername = username.replace(/[^a-zA-Z0-9]/g, '');

      // Find user by username or email
      const user = await User.findOne({
        $or: [{ username: sanitizedUsername }, { email: username }]
      }).select('+password'); // Explicitly select password field since it's set to select: false

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (!user.password) {
        logger.error('User found but no password field:', user.username);
        return res.status(500).json({ error: 'Server configuration error' });
      }

      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }

      // Check password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // If TOTP is enabled, require second factor unless a valid backup code is provided
      if (user.privacySettings?.twoFactorEnabled) {
        // Allow backup code as substitute
        if (typeof backupCode === 'string' && backupCode.length > 0) {
          const rf = await RecoveryFactors.findOne({ userId: user._id });
          if (rf && rf.backupCodes && rf.backupCodes.length > 0) {
            let matched = false;
            for (const bc of rf.backupCodes) {
              if (bc.used) continue;
              const ok = await bcrypt.compare(backupCode, bc.codeHash);
              if (ok) {
                bc.used = true; bc.usedAt = new Date();
                matched = true;
                break;
              }
            }
            if (matched) {
              await rf.save();
              // proceed without TOTP challenge
            } else {
              return res.status(401).json({ error: 'Invalid backup code' });
            }
          } else {
            return res.status(400).json({ error: 'No backup codes configured' });
          }
        } else {
          // Require TOTP challenge
          const totp = await Totp.findOne({ userId: user._id }).select('+secret');
          if (totp && totp.verified) {
            const mfaPayload = {
              userId: user._id.toString(),
              username: user.username,
              deviceName: deviceName || null,
              deviceFingerprint: deviceFingerprint || null,
              type: 'mfa'
            };
            const mfaToken = jwt.sign(mfaPayload, MFA_TOKEN_SECRET, { expiresIn: MFA_TOKEN_TTL_SECONDS });
            return res.json({ mfaRequired: true, mfaToken, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
          }
        }
      }

      // Use session service to create or reuse session (handles device fingerprinting and caching)
      const session = await sessionService.createSession(
        user._id.toString(),
        req,
        { deviceName, deviceFingerprint }
      );

      // Emit session update for real-time updates
      emitSessionUpdate(user._id.toString(), {
        type: 'session_created',
        sessionId: session.sessionId,
        deviceId: session.deviceId
      });

      // Return session data (no tokens in response for security)
      const response: SessionAuthResponse = {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        expiresAt: session.expiresAt.toISOString(),
        user: {
          id: user._id.toString(),
          username: user.username,
          avatar: user.avatar
        }
      };

      res.json(response);
    } catch (error) {
      logger.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Verify TOTP for login and create a session
  static async verifyTotpForLogin(req: Request, res: Response) {
    try {
      const { mfaToken, code } = req.body || {};
      if (!mfaToken || !code) {
        return res.status(400).json({ error: 'mfaToken and code are required' });
      }
      let payload: any;
      try {
        payload = jwt.verify(mfaToken, MFA_TOKEN_SECRET) as any;
      } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired MFA token' });
      }

      if (payload.type !== 'mfa' || !payload.userId) {
        return res.status(400).json({ error: 'Invalid MFA token payload' });
      }

      const user = await User.findById(payload.userId).select('+password');
      if (!user) {
        return res.status(401).json({ error: 'Invalid user' });
      }

      // Load TOTP secret
      const totp = await Totp.findOne({ userId: user._id }).select('+secret');
      if (!totp || !totp.secret) {
        return res.status(400).json({ error: 'TOTP not configured' });
      }

      // Verify code
      const isValid = authenticator.verify({ token: code, secret: totp.secret });
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid TOTP code' });
      }

      // Use session service to create session (handles device fingerprinting and caching)
      const session = await sessionService.createSession(
        user._id.toString(),
        req,
        { 
          deviceName: payload.deviceName || undefined,
          deviceFingerprint: payload.deviceFingerprint || undefined
        }
      );

      emitSessionUpdate(user._id.toString(), {
        type: 'session_created',
        sessionId: session.sessionId,
        deviceId: session.deviceId
      });

      const response: SessionAuthResponse = {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        expiresAt: session.expiresAt.toISOString(),
        user: {
          id: user._id.toString(),
          username: user.username,
          avatar: user.avatar
        }
      };
      return res.json(response);
    } catch (error) {
      logger.error('Verify TOTP for login error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Start TOTP enrollment: generate secret and return otpauth URL
  static async startTotpEnrollment(req: Request, res: Response) {
    try {
      const sessionId = req.header('x-session-id') || req.body?.sessionId;
      if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

      // Validate session using service
      const result = await sessionService.validateSessionById(sessionId, false);
      if (!result || !result.session) return res.status(401).json({ error: 'Invalid session' });
      
      // Fetch user with password field for TOTP operations
      const user = await User.findById(result.session.userId).select('+password');
      if (!user) return res.status(401).json({ error: 'User not found' });

      // Generate secret
      const secret = authenticator.generateSecret();
      const issuer = process.env.TOTP_ISSUER || 'Oxy';
      const label = `${issuer}:${user.username}`;
      const otpauth = authenticator.keyuri(user.username, issuer, secret);

      // Upsert Totp record (unverified)
      await Totp.findOneAndUpdate(
        { userId: user._id },
        { secret, verified: false },
        { upsert: true }
      );

      return res.json({ secret, otpauthUrl: otpauth, issuer, label });
    } catch (error) {
      logger.error('Start TOTP enrollment error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Verify TOTP enrollment: confirm code and enable 2FA
  static async verifyTotpEnrollment(req: Request, res: Response) {
    try {
      const sessionId = req.header('x-session-id') || req.body?.sessionId;
      const { code } = req.body || {};
      if (!sessionId || !code) return res.status(400).json({ error: 'Session ID and code are required' });

      // Validate session using service
      const result = await sessionService.validateSessionById(sessionId, false);
      if (!result || !result.session) return res.status(401).json({ error: 'Invalid session' });
      
      // Fetch user with password field for TOTP operations
      const user = await User.findById(result.session.userId).select('+password');
      if (!user) return res.status(401).json({ error: 'User not found' });

      const totp = await Totp.findOne({ userId: user._id }).select('+secret');
      if (!totp || !totp.secret) return res.status(400).json({ error: 'TOTP not initialized' });

      const ok = authenticator.verify({ token: code, secret: totp.secret });
      if (!ok) return res.status(401).json({ error: 'Invalid TOTP code' });

      totp.verified = true;
      await totp.save();

      // Enable 2FA on user profile
      user.privacySettings = user.privacySettings || {};
      user.privacySettings.twoFactorEnabled = true;
      await user.save();

      // Generate backup codes and a recovery key (plaintext shown once)
      const codes: string[] = [];
      for (let i = 0; i < 10; i++) {
        // Format: XXXX-XXXX (A-Z,0-9)
        const raw = crypto.randomBytes(4).toString('hex').slice(0, 8).toUpperCase();
        codes.push(`${raw.slice(0,4)}-${raw.slice(4)}`);
      }
      const backupCodeHashes = await Promise.all(codes.map(async (c) => ({
        codeHash: await bcrypt.hash(c, 10), used: false, createdAt: new Date()
      })));

      // Recovery key format: oxy-xxxx-xxxx-xxxx (alnum lower)
      const rkRaw = 'oxy-' + crypto.randomBytes(6).toString('hex').match(/.{1,4}/g)!.slice(0,3).join('-');
      const recoveryKeyHash = await bcrypt.hash(rkRaw, 10);

      await RecoveryFactors.findOneAndUpdate(
        { userId: user._id },
        { backupCodes: backupCodeHashes, recoveryKeyHash, lastRotatedAt: new Date() },
        { upsert: true }
      );

      return res.json({ enabled: true, backupCodes: codes, recoveryKey: rkRaw });
    } catch (error) {
      logger.error('Verify TOTP enrollment error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Disable TOTP: require valid code
  static async disableTotp(req: Request, res: Response) {
    try {
      const sessionId = req.header('x-session-id') || req.body?.sessionId;
      const { code } = req.body || {};
      if (!sessionId || !code) return res.status(400).json({ error: 'Session ID and code are required' });

      // Validate session using service
      const result = await sessionService.validateSessionById(sessionId, false);
      if (!result || !result.session) return res.status(401).json({ error: 'Invalid session' });
      
      // Fetch user with password field for TOTP operations
      const user = await User.findById(result.session.userId).select('+password');
      if (!user) return res.status(401).json({ error: 'User not found' });

      const totp = await Totp.findOne({ userId: user._id }).select('+secret');
      if (!totp || !totp.secret) return res.status(400).json({ error: 'TOTP not configured' });

      const ok = authenticator.verify({ token: code, secret: totp.secret });
      if (!ok) return res.status(401).json({ error: 'Invalid TOTP code' });

      await Totp.deleteOne({ userId: user._id });
      user.privacySettings.twoFactorEnabled = false;
      await user.save();

      return res.json({ disabled: true });
    } catch (error) {
      logger.error('Disable TOTP error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get user data by session ID
  static async getUserBySession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Use session service for optimized lookup with caching
      const result = await sessionService.validateSessionById(sessionId, true);

      if (!result || !result.session || !result.user) {
        return res.status(401).json({ 
          error: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      // Transform user data to include id field for frontend compatibility
      const userData = (result.user as any).toObject ? (result.user as any).toObject() : result.user;
      if (userData._id) {
        userData.id = userData._id.toString();
      }

      res.json(userData);
    } catch (error) {
      logger.error('Get user by session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get access token by session ID
  static async getTokenBySession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Use session service which handles auto-refresh
      const result = await sessionService.getAccessToken(sessionId);

      if (!result) {
        return res.status(401).json({ 
          error: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      res.json({
        accessToken: result.accessToken,
        expiresAt: result.expiresAt.toISOString()
      });
    } catch (error) {
      logger.error('Get token by session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get all sessions for a user
  static async getUserSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find current session to get user ID
      const currentSessionResult = await sessionService.validateSessionById(sessionId, false);

      if (!currentSessionResult || !currentSessionResult.session) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Get all active sessions for this user using service
      const sessions = await sessionService.getUserActiveSessions(
        currentSessionResult.session.userId.toString()
      );

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
      res.status(500).json({ error: 'Internal server error' });
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
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Use session service to deactivate
      const success = await sessionService.deactivateSession(sessionIdToLogout);

      if (!success) {
        return res.status(404).json({ error: 'Session not found' });
      }

      logger.info(`Logged out session: ${sessionIdToLogout.substring(0, 8)}...`);
      res.json({ success: true, message: 'Session logged out successfully' });
    } catch (error) {
      logger.error('Logout session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Logout all sessions for current user
  static async logoutAllSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find current session to get user ID
      const currentSessionResult = await sessionService.validateSessionById(sessionId, false);

      if (!currentSessionResult || !currentSessionResult.session) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Deactivate all sessions for this user except the current one
      const count = await sessionService.deactivateAllUserSessions(
        currentSessionResult.session.userId.toString(),
        sessionId
      );

      logger.info(`Logged out ${count} sessions for user ${currentSessionResult.session.userId}`);
      
      res.json({ 
        success: true, 
        message: `Logged out ${count} sessions`,
        sessionsLoggedOut: count
      });
    } catch (error) {
      logger.error('Logout all sessions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Validate session with user data included - automatically reads from header or URL param
  static async validateSession(req: Request, res: Response) {
    try {
      // Try to get session ID from header first, then fallback to URL parameter
      const sessionId = req.header('x-session-id') || req.params.sessionId;

      if (!sessionId) {
        return res.status(400).json({ 
          error: 'Session ID is required',
          hint: 'Provide sessionId in URL parameter or x-session-id header'
        });
      }

      // Use session service for optimized validation with caching
      const result = await sessionService.validateSessionById(sessionId, true);

      if (!result || !result.session || !result.user) {
        return res.status(401).json({ 
          error: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      // Optional: Log device fingerprint if provided
      const deviceFingerprint = req.header('x-device-fingerprint');
      if (deviceFingerprint) {
        logger.debug(`Session ${sessionId.substring(0, 8)}... validated with device fingerprint: ${deviceFingerprint.substring(0, 16)}...`);
      }

      // Transform user data to include id field for frontend compatibility
      const userData = (result.user as any).toObject ? (result.user as any).toObject() : result.user;
      if (userData._id) {
        userData.id = userData._id.toString();
      }

      res.json({ 
        valid: true,
        expiresAt: result.session.expiresAt.toISOString(),
        lastActivity: result.session.deviceInfo.lastActive.toISOString(),
        user: userData
      });
    } catch (error) {
      logger.error('Validate session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Validate session from header with device fingerprint validation
  static async validateSessionFromHeader(req: Request, res: Response) {
    try {
      const sessionId = req.params.sessionId;

      if (!sessionId) {
        return res.status(400).json({ 
          error: 'Session ID is required',
          hint: 'Provide sessionId as URL parameter'
        });
      }

      // Use session service for optimized validation with caching
      const result = await sessionService.validateSessionById(sessionId, true);

      if (!result || !result.session || !result.user) {
        return res.status(401).json({ 
          error: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      // Optional device fingerprint validation
      const deviceFingerprint = req.header('x-device-fingerprint');
      if (deviceFingerprint && result.session.deviceInfo?.fingerprint) {
        if (deviceFingerprint !== result.session.deviceInfo.fingerprint) {
          logger.debug(`Device fingerprint mismatch for session ${sessionId.substring(0, 8)}...`);
          // Don't reject the request, just log the mismatch
        }
      }

      // Transform user data to include id field for frontend compatibility
      const userData = (result.user as any).toObject ? (result.user as any).toObject() : result.user;
      if (userData._id) {
        userData.id = userData._id.toString();
      }

      res.json({ 
        valid: true,
        expiresAt: result.session.expiresAt.toISOString(),
        lastActivity: result.session.deviceInfo.lastActive.toISOString(),
        user: userData,
        sessionId: result.session.sessionId
      });
    } catch (error) {
      logger.error('Validate session from header error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get device sessions for a specific device
  static async getDeviceSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Get current session using service (no user population needed here)
      const currentSessionResult = await sessionService.validateSessionById(sessionId, false);
      if (!currentSessionResult || !currentSessionResult.session) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Get all sessions for this device with user data populated in a single optimized query
      const deviceSessions = await getDeviceActiveSessions(currentSessionResult.session.deviceId);

      // Return sessions with user data already included (from populate)
      res.json(deviceSessions);
    } catch (error) {
      logger.error('Get device sessions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Batch endpoint to get multiple user profiles by session IDs
  static async getUsersBySessions(req: Request, res: Response) {
    try {
      const { sessionIds } = req.body;

      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        return res.status(400).json({ error: 'sessionIds array is required' });
      }

      // Limit batch size to prevent abuse
      const MAX_BATCH_SIZE = 20;
      const limitedSessionIds = sessionIds.slice(0, MAX_BATCH_SIZE);

      // Use optimized batch query to get all sessions with users in one database call
      // Uses compound index: { sessionId: 1, isActive: 1, expiresAt: 1 }
      const now = new Date();
      const sessions = await Session.find({
        sessionId: { $in: limitedSessionIds },
        isActive: true,
        expiresAt: { $gt: now }
      })
      .populate('userId', 'username email avatar name')
      .lean()
      .exec();

      // Transform to user data format matching getUserBySession
      const usersMap = new Map<string, any>();
      
      for (const session of sessions) {
        if (session.userId && typeof session.userId === 'object') {
          const user = session.userId as any;
          
          // Ensure name.full exists (virtuals may not be included with lean)
          let name = user.name;
          if (name && typeof name === 'object') {
            const first = (name.first as string) || '';
            const last = (name.last as string) || '';
            if (!name.full) {
              name = {
                ...name,
                full: [first, last].filter(Boolean).join(' ').trim()
              };
            }
          }
          
          const userData = {
            id: user._id?.toString() || user.id,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            ...user,
            // Ensure name.full is set (override spread if needed)
            name: name
          };
          // Remove MongoDB _id if we have id
          if (userData._id && userData.id) {
            delete userData._id;
          }
          usersMap.set(session.sessionId, userData);
        }
      }

      // Return array matching input order, with null for missing sessions
      const result = limitedSessionIds.map(sessionId => ({
        sessionId,
        user: usersMap.get(sessionId) || null
      }));

      res.json(result);
    } catch (error) {
      logger.error('Get users by sessions batch error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Logout all sessions for a specific device
  static async logoutAllDeviceSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Get current session using service
      const currentSessionResult = await sessionService.validateSessionById(sessionId, false);
      if (!currentSessionResult || !currentSessionResult.session) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Logout all sessions for this device
      const result = await logoutAllDeviceSessions(currentSessionResult.session.deviceId);

      res.json(result);
    } catch (error) {
      logger.error('Logout all device sessions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Update device name for a session
  static async updateDeviceName(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const { deviceName } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      if (!deviceName) {
        return res.status(400).json({ error: 'Device name is required' });
      }

      // Get session using service
      const result = await sessionService.validateSessionById(sessionId, false);
      if (!result || !result.session) {
        return res.status(404).json({ error: 'Session not found' });
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
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Request account recovery (send 6-digit code)
  static async requestRecovery(req: Request, res: Response) {
    try {
      const { identifier } = req.body || {};
      if (!identifier || typeof identifier !== 'string') {
        return res.status(400).json({ error: 'Identifier (email or username) is required' });
      }

      // Find user by email or username
      const user = await User.findOne({
        $or: [{ email: identifier }, { username: identifier }]
      });

      // Always respond 200 to prevent user enumeration; only proceed if user exists
      if (!user) {
        return res.json({ success: true });
      }

      // Generate a 6-digit numeric code
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      // Hash the code using bcrypt
      const codeHash = await bcrypt.hash(code, 10);

      // Create recovery record with 15-minute expiration
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await RecoveryCode.create({
        userId: user._id,
        identifier,
        codeHash,
        expiresAt,
        used: false,
        attempts: 0,
      });

      // Log masked output for development visibility
      const mask = (email: string) => {
        const at = email.indexOf('@');
        if (at > 1) return email[0] + '***' + email.slice(at - 1);
        return '***';
      };
      const destination = user.email ? mask(user.email) : 'on-file';
      logger.info(`[Recovery] Code for ${user.username}: ${code} (expires in 15m)`);

      return res.json({ success: true, delivery: 'email', destination });
    } catch (error) {
      logger.error('Request recovery error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Verify recovery code (without changing password)
  static async verifyRecoveryCode(req: Request, res: Response) {
    try {
      const { identifier, code } = req.body || {};
      if (!identifier || !code) {
        return res.status(400).json({ verified: false, error: 'Identifier and code are required' });
      }

      const user = await User.findOne({
        $or: [{ email: identifier }, { username: identifier }]
      });
      if (!user) {
        // Do not reveal if user exists
        return res.json({ verified: false });
      }

      // Get the latest unused, unexpired code
      const rec = await RecoveryCode.findOne({
        userId: user._id,
        used: false,
        expiresAt: { $gt: new Date() }
      }).sort({ createdAt: -1 });

      if (!rec) {
        return res.json({ verified: false });
      }

      // Compare code
      const ok = await bcrypt.compare(code, rec.codeHash);
      if (!ok) {
        // Increment attempts but do not block
        rec.attempts += 1;
        await rec.save();
        return res.json({ verified: false });
      }

      return res.json({ verified: true });
    } catch (error) {
      logger.error('Verify recovery code error:', error);
      return res.status(500).json({ verified: false, error: 'Internal server error' });
    }
  }

  // Reset password using identifier + code
  static async resetPassword(req: Request, res: Response) {
    try {
      const { identifier, code, newPassword } = req.body || {};
      if (!identifier || !code || !newPassword) {
        return res.status(400).json({ success: false, error: 'Identifier, code and newPassword are required' });
      }

      const user = await User.findOne({
        $or: [{ email: identifier }, { username: identifier }]
      }).select('+password');
      if (!user) {
        // Do not reveal existence
        return res.json({ success: true });
      }

      const rec = await RecoveryCode.findOne({
        userId: user._id,
        used: false,
        expiresAt: { $gt: new Date() }
      }).sort({ createdAt: -1 });

      if (!rec) {
        return res.status(401).json({ success: false, error: 'Invalid or expired code' });
      }

      const ok = await bcrypt.compare(code, rec.codeHash);
      if (!ok) {
        rec.attempts += 1;
        await rec.save();
        return res.status(401).json({ success: false, error: 'Invalid code' });
      }

      // Update password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword as any;
      await user.save();

      // Mark code as used
      rec.used = true;
      await rec.save();

      // Invalidate all active sessions for this user
      await sessionService.deactivateAllUserSessions(user._id.toString());

      logger.info(`Password reset for user ${user.username}. Active sessions invalidated.`);
      return res.json({ success: true });
    } catch (error) {
      logger.error('Reset password error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  // Reset password using TOTP code (no email)
  static async resetPasswordWithTotp(req: Request, res: Response) {
    try {
      const { identifier, code, newPassword } = req.body || {};
      if (!identifier || !code || !newPassword) {
        return res.status(400).json({ success: false, error: 'Identifier, code and newPassword are required' });
      }

      const user = await User.findOne({
        $or: [{ email: identifier }, { username: identifier }]
      }).select('+password');
      if (!user) {
        // do not reveal existence
        return res.json({ success: true });
      }

      const totp = await Totp.findOne({ userId: user._id }).select('+secret');
      if (!totp || !totp.secret || !totp.verified) {
        return res.status(400).json({ success: false, error: 'TOTP is not configured for this account' });
      }

      const ok = authenticator.verify({ token: code, secret: totp.secret });
      if (!ok) {
        return res.status(401).json({ success: false, error: 'Invalid TOTP code' });
      }

      // Update password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword as any;
      await user.save();

      // Invalidate all active sessions
      await sessionService.deactivateAllUserSessions(user._id.toString());

      return res.json({ success: true });
    } catch (error) {
      logger.error('Reset password with TOTP error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  // Reset with backup code
  static async resetPasswordWithBackupCode(req: Request, res: Response) {
    try {
      const { identifier, backupCode, newPassword } = req.body || {};
      if (!identifier || !backupCode || !newPassword) {
        return res.status(400).json({ success: false, error: 'Identifier, backupCode and newPassword are required' });
      }
      const user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] }).select('+password');
      if (!user) return res.json({ success: true });

      const rf = await RecoveryFactors.findOne({ userId: user._id });
      if (!rf || !rf.backupCodes || rf.backupCodes.length === 0) {
        return res.status(400).json({ success: false, error: 'No backup codes configured' });
      }
      let matched = false;
      for (const bc of rf.backupCodes) {
        if (bc.used) continue;
        const ok = await bcrypt.compare(backupCode, bc.codeHash);
        if (ok) { bc.used = true; bc.usedAt = new Date(); matched = true; break; }
      }
      if (!matched) return res.status(401).json({ success: false, error: 'Invalid backup code' });

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword as any;
      await user.save();

      await rf.save();
      await sessionService.deactivateAllUserSessions(user._id.toString());

      // Force disabling TOTP to require re-enrollment later
      user.privacySettings.twoFactorEnabled = false;
      await user.save();
      await Totp.deleteOne({ userId: user._id });

      return res.json({ success: true });
    } catch (error) {
      logger.error('Reset password with backup code error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  // Reset with recovery key
  static async resetPasswordWithRecoveryKey(req: Request, res: Response) {
    try {
      const { identifier, recoveryKey, newPassword } = req.body || {};
      if (!identifier || !recoveryKey || !newPassword) {
        return res.status(400).json({ success: false, error: 'Identifier, recoveryKey and newPassword are required' });
      }
      const user = await User.findOne({ $or: [{ email: identifier }, { username: identifier }] }).select('+password');
      if (!user) return res.json({ success: true });

      const rf = await RecoveryFactors.findOne({ userId: user._id });
      if (!rf || !rf.recoveryKeyHash) return res.status(400).json({ success: false, error: 'No recovery key configured' });
      const ok = await bcrypt.compare(recoveryKey, rf.recoveryKeyHash);
      if (!ok) return res.status(401).json({ success: false, error: 'Invalid recovery key' });

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword as any;
      await user.save();

      // Rotate the recovery key (invalidate old); generate a new hash
      const rkRaw = 'oxy-' + crypto.randomBytes(6).toString('hex').match(/.{1,4}/g)!.slice(0,3).join('-');
      rf.recoveryKeyHash = await bcrypt.hash(rkRaw, 10);
      rf.lastRotatedAt = new Date();
      await rf.save();

      await sessionService.deactivateAllUserSessions(user._id.toString());

      // Force disabling TOTP to require re-enrollment later
      user.privacySettings.twoFactorEnabled = false;
      await user.save();
      await Totp.deleteOne({ userId: user._id });

      return res.json({ success: true, nextRecoveryKey: rkRaw });
    } catch (error) {
      logger.error('Reset password with recovery key error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
}
