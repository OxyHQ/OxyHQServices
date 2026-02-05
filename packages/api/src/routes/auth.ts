/**
 * Authentication Routes
 * 
 * Supports both password-based auth (email/username + password)
 * and public key challenge-response for local identity wallets.
 */

import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { SessionController } from '../controllers/session.controller';
import { User } from '../models/User';
import { DeveloperApp } from '../models/DeveloperApp';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler, sendSuccess } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError } from '../utils/error';
import { logger } from '../utils/logger';
import SignatureService from '../services/signature.service';
import { emitAuthSessionUpdate } from '../utils/authSessionSocket';

const router = express.Router();
const USERNAME_REGEX = /^[a-zA-Z0-9]{3,30}$/;

// ============================================
// Password Authentication Routes
// ============================================

/**
 * POST /auth/signup
 * Register a new user with email/username and password
 * Body: { email, username, password, deviceName?, deviceFingerprint? }
 */
router.post('/signup', SessionController.signUp);

/**
 * POST /auth/login
 * Login with email/username and password
 * Body: { identifier | email | username, password, deviceName?, deviceFingerprint? }
 */
router.post('/login', SessionController.signIn);

/**
 * POST /auth/recover/request
 * Request a password recovery code
 * Body: { identifier | email | username }
 */
router.post('/recover/request', SessionController.requestPasswordReset);

/**
 * POST /auth/recover/verify
 * Verify recovery code and return a reset token
 * Body: { identifier | email | username, code }
 */
router.post('/recover/verify', SessionController.verifyRecoveryCode);

/**
 * POST /auth/recover/reset
 * Reset password using recovery token
 * Body: { recoveryToken, password }
 */
router.post('/recover/reset', SessionController.resetPassword);

// ============================================
// Public Key Authentication Routes
// ============================================

/**
 * POST /auth/register
 * Register a new user with public key
 * Body: { publicKey, username, email?, signature, timestamp }
 */
router.post('/register', SessionController.register);

/**
 * POST /auth/challenge
 * Request an authentication challenge
 * Body: { publicKey }
 * Response: { challenge, expiresAt }
 */
const challengeLimiter = rateLimit({ 
  windowMs: 60 * 1000, 
  max: process.env.NODE_ENV === 'development' ? 100 : 10 // 10 per minute (100 in dev)
});
router.post('/challenge', challengeLimiter, SessionController.requestChallenge);

/**
 * POST /auth/verify
 * Verify a signed challenge and create a session
 * Body: { publicKey, challenge, signature, timestamp, deviceName?, deviceFingerprint? }
 * Response: SessionAuthResponse
 */
const verifyLimiter = rateLimit({ 
  windowMs: 60 * 1000, 
  max: process.env.NODE_ENV === 'development' ? 50 : 5 // 5 per minute (50 in dev)
});
router.post('/verify', verifyLimiter, SessionController.verifyChallenge);

// ============================================
// Validation Routes
// ============================================

/**
 * GET /auth/validate
 * Validate current authentication status
 */
router.get('/validate', asyncHandler(async (req, res) => {
  sendSuccess(res, { valid: true });
}));

/**
 * GET /auth/check-username/:username
 * Check if username is available
 */
router.get('/check-username/:username', asyncHandler(async (req, res) => {
  let { username } = req.params;
  
  if (!username) {
    throw new BadRequestError(
      'Username must be at least 3 characters long and contain only letters and numbers'
    );
  }

  username = username.trim();

  if (!USERNAME_REGEX.test(username)) {
    throw new BadRequestError('Username can only contain letters and numbers');
  }

  const existingUser = await User.findOne({ username });
  
  logger.debug('GET /auth/check-username', { username, available: !existingUser });
  
  sendSuccess(res, { 
    available: !existingUser, 
    message: existingUser ? 'Username is already taken' : 'Username is available' 
  });
}));

/**
 * GET /auth/check-email/:email
 * Check if email is available
 */
router.get('/check-email/:email', asyncHandler(async (req, res) => {
  const { email } = req.params;
  
  if (!email || !email.includes('@')) {
    throw new BadRequestError('Please provide a valid email address');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail });
  
  logger.debug('GET /auth/check-email', { email: normalizedEmail, available: !existingUser });
  
  sendSuccess(res, { 
    available: !existingUser, 
    message: existingUser ? 'Email is already registered' : 'Email is available' 
  });
}));

/**
 * GET /auth/check-publickey/:publicKey
 * Check if a public key is already registered
 */
