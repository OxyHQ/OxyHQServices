import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import Session from '../models/Session';
import AuthChallenge from '../models/AuthChallenge';
import RecoveryCode from '../models/RecoveryCode';
import { SessionAuthResponse, ClientSession } from '../types/session';
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
import { formatUserResponse } from '../utils/userTransform';
import { generateAlphanumericCode, hashPassword, verifyPassword, validatePasswordStrength } from '../utils/password';
import securityActivityService from '../services/securityActivityService';
import anomalyDetectionService from '../services/anomalyDetection.service';

// Challenge expiration time (5 minutes)
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RECOVERY_CODE_LENGTH = 10;
const RECOVERY_CODE_TTL_MS = 10 * 60 * 1000;
const RECOVERY_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_RECOVERY_ATTEMPTS = 3;

// More robust email validation regex (RFC 5322 compliant)
// Validates: local-part@domain with proper character restrictions
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const USERNAME_REGEX = /^[a-zA-Z0-9]{3,30}$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  const normalized = normalizeEmail(email);

  // Check length constraints (RFC 5321)
  if (normalized.length > 254) {
    return { valid: false, error: 'Email address is too long' };
  }

  const [localPart, domain] = normalized.split('@');

  if (!localPart || !domain) {
    return { valid: false, error: 'Invalid email format' };
  }

  if (localPart.length > 64) {
    return { valid: false, error: 'Email local part is too long' };
  }

  // Check for consecutive dots
  if (normalized.includes('..')) {
    return { valid: false, error: 'Email cannot contain consecutive dots' };
  }

  // Check regex pattern
  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, error: 'Invalid email format' };
  }

  // Additional checks for common mistakes
  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    return { valid: false, error: 'Email local part cannot start or end with a dot' };
  }

  if (domain.startsWith('-') || domain.endsWith('-')) {
    return { valid: false, error: 'Email domain cannot start or end with a hyphen' };
  }

  return { valid: true };
}

function normalizeUsername(username: string): string {
  return username.trim();
}

function parseIdentifier(identifier: string): { field: 'email' | 'username'; value: string } | null {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return null;
  }

  if (EMAIL_REGEX.test(trimmed)) {
    return { field: 'email', value: normalizeEmail(trimmed) };
  }

  return { field: 'username', value: normalizeUsername(trimmed) };
}

