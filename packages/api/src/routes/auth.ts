/**
 * Authentication Routes
 *
 * Supports both password-based auth (email/username + password),
 * public key challenge-response for local identity wallets,
 * and social OAuth sign-in (Google, Apple, GitHub).
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
import socialAuthRouter from './socialAuth';
import { validate } from '../middleware/validate';
import {
  signupSchema,
  loginSchema,
  registerPublicKeySchema,
  challengeSchema,
  verifyChallengeSchema,
  recoverRequestSchema,
  recoverVerifySchema,
  recoverResetSchema,
  checkUsernameParams,
  checkEmailParams,
  checkPublicKeyParams,
  getUserByPublicKeyParams,
  authSessionCreateSchema,
  authSessionTokenParams,
  authorizeSessionBodySchema,
  serviceTokenSchema,
} from '../schemas/auth.schemas';

const router = express.Router();
const USERNAME_REGEX = /^[a-zA-Z0-9]{3,30}$/;

// ============================================
// Password Authentication Routes
// ============================================

/**
 * @openapi
 * /auth/signup:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Register a new user
 *     description: Register a new user with email, username, and password.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - username
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 30
 *                 pattern: '^[a-zA-Z0-9]{3,30}$'
 *                 example: johndoe
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: securePassword123
 *               deviceName:
 *                 type: string
 *                 example: Chrome on macOS
 *               deviceFingerprint:
 *                 type: string
 *                 example: abc123fingerprint
 *     responses:
 *       200:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                     username:
 *                       type: string
 *                     email:
 *                       type: string
 *                 sessionId:
 *                   type: string
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *       400:
 *         description: Validation error (missing fields, invalid format, duplicate email/username)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/signup', validate({ body: signupSchema }), SessionController.signUp);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Log in with credentials
 *     description: Authenticate with email/username and password. Returns session tokens.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email or username (use this or the specific email/username fields)
 *                 example: johndoe
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               username:
 *                 type: string
 *                 example: johndoe
 *               password:
 *                 type: string
 *                 format: password
 *                 example: securePassword123
 *               deviceName:
 *                 type: string
 *                 example: Chrome on macOS
 *               deviceFingerprint:
 *                 type: string
 *                 example: abc123fingerprint
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                     username:
 *                       type: string
 *                     email:
 *                       type: string
 *                 sessionId:
 *                   type: string
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', validate({ body: loginSchema }), SessionController.signIn);

/**
 * @openapi
 * /auth/recover/request:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Request password recovery
 *     description: Send a password recovery code to the user's email.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email or username
 *                 example: user@example.com
 *               email:
 *                 type: string
 *                 format: email
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: Recovery code sent (returns success even if account not found to prevent enumeration)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing identifier
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/recover/request', validate({ body: recoverRequestSchema }), SessionController.requestPasswordReset);

/**
 * @openapi
 * /auth/recover/verify:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Verify recovery code
 *     description: Verify the recovery code sent via email and receive a reset token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email or username
 *                 example: user@example.com
 *               email:
 *                 type: string
 *                 format: email
 *               username:
 *                 type: string
 *               code:
 *                 type: string
 *                 description: Recovery code received via email
 *                 example: '123456'
 *     responses:
 *       200:
 *         description: Code verified, reset token returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recoveryToken:
 *                   type: string
 *       400:
 *         description: Invalid or expired code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/recover/verify', validate({ body: recoverVerifySchema }), SessionController.verifyRecoveryCode);

/**
 * @openapi
 * /auth/recover/reset:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Reset password
 *     description: Reset the user's password using a valid recovery token.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recoveryToken
 *               - password
 *             properties:
 *               recoveryToken:
 *                 type: string
 *                 description: Token received from /auth/recover/verify
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 description: New password
 *     responses:
 *       200:
 *         description: Password reset successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid or expired recovery token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/recover/reset', validate({ body: recoverResetSchema }), SessionController.resetPassword);

// ============================================
// Social OAuth Sign-In Routes
// ============================================

/**
 * POST /auth/social/google  - body: { idToken }
 * POST /auth/social/apple   - body: { idToken, name? }
 * POST /auth/social/github  - body: { code }
 */
router.use('/social', socialAuthRouter);

// ============================================
// Public Key Authentication Routes
// ============================================

/**
 * POST /auth/register
 * Register a new user with public key
 * Body: { publicKey, username, email?, signature, timestamp }
 */
router.post('/register', validate({ body: registerPublicKeySchema }), SessionController.register);

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
router.post('/challenge', challengeLimiter, validate({ body: challengeSchema }), SessionController.requestChallenge);

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
router.post('/verify', verifyLimiter, validate({ body: verifyChallengeSchema }), SessionController.verifyChallenge);