router.get('/check-publickey/:publicKey', asyncHandler(async (req, res) => {
  const { publicKey } = req.params;
  
  if (!publicKey) {
    throw new BadRequestError('Public key is required');
  }

  if (!SignatureService.isValidPublicKey(publicKey)) {
    throw new BadRequestError('Invalid public key format');
  }

  const existingUser = await User.findOne({ publicKey });
  
  logger.debug('GET /auth/check-publickey', { 
    publicKey: SignatureService.shortenPublicKey(publicKey), 
    registered: !!existingUser 
  });
  
  sendSuccess(res, { 
    registered: !!existingUser, 
    message: existingUser ? 'This identity is already registered' : 'This identity is available' 
  });
}));

/**
 * GET /auth/user/:publicKey
 * Get user by public key (public profile info)
 */
router.get('/user/:publicKey', SessionController.getUserByPublicKey);

// ============================================
// Cross-App Authentication (OAuth-like flow)
// ============================================

import AuthSession from '../models/AuthSession';
import sessionService from '../services/session.service';

/**
 * POST /auth/session/create
 * Create a new auth session for cross-app authentication
 * Called by third-party apps to initiate the auth flow
 */
router.post('/session/create', asyncHandler(async (req, res) => {
  const { sessionToken, expiresAt, appId } = req.body;

  if (!sessionToken || !appId) {
    throw new BadRequestError('sessionToken and appId are required');
  }

  const now = Date.now();
  const defaultExpiresAt = new Date(now + 5 * 60 * 1000);
  let expiresAtDate = expiresAt ? new Date(expiresAt) : defaultExpiresAt;

  if (Number.isNaN(expiresAtDate.getTime()) || expiresAtDate.getTime() < now + 30 * 1000) {
    expiresAtDate = defaultExpiresAt;
  }

  // Check if session token already exists
  const existing = await AuthSession.findOne({ sessionToken });
  if (existing) {
    throw new BadRequestError('Session token already exists');
  }

  // Create new auth session
  const authSession = await AuthSession.create({
    sessionToken,
    appId,
    expiresAt: expiresAtDate,
    status: 'pending',
  });

  logger.debug('Auth session created', { sessionToken: sessionToken.substring(0, 8) + '...', appId });

  sendSuccess(res, {
    sessionToken: authSession.sessionToken,
    expiresAt: authSession.expiresAt.toISOString(),
    status: authSession.status,
  });
}));

/**
 * GET /auth/session/status/:sessionToken
 * Check the status of an auth session (polling endpoint)
 * Called by third-party apps to check if user has authorized
 */
router.get('/session/status/:sessionToken', asyncHandler(async (req, res) => {
  const { sessionToken } = req.params;

  const authSession = await AuthSession.findOne({ sessionToken });

  if (!authSession) {
    throw new NotFoundError('Auth session not found');
  }

  // Check if expired
  if (authSession.expiresAt < new Date()) {
    authSession.status = 'expired';
    await authSession.save();
  }

  sendSuccess(res, {
    status: authSession.status,
    authorized: authSession.status === 'authorized',
    sessionToken: authSession.sessionToken,
    appId: authSession.appId,
    expiresAt: authSession.expiresAt.toISOString(),
    sessionId: authSession.authorizedSessionId || null,
    publicKey: authSession.authorizedBy || null,
    userId: authSession.authorizedUserId ? authSession.authorizedUserId.toString() : null,
  });
}));

/**
 * POST /auth/session/authorize/:sessionToken
 * Authorize an auth session (called from Oxy Accounts app)
 * Requires a valid session header from the authorizing user
 */
