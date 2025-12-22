/**
 * Authentication Routes
 * 
 * RESTful API routes for public key authentication.
 * Uses challenge-response for secure authentication without passwords.
 */

import express from 'express';
import { SessionController } from '../controllers/session.controller';
import { User } from '../models/User';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler, sendSuccess } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError } from '../utils/error';
import { logger } from '../utils/logger';
import { SignatureService } from '@oxyhq/services/node';
import { emitAuthSessionUpdate } from '../utils/authSessionSocket';

const router = express.Router();

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
  
  // Sanitize username: only allow alphanumeric characters
  username = username.replace(/[^a-zA-Z0-9]/g, '');
  
  if (!username || username.length < 3) {
    throw new BadRequestError(
      'Username must be at least 3 characters long and contain only letters and numbers'
    );
  }

  if (!/^[a-zA-Z0-9]{3,30}$/.test(username)) {
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

  const existingUser = await User.findOne({ email });
  
  logger.debug('GET /auth/check-email', { email, available: !existingUser });
  
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

  if (!sessionToken || !expiresAt || !appId) {
    throw new BadRequestError('sessionToken, expiresAt, and appId are required');
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
    expiresAt: new Date(expiresAt),
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
    sessionId: authSession.authorizedSessionId || null,
    publicKey: authSession.authorizedBy || null,
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
  authSession.authorizedBy = validation.user.publicKey;
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
      id: validation.user._id,
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

export default router;