function buildSessionAuthResponse(session: { sessionId: string; deviceId: string; expiresAt: Date; accessToken?: string }, user: unknown): SessionAuthResponse | null {
  const userData = formatUserResponse(user as any);
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
        if (!USERNAME_REGEX.test(normalizedUsername)) {
          return res.status(400).json({
            message: 'Username must be 3-30 characters and contain only letters and numbers'
          });
        }
      }

      if (normalizedEmail) {
        const existingEmail = await User.findOne({ email: normalizedEmail }).select('_id').lean();
        if (existingEmail) {
          return res.status(409).json({ message: 'Email already registered' });
        }
      }

      if (normalizedUsername) {
        const existingUsername = await User.findOne({ username: normalizedUsername }).select('_id').lean();
        if (existingUsername) {
          return res.status(409).json({ message: 'Username already taken' });
        }
      }

      // Create new user (identity is the publicKey)
      const user = new User({
        publicKey,
        email: normalizedEmail,
        username: normalizedUsername,
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
   * Register a new user with email/username and password
   */
  static async signUp(req: Request, res: Response) {
    try {
      const { email, username, password, name, deviceName, deviceFingerprint } = req.body;

      if (
        !email ||
        !username ||
        !password ||
        typeof email !== 'string' ||
        typeof username !== 'string'
      ) {
        return res.status(400).json({
          message: 'Email, username, and password are required'
        });
      }

      // Validate email with comprehensive checks
      const emailValidation = validateEmail(email);
      if (!emailValidation.valid) {
        return res.status(400).json({ message: emailValidation.error });
      }
      const normalizedEmail = normalizeEmail(email);

      // Validate password strength
      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          message: 'Password does not meet security requirements',
          errors: passwordValidation.errors
        });
      }

      const normalizedUsername = normalizeUsername(username);
      if (!USERNAME_REGEX.test(normalizedUsername)) {
        return res.status(400).json({
          message: 'Username must be 3-30 characters and contain only letters and numbers'
        });
      }

      const existingEmail = await User.findOne({ email: normalizedEmail }).select('_id').lean();
      if (existingEmail) {
        return res.status(409).json({ message: 'Email already registered' });
      }

      const existingUsername = await User.findOne({ username: normalizedUsername }).select('_id').lean();
      if (existingUsername) {
        return res.status(409).json({ message: 'Username already taken' });
      }

      const passwordHash = await hashPassword(password);

      const user = new User({
        email: normalizedEmail,
        username: normalizedUsername,
        password: passwordHash,
      });

      if (name && typeof name === 'object') {
        user.name = name;
      }

      await user.save();

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
        logger.error('Failed to create welcome notification during signup', notificationError, {
          component: 'SessionController',
          method: 'signUp',
          userId: user._id.toString(),
        });
      }

      const session = await sessionService.createSession(
        user._id.toString(),
        req,
        { deviceName, deviceFingerprint }
      );

      const response = buildSessionAuthResponse(session, user);
      if (!response) {
        return res.status(500).json({ message: 'Failed to format user data' });
      }

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
        logger.error('Failed to log security event for signup sign-in', error instanceof Error ? error : new Error(String(error)), {
          component: 'SessionController',
          method: 'signUp',
          userId: user._id.toString(),
        });
      }

      return res.status(201).json(response);
    } catch (error: any) {
      if (error.code === 11000 && (error.keyPattern?.email || error.keyPattern?.username)) {
        const field = error.keyPattern?.email ? 'email' : 'username';
        return res.status(409).json({ message: `${field} already exists` });
      }

      logger.error('Signup error:', error);
      return res.status(500).json({ message: 'Internal server error' });
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
      const { publicKey, challenge, signature, timestamp, deviceName, deviceFingerprint } = req.body;

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
        { deviceName, deviceFingerprint }
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

      const response: SessionAuthResponse = {
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

      res.json(response);
    } catch (error) {
      logger.error('Verify challenge error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  /**
   * Sign in with email/username and password
   */
  static async signIn(req: Request, res: Response) {
    try {
      const { identifier, email, username, password, deviceName, deviceFingerprint } = req.body;
      const loginIdentifier = identifier || email || username;

      if (!loginIdentifier || !password || typeof password !== 'string') {
        return res.status(400).json({ message: 'Identifier and password are required' });
      }

      const parsedIdentifier = parseIdentifier(String(loginIdentifier));
      if (!parsedIdentifier) {
        return res.status(400).json({ message: 'Invalid identifier' });
      }

      const query = parsedIdentifier.field === 'email'
        ? { email: parsedIdentifier.value }
        : { username: parsedIdentifier.value };

      const user = await User.findOne(query).select('+password');

      if (!user?.password) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const isValidPassword = await verifyPassword(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Check for anomalous login patterns
      const anomalyCheck = await anomalyDetectionService.checkForAnomalies(
        user._id.toString(),
        req
      );

      const session = await sessionService.createSession(
        user._id.toString(),
        req,
        { deviceName, deviceFingerprint }
      );

      const response = buildSessionAuthResponse(session, user);

      // Include anomaly information in response if detected
      if (anomalyCheck.hasAnomalies && response) {
        (response as any).securityAlert = {
          message: 'Unusual activity detected on your account',
          anomalies: anomalyCheck.anomalies,
        };
      }
      if (!response) {
        return res.status(500).json({ message: 'Failed to format user data' });
      }

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
        logger.error('Failed to log security event for sign-in', error instanceof Error ? error : new Error(String(error)), {
          component: 'SessionController',
          method: 'signIn',
          userId: user._id.toString(),
        });
      }

      res.json(response);
    } catch (error) {
      logger.error('Password sign-in error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  /**
   * Request a password recovery code
   */
  static async requestPasswordReset(req: Request, res: Response) {
    try {
      const { identifier, email, username } = req.body;
      const rawIdentifier = identifier || email || username;

      if (!rawIdentifier) {
        return res.status(400).json({ message: 'Identifier is required' });
      }

      const parsedIdentifier = parseIdentifier(String(rawIdentifier));
      if (!parsedIdentifier) {
        return res.status(400).json({ message: 'Invalid identifier' });
      }

      const query = parsedIdentifier.field === 'email'
        ? { email: parsedIdentifier.value }
        : { username: parsedIdentifier.value };

      const user = await User.findOne(query).select('+password').lean();

      if (!user || !user.password) {
        return res.json({
          success: true,
          message: 'If an account exists, a recovery code has been sent'
        });
      }

      const code = generateAlphanumericCode(RECOVERY_CODE_LENGTH);
      const codeHash = await hashPassword(code);
      const expiresAt = new Date(Date.now() + RECOVERY_CODE_TTL_MS);

      await RecoveryCode.updateMany(
        { userId: user._id, used: false },
        { $set: { used: true } }
      );

      await RecoveryCode.create({
        userId: user._id,
        identifier: parsedIdentifier.value,
        codeHash,
        expiresAt,
        used: false,
      });

      const response: Record<string, any> = {
        success: true,
        message: 'Recovery code sent',
        expiresAt: expiresAt.toISOString(),
      };

      if (process.env.NODE_ENV !== 'production') {
        response.devCode = code;
      }

      return res.json(response);
    } catch (error) {
      logger.error('Request password reset error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  /**
   * Verify a recovery code and issue a reset token
   */
  static async verifyRecoveryCode(req: Request, res: Response) {
    try {
      const { identifier, email, username, code } = req.body;
      const rawIdentifier = identifier || email || username;

      if (!rawIdentifier || !code) {
        return res.status(400).json({ message: 'Identifier and code are required' });
      }

      const parsedIdentifier = parseIdentifier(String(rawIdentifier));
      if (!parsedIdentifier) {
        return res.status(400).json({ message: 'Invalid identifier' });
      }

      const recovery = await RecoveryCode.findOne({
        identifier: parsedIdentifier.value,
        used: false,
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });

      if (!recovery) {
        return res.status(400).json({ message: 'Invalid or expired code' });
      }

      if (recovery.attempts >= MAX_RECOVERY_ATTEMPTS) {
        return res.status(429).json({ message: 'Too many attempts. Request a new code.' });
      }

      const isValid = await verifyPassword(String(code), recovery.codeHash);
      if (!isValid) {
        recovery.attempts += 1;
        if (recovery.attempts >= MAX_RECOVERY_ATTEMPTS) {
          recovery.used = true;
        }
        await recovery.save();

        return res.status(400).json({ message: 'Invalid or expired code' });
      }

      const recoveryToken = jwt.sign(
        {
          type: 'recovery',
          recoveryId: recovery._id.toString(),
          userId: recovery.userId.toString(),
        },
        process.env.ACCESS_TOKEN_SECRET as string,
        { expiresIn: Math.floor(RECOVERY_TOKEN_TTL_MS / 1000) }
      );

      return res.json({
        recoveryToken,
        expiresAt: new Date(Date.now() + RECOVERY_TOKEN_TTL_MS).toISOString(),
      });
    } catch (error) {
      logger.error('Verify recovery code error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  /**
   * Reset password using a verified recovery token
   */
  static async resetPassword(req: Request, res: Response) {
    try {
      const { recoveryToken, password } = req.body;

      if (!recoveryToken || !password) {
        return res.status(400).json({ message: 'Recovery token and password are required' });
      }

      // Validate password strength
      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          message: 'Password does not meet security requirements',
          errors: passwordValidation.errors
        });
      }

      let payload: any;
      try {
        payload = jwt.verify(recoveryToken, process.env.ACCESS_TOKEN_SECRET as string);
      } catch {
        return res.status(401).json({ message: 'Invalid or expired recovery token' });
      }

      if (!payload || payload.type !== 'recovery') {
        return res.status(400).json({ message: 'Invalid recovery token' });
      }

      const recovery = await RecoveryCode.findById(payload.recoveryId);
      if (!recovery || recovery.used || recovery.expiresAt < new Date()) {
        return res.status(400).json({ message: 'Invalid or expired recovery token' });
      }

      const user = await User.findById(recovery.userId).select('+password');
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      user.password = await hashPassword(password);
      await user.save();

      await sessionService.deactivateAllUserSessions(user._id.toString());

      recovery.used = true;
      await recovery.save();

      try {
        await securityActivityService.logAccountRecovery(
          user._id.toString(),
          'recovery_code',
          req
        );
      } catch (error) {
        logger.error('Failed to log security event for password reset', error instanceof Error ? error : new Error(String(error)), {
          component: 'SessionController',
          method: 'resetPassword',
          userId: user._id.toString(),
        });
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Reset password error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get user data by session ID
  static async getUserBySession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }

      // Use session service for optimized lookup with caching
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

      res.json(userData);
    } catch (error) {
      logger.error('Get user by session error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get access token by session ID
  static async getTokenBySession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }

      // Use session service which handles auto-refresh
      const result = await sessionService.getAccessToken(sessionId);

      if (!result) {
        return res.status(401).json({ 
          message: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      res.json({
        accessToken: result.accessToken,
        expiresAt: result.expiresAt.toISOString()
      });
    } catch (error) {
      logger.error('Get token by session error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  // Get all sessions for a user
  static async getUserSessions(req: Request, res: Response) {
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
        
        const user = session.userId as any;
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