router.post('/session/authorize/:sessionToken', asyncHandler(async (req, res) => {
  const { sessionToken } = req.params;
  const userSessionId = req.header('x-session-id');
  const { deviceName, deviceFingerprint } = req.body;

  if (!userSessionId) {
    throw new BadRequestError('x-session-id header is required');
  }

  // Validate the user's session
  const validation = await sessionService.validateSessionById(userSessionId, true);
  if (!validation || !validation.session || !validation.user) {
    throw new NotFoundError('Invalid user session');
  }

  // Find the auth session
  const authSession = await AuthSession.findOne({ sessionToken, status: 'pending' });
  if (!authSession) {
    throw new NotFoundError('Auth session not found or already processed');
  }

  // Check if expired
  if (authSession.expiresAt < new Date()) {
    authSession.status = 'expired';
    await authSession.save();
    throw new BadRequestError('Auth session has expired');
  }

  // Create a new session for the third-party app
  const newSession = await sessionService.createSession(
    validation.user._id.toString(),
    req,
    { deviceName: deviceName || `${authSession.appId} App`, deviceFingerprint }
  );

  // Update auth session
  authSession.status = 'authorized';
  authSession.authorizedBy = validation.user.publicKey || null;
  authSession.authorizedUserId = validation.user._id;
  authSession.authorizedSessionId = newSession.sessionId;
  await authSession.save();

  logger.info('Auth session authorized', {
    sessionToken: sessionToken.substring(0, 8) + '...',
    userId: validation.user._id,
    appId: authSession.appId,
  });

  // Emit socket event to notify the waiting client
  emitAuthSessionUpdate(sessionToken, {
    status: 'authorized',
    sessionId: newSession.sessionId,
    publicKey: validation.user.publicKey,
    userId: validation.user._id.toString(),
    username: validation.user.username,
  });

  sendSuccess(res, {
    success: true,
    sessionId: newSession.sessionId,
    user: {
      id: validation.user._id.toString(),
      username: validation.user.username,
      publicKey: validation.user.publicKey,
    },
  });
}));

/**
 * POST /auth/session/cancel/:sessionToken
 * Cancel an auth session
 */
router.post('/session/cancel/:sessionToken', asyncHandler(async (req, res) => {
  const { sessionToken } = req.params;

  const authSession = await AuthSession.findOne({ sessionToken });
  if (!authSession) {
    throw new NotFoundError('Auth session not found');
  }

  authSession.status = 'cancelled';
  await authSession.save();

  // Emit socket event to notify the waiting client
  emitAuthSessionUpdate(sessionToken, {
    status: 'cancelled',
  });

  sendSuccess(res, { success: true });
}));

// ============================================
// Service Token Authentication (Internal Services)
// ============================================

const SERVICE_TOKEN_EXPIRY = 3600; // 1 hour in seconds

const serviceTokenLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5-minute window
  max: process.env.NODE_ENV === 'development' ? 100 : 10 // 10 per 5 minutes (2/min avg)
});

/**
 * POST /auth/service-token
 * Exchange DeveloperApp credentials for a short-lived service JWT.
 * Only available to internal apps (isInternal: true).
 *
 * Body: { apiKey, apiSecret }
 * Response: { token, expiresIn, appName }
 */
router.post('/service-token', serviceTokenLimiter, asyncHandler(async (req, res) => {
  const { apiKey, apiSecret } = req.body;

  if (!apiKey || !apiSecret) {
    throw new BadRequestError('apiKey and apiSecret are required');
  }

  if (!process.env.ACCESS_TOKEN_SECRET) {
    logger.error('[ServiceToken] ACCESS_TOKEN_SECRET not configured');
    throw new Error('Server configuration error');
  }

  // Find app by apiKey
  const app = await DeveloperApp.findOne({ apiKey, status: 'active' });

  if (!app) {
    logger.warn('[ServiceToken] Invalid apiKey attempt', { apiKey: apiKey.substring(0, 12) + '...' });
    throw new UnauthorizedError('Invalid credentials');
  }

  // Verify this is an internal app
  if (!app.isInternal) {
    logger.warn('[ServiceToken] Non-internal app attempted service token', {
      appId: app._id,
      appName: app.name,
    });
    throw new ForbiddenError('Service tokens are only available to internal apps');
  }

  // Validate apiSecret with timing-safe comparison
  const expectedBuffer = Buffer.from(app.apiSecret);
  const providedBuffer = Buffer.from(apiSecret);

  if (expectedBuffer.length !== providedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    logger.warn('[ServiceToken] Invalid apiSecret attempt', {
      appId: app._id,
      appName: app.name,
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  // Generate stateless service JWT
  const token = jwt.sign(
    {
      type: 'service',
      appId: app._id.toString(),
      appName: app.name,
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: SERVICE_TOKEN_EXPIRY }
  );

  // Update lastUsedAt
  app.lastUsedAt = new Date();
  await app.save();

  logger.info('[ServiceToken] Service token issued', {
    appId: app._id,
    appName: app.name,
    expiresIn: SERVICE_TOKEN_EXPIRY,
    ip: req.ip,
  });

  sendSuccess(res, {
    token,
    expiresIn: SERVICE_TOKEN_EXPIRY,
    appName: app.name,
  });
}));

export default router;