// ============================================
// Validation Routes
// ============================================

/**
 * @openapi
 * /auth/validate:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Validate authentication status
 *     description: Check whether the current request carries valid authentication.
 *     responses:
 *       200:
 *         description: Authentication is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                   example: true
 */
router.get('/validate', asyncHandler(async (req, res) => {
  sendSuccess(res, { valid: true });
}));

// Strict rate limit for enumeration-sensitive check endpoints (10/min per IP)
const checkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 10,
  message: 'Too many lookup requests, please try again later.',
});

/**
 * @openapi
 * /auth/check-username/{username}:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Check username availability
 *     description: Check whether a username is available for registration.
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 3
 *           maxLength: 30
 *         example: johndoe
 *     responses:
 *       200:
 *         description: Availability check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 available:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid username format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded
 */
router.get('/check-username/:username', checkLimiter, validate({ params: checkUsernameParams }), asyncHandler(async (req, res) => {
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

  const existingUser = await User.findOne({ username }).select('_id').lean();

  logger.debug('GET /auth/check-username', { username, available: !existingUser });
  
  sendSuccess(res, { 
    available: !existingUser, 
    message: existingUser ? 'Username is already taken' : 'Username is available' 
  });
}));

/**
 * @openapi
 * /auth/check-email/{email}:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Check email availability
 *     description: Check whether an email address is available for registration.
 *     parameters:
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *         example: user@example.com
 *     responses:
 *       200:
 *         description: Availability check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 available:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid email format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded
 */
router.get('/check-email/:email', checkLimiter, validate({ params: checkEmailParams }), asyncHandler(async (req, res) => {
  const { email } = req.params;
  
  if (!email || !email.includes('@')) {
    throw new BadRequestError('Please provide a valid email address');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail }).select('_id').lean();

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
router.get('/check-publickey/:publicKey', checkLimiter, validate({ params: checkPublicKeyParams }), asyncHandler(async (req, res) => {
  const { publicKey } = req.params;
  
  if (!publicKey) {
    throw new BadRequestError('Public key is required');
  }

  if (!SignatureService.isValidPublicKey(publicKey)) {
    throw new BadRequestError('Invalid public key format');
  }

  const existingUser = await User.findOne({ publicKey }).select('_id').lean();

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
router.get('/user/:publicKey', validate({ params: getUserByPublicKeyParams }), SessionController.getUserByPublicKey);

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
router.post('/session/create', validate({ body: authSessionCreateSchema }), asyncHandler(async (req, res) => {
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

  // Check if session token already exists (generic error to prevent enumeration)
  const existing = await AuthSession.findOne({ sessionToken });
  if (existing) {
    throw new BadRequestError('Unable to create session');
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
router.get('/session/status/:sessionToken', validate({ params: authSessionTokenParams }), asyncHandler(async (req, res) => {
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
router.post('/session/authorize/:sessionToken', validate({ params: authSessionTokenParams, body: authorizeSessionBodySchema }), asyncHandler(async (req, res) => {
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
router.post('/session/cancel/:sessionToken', validate({ params: authSessionTokenParams }), asyncHandler(async (req, res) => {
  const { sessionToken } = req.params;
  const { appId } = req.body;

  if (!appId) {
    throw new BadRequestError('appId is required');
  }

  const authSession = await AuthSession.findOne({ sessionToken });
  if (!authSession) {
    throw new NotFoundError('Auth session not found');
  }

  // Verify the caller owns this session by matching the appId
  if (authSession.appId !== appId) {
    throw new ForbiddenError('Not authorized to cancel this session');
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
 * @openapi
 * /auth/service-token:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Exchange credentials for a service token
 *     description: >
 *       Internal service-to-service authentication endpoint.
 *       Exchange DeveloperApp credentials (apiKey + apiSecret) for a short-lived
 *       service JWT (1 hour). Only available to apps with isInternal flag set.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - apiKey
 *               - apiSecret
 *             properties:
 *               apiKey:
 *                 type: string
 *                 description: DeveloperApp API key
 *                 example: oxy_dk_abc123
 *               apiSecret:
 *                 type: string
 *                 description: DeveloperApp API secret
 *     responses:
 *       200:
 *         description: Service token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: Short-lived JWT for service-to-service calls
 *                 expiresIn:
 *                   type: integer
 *                   description: Token lifetime in seconds
 *                   example: 3600
 *                 appName:
 *                   type: string
 *                   description: Name of the authenticated app
 *       400:
 *         description: Missing apiKey or apiSecret
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: App is not an internal service
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded
 */
router.post('/service-token', serviceTokenLimiter, validate({ body: serviceTokenSchema }), asyncHandler(async (req, res) => {
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
