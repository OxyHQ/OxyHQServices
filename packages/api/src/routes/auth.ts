/**
 * Authentication Routes
 *
 * Supports both password-based auth (email/username + password),
 * public key challenge-response for local identity wallets,
 * and social OAuth sign-in (Google, Apple, GitHub).
 */

import express from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { SessionController } from '../controllers/session.controller';
import { User } from '../models/User';
import { Application } from '../models/Application';
import type { IApplication } from '../models/Application';
import { intersectScopes } from '../utils/applicationScopes';
import { ApplicationCredential } from '../models/ApplicationCredential';
import type { IApplicationCredential } from '../models/ApplicationCredential';
import { isCredentialUsable } from '../utils/credentialUsability';
import { isTrustedApplication } from '../utils/trustedApplication';
import { authMiddleware, rejectQueryToken, type AuthRequest } from '../middleware/auth';
import { requireSameSiteOrigin } from '../middleware/originGuard';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler, sendSuccess } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError } from '../utils/error';
import { logger } from '../utils/logger';
import SignatureService from '../services/signature.service';
import { emitAuthSessionUpdate } from '../utils/authSessionSocket';
import socialAuthRouter from './socialAuth';
import { validate } from '../middleware/validate';
import sessionService from '../services/session.service';
import type { ISession } from '../models/Session';
import { broadcastDeviceState } from '../utils/socket';
import { formatUserResponse } from '../utils/userTransform';
import { issueAuthCode, exchangeAuthCode, AUTH_CODE_TTL_MS } from '../services/oauthCode.service';
import { claimAuthSession, authorizeSessionWithSignedChallenge } from '../services/authSession.service';
import Session from '../models/Session';
import {
  issueRefreshToken,
  revokeFamilyByRawToken,
} from '../services/refreshToken.service';
import { resolveLoginDeviceId } from '../services/deviceLogin.service';
import { extractTokenFromRequest, decodeToken } from '../middleware/authUtils';
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
  authorizeCodeParams,
  authSessionAuthorizeSignedSchema,
  authSessionClaimSchema,
  serviceTokenSchema,
  oauthAuthorizeSchema,
  oauthTokenSchema,
  oauthClientParams,
  oauthConsentQuerySchema,
  grantApplicationIdParams,
} from '../schemas/auth.schemas';
import { AppGrant } from '../models/AppGrant';
import { normaliseOrigin, isLoopbackOrigin } from '../utils/origin';
import { serializePublicApplication } from '../utils/serializeApplication';
import { isValidObjectId } from '../utils/validation';
import { formatUserNameResponse } from '../utils/displayName';

const router = express.Router();
const USERNAME_REGEX = /^[a-zA-Z0-9]{3,30}$/;

// ============================================
// Password Authentication Routes
// ============================================

// Dedicated per-IP password login limit. The sign-in controller also enforces
// per-identifier lockout, but this route-level limiter prevents spraying a few
// guesses across many accounts from the same network.
const loginLimiter = rateLimit({
  prefix: 'rl:auth:login:',
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 200 : 30,
  message: 'Too many login attempts from this IP, please try again later.',
});

/**
 * @openapi
 * /auth/signup:
 *   post:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Register a new user
 *     description: >
 *       Create a new local Oxy account from an email + username + password
 *       triple. On success returns the user record plus an `accessToken`,
 *       `refreshToken`, and a `sessionId` for the newly created session.
 *       Username is normalised to lowercase and must match the
 *       `^[a-zA-Z0-9]{3,30}$` shape.
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
 *                 example: alice@placeholder.example
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 30
 *                 pattern: '^[a-zA-Z0-9]{3,30}$'
 *                 example: alice
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: 'correct horse battery staple'
 *               name:
 *                 type: object
 *                 description: Optional human-readable name for the account.
 *                 properties:
 *                   first:
 *                     type: string
 *                     example: Alice
 *                   last:
 *                     type: string
 *                     example: Example
 *               deviceName:
 *                 type: string
 *                 description: Friendly device label. Shown to the user in the devices list.
 *                 example: MacBook Pro 16
 *               deviceFingerprint:
 *                 type: string
 *                 description: Stable per-device identifier used for de-duplicating sessions.
 *                 example: dev-fp-abcdef0123456789
 *           examples:
 *             standard:
 *               summary: Email + username + password
 *               value:
 *                 email: alice@placeholder.example
 *                 username: alice
 *                 password: 'correct horse battery staple'
 *                 deviceName: MacBook Pro 16
 *     responses:
 *       200:
 *         description: Account created and the first session issued.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSuccess'
 *             examples:
 *               success:
 *                 value:
 *                   user:
 *                     id: 64f7c2a1b8e9d3f4a1c2b3d4
 *                     username: alice
 *                     name:
 *                       first: Alice
 *                       last: Example
 *                   sessionId: sess_64f7c2a1b8e9d3f4a1c2b3d4
 *                   accessToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example
 *                   refreshToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example
 *                   expiresIn: 900
 *       400:
 *         description: Validation failed (missing fields, invalid format).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Email or username already taken.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many signups from this IP. Try again later.
 */
router.post('/signup', validate({ body: signupSchema }), SessionController.signUp);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Log in with email or username and password
 *     description: >
 *       Exchange a password for a session. Accepts either `identifier`
 *       (email-or-username), or one of the dedicated `email` / `username`
 *       fields plus `password`. If the account has TOTP-based 2FA enabled the
 *       response will return a `loginToken` to be completed via
 *       `POST /security/2fa/verify-login` instead of the regular tokens.
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
 *                 description: Email or username. Preferred over the separate fields.
 *                 example: alice
 *               email:
 *                 type: string
 *                 format: email
 *                 example: alice@placeholder.example
 *               username:
 *                 type: string
 *                 example: alice
 *               password:
 *                 type: string
 *                 format: password
 *                 example: 'correct horse battery staple'
 *               deviceName:
 *                 type: string
 *                 example: iPhone 15 Pro
 *               deviceFingerprint:
 *                 type: string
 *                 example: dev-fp-abcdef0123456789
 *           examples:
 *             with-identifier:
 *               summary: Pass identifier (email-or-username)
 *               value:
 *                 identifier: alice
 *                 password: 'correct horse battery staple'
 *                 deviceName: iPhone 15 Pro
 *             with-email:
 *               summary: Pass email explicitly
 *               value:
 *                 email: alice@placeholder.example
 *                 password: 'correct horse battery staple'
 *     responses:
 *       200:
 *         description: >
 *           Login succeeded. Returns either an `AuthSuccess` payload (no 2FA)
 *           or `{ twoFactorRequired: true, loginToken }` for accounts with 2FA
 *           enabled.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/AuthSuccess'
 *                 - type: object
 *                   required:
 *                     - twoFactorRequired
 *                     - loginToken
 *                   properties:
 *                     twoFactorRequired:
 *                       type: boolean
 *                       example: true
 *                     loginToken:
 *                       type: string
 *                       description: Short-lived token to submit to /security/2fa/verify-login.
 *             examples:
 *               success:
 *                 summary: No 2FA — session issued immediately
 *                 value:
 *                   user:
 *                     id: 64f7c2a1b8e9d3f4a1c2b3d4
 *                     username: alice
 *                   sessionId: sess_64f7c2a1b8e9d3f4a1c2b3d4
 *                   accessToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example
 *                   refreshToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example
 *                   expiresIn: 900
 *               twoFactor:
 *                 summary: 2FA challenge required
 *                 value:
 *                   twoFactorRequired: true
 *                   loginToken: lt_2fa_abc123def456
 *       400:
 *         description: Missing or malformed body.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid credentials.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many failed login attempts. Try again later.
 */
router.post('/login', loginLimiter, validate({ body: loginSchema }), SessionController.signIn);

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
router.post(
  '/recover/reset',
  requireSameSiteOrigin,
  validate({ body: recoverResetSchema }),
  SessionController.resetPassword
);

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
 * @openapi
 * /auth/register:
 *   post:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Register a new account with a public key
 *     description: >
 *       Create a passwordless account bound to a local secp256k1 identity.
 *       The client generates a key pair (see `KeyManager` in `@oxyhq/core`),
 *       signs `register:{publicKey}:{timestamp}`, and submits the
 *       signature. Username and email are optional but recommended for
 *       discoverability.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicKey
 *               - signature
 *               - timestamp
 *             properties:
 *               publicKey:
 *                 type: string
 *                 description: secp256k1 public key (hex).
 *               signature:
 *                 type: string
 *                 description: Hex signature over `register:{publicKey}:{timestamp}`.
 *               timestamp:
 *                 type: integer
 *                 description: Unix ms when the signature was produced (max 5 minutes old).
 *               email:
 *                 type: string
 *                 format: email
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 30
 *                 pattern: '^[a-zA-Z0-9]{3,30}$'
 *     responses:
 *       200:
 *         description: Account created and the first session issued.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSuccess'
 *       400:
 *         description: Invalid signature, malformed key, or duplicate username/email.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/register', validate({ body: registerPublicKeySchema }), SessionController.register);

/**
 * @openapi
 * /auth/challenge:
 *   post:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Request a sign-in challenge for a public key
 *     description: >
 *       Step 1 of the passwordless public-key login. Returns a short-lived
 *       random challenge that the client must sign with the matching private
 *       key, then submit to `POST /auth/verify`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicKey
 *             properties:
 *               publicKey:
 *                 type: string
 *                 description: secp256k1 public key (hex).
 *     responses:
 *       200:
 *         description: Challenge issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 challenge:
 *                   type: string
 *                   description: Opaque challenge string to sign.
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: No account registered for this public key.
 *       429:
 *         description: Rate limit exceeded (10 / minute / IP).
 */
const challengeLimiter = rateLimit({
  prefix: 'rl:auth:challenge:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 10 // 10 per minute (100 in dev)
});
router.post('/challenge', challengeLimiter, validate({ body: challengeSchema }), SessionController.requestChallenge);

/**
 * @openapi
 * /auth/verify:
 *   post:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Verify a signed challenge and create a session
 *     description: >
 *       Step 2 of the passwordless public-key login. Submit the challenge
 *       returned by `/auth/challenge` together with its signature; on success
 *       a new session is created and the standard `AuthSuccess` payload is
 *       returned.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicKey
 *               - challenge
 *               - signature
 *               - timestamp
 *             properties:
 *               publicKey:
 *                 type: string
 *               challenge:
 *                 type: string
 *               signature:
 *                 type: string
 *                 description: Hex signature of the challenge.
 *               timestamp:
 *                 type: integer
 *                 description: Unix ms.
 *               deviceName:
 *                 type: string
 *               deviceFingerprint:
 *                 type: string
 *     responses:
 *       200:
 *         description: Session created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSuccess'
 *       401:
 *         description: Signature invalid or challenge expired.
 *       429:
 *         description: Rate limit exceeded (5 / minute / IP).
 */
const verifyLimiter = rateLimit({
  prefix: 'rl:auth:verify:',
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

// ============================================
// First-Party Refresh Cookie (cold-boot session persistence)
// ============================================
//
// Global per-IP rate limit. A per-FAMILY limit is intentionally NOT added: each
// refresh token is single-use and rotation revokes the whole family on any
// reuse, so the DB semantics already bound how often a given family can be
// exercised far more tightly than a counter could. The IP limit blunts blind
// guessing against the 256-bit token space (computationally infeasible anyway).
const refreshLimiter = rateLimit({
  prefix: 'rl:auth:refresh:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 200 : 60,
});

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Revoke the presented rotating refresh family
 *     description: >
 *       Signs the caller out by revoking the rotating refresh-token family behind
 *       the `refreshToken` presented in the body (the persisted-refresh lane used
 *       by web localStorage / native storage). Revocation deactivates the
 *       underlying session and burns the whole family so a stored token can no
 *       longer mint access tokens. Idempotent + best-effort: a missing or unknown
 *       token still returns 200. No `Authorization` header is required — the
 *       refresh token itself is the credential being revoked.
 *     responses:
 *       200:
 *         description: Logged out (idempotent).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       429:
 *         description: Too many requests from this IP.
 */
router.post('/logout', refreshLimiter, requireSameSiteOrigin, asyncHandler(async (req, res) => {
  // Revoke the rotating refresh family behind the presented token. Idempotent on
  // unknown/garbage tokens, so logout always returns 200.
  const bodyRefreshToken = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  if (typeof bodyRefreshToken === 'string' && bodyRefreshToken.length > 0) {
    await revokeFamilyByRawToken(bodyRefreshToken);
  }

  return res.json({ success: true });
}));

// Strict rate limit for enumeration-sensitive check endpoints (10/min per IP)
const checkLimiter = rateLimit({
  prefix: 'rl:auth:lookup:',
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
 * /auth/lookup/{username}:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Lookup user by username
 *     description: Lightweight lookup that returns minimal public info for the login flow. Returns whether the user exists along with their color preset, avatar, and display name.
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 3
 *         example: nate
 *     responses:
 *       200:
 *         description: Lookup result
 *       429:
 *         description: Rate limit exceeded
 */
router.get('/lookup/:username', checkLimiter, validate({ params: checkUsernameParams }), asyncHandler(async (req, res) => {
  let { username } = req.params;

  if (!username) {
    throw new BadRequestError('Username is required');
  }

  username = username.trim().toLowerCase();

  const user = await User.findOne({ username })
    .select('username color avatar name')
    .lean();

  if (!user) {
    throw new NotFoundError('User not found');
  }

  sendSuccess(res, {
    exists: true,
    username: user.username,
    color: user.color || null,
    avatar: user.avatar || null,
    name: formatUserNameResponse({
      name: user.name as { first?: string; last?: string } | undefined,
      username: user.username,
    }),
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

/**
 * @openapi
 * /auth/session/create:
 *   post:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Open a cross-app auth session (OAuth-like flow)
 *     description: >
 *       Begin a cross-app sign-in handshake. A third-party / first-party
 *       client generates a one-time `sessionToken` and opens this endpoint;
 *       the user is then directed to Oxy Accounts where they authorise the
 *       session via `POST /auth/session/authorize/{sessionToken}`. The
 *       client polls `GET /auth/session/status/{sessionToken}` until the
 *       session is authorised, cancelled, or expires (default 5 minutes).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionToken
 *             properties:
 *               sessionToken:
 *                 type: string
 *                 description: Random opaque token the client generates and keeps secret.
 *                 example: at_random_4e9c2a1b8e9d3f4a1c2b3d4
 *               clientId:
 *                 type: string
 *                 description: >
 *                   OAuth client_id (ApplicationCredential public key) of the
 *                   requesting application. Provide this OR `applicationId`.
 *                 example: oxy_dk_1a2b3c4d
 *               applicationId:
 *                 type: string
 *                 description: >
 *                   Application _id of the requesting application. Provide this
 *                   OR `clientId`.
 *                 example: 64f7c2a1b8e9d3f4a1c2b3d4
 *               expiresAt:
 *                 oneOf:
 *                   - type: string
 *                     format: date-time
 *                   - type: integer
 *                     description: Unix ms.
 *                 description: Optional explicit expiry (capped at 5 minutes).
 *     responses:
 *       200:
 *         description: Auth session pending.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessionToken:
 *                   type: string
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *                 status:
 *                   type: string
 *                   enum: [pending, authorized, cancelled, expired]
 *                   example: pending
 *       400:
 *         description: Missing/invalid application reference or token already in use.
 *       403:
 *         description: Application is not available (suspended/deleted/pending review).
 */
router.post('/session/create', validate({ body: authSessionCreateSchema }), asyncHandler(async (req, res) => {
  const { sessionToken, expiresAt, clientId, applicationId, deviceToken } = req.body as {
    sessionToken: string;
    clientId?: string;
    applicationId?: string;
    expiresAt?: string | number;
    deviceToken?: string;
  };

  if (!sessionToken) {
    throw new BadRequestError('sessionToken is required');
  }
  if (!clientId && !applicationId) {
    throw new BadRequestError('Either clientId or applicationId is required');
  }

  const now = Date.now();
  const defaultExpiresAt = new Date(now + 5 * 60 * 1000);
  let expiresAtDate = expiresAt ? new Date(expiresAt) : defaultExpiresAt;

  if (Number.isNaN(expiresAtDate.getTime()) || expiresAtDate.getTime() < now + 30 * 1000) {
    expiresAtDate = defaultExpiresAt;
  }

  // Resolve the canonical Application. Every session is bound to a real,
  // active registered Application — there is no free-form app label.
  let resolvedApp: IApplication | null = null;
  if (clientId) {
    const credential = await resolveUsableCredential(clientId);
    if (credential) {
      resolvedApp = await Application.findById(credential.applicationId);
    }
  } else if (applicationId) {
    if (isValidObjectId(applicationId)) {
      resolvedApp = await Application.findById(applicationId);
    }
  }

  if (!resolvedApp) {
    throw new BadRequestError('Invalid application');
  }

  if (resolvedApp.status !== 'active') {
    // Suspended / deleted / pending_review applications cannot start flows.
    throw new ForbiddenError('Application is not available');
  }

  // The browser Origin the session was created from (null for native callers).
  // Captured for the approval UI and bound into the QR payload.
  const boundOrigin = requestOrigin(req);

  // Public OAuth client IDs are routing identifiers, not authenticators. For
  // trusted first-party/internal app identities, a browser caller must prove it
  // is running on one of the app's registered redirect origins before the
  // device-consent UI shows official branding. Native clients attach no Origin /
  // Referer header (no browser context) and cannot prove an origin, so they are
  // accepted as-is — the device-flow consent screen still authorises every
  // session interactively.
  if (isTrustedApplication(resolvedApp) && hasBrowserContext(req)) {
    // Loopback dev origins (http://localhost, 127.0.0.1, [::1] on any port) are
    // allowed to START the QR flow for a trusted app even though they are not
    // registered redirect origins — otherwise no local dev server could sign in.
    // This is only a gate to begin the flow; `originVerified` below stays false
    // for loopback (it keys off applicationAllowsOrigin ONLY), so the Commons
    // approval UI still shows its anti-phishing warning for an unverified origin.
    if (!boundOrigin || (!applicationAllowsOrigin(resolvedApp, boundOrigin) && !isLoopbackOrigin(boundOrigin))) {
      throw new ForbiddenError('Application origin is not allowed');
    }
  }

  // Authoritative anti-phishing signal for the Commons approval UI. True ONLY
  // when a platform-trusted Application proved it is running on one of its OWN
  // registered redirect origins. Native callers (no Origin) and untrusted /
  // third-party apps are `false` — Commons warns the approver in that case. The
  // guard above already rejected a trusted browser caller on a NON-registered
  // origin, so reaching here with a trusted app + allowed origin is the only way
  // this is true. This flag is never a gate by itself.
  const originVerified =
    isTrustedApplication(resolvedApp) &&
    !!boundOrigin &&
    applicationAllowsOrigin(resolvedApp, boundOrigin);

  // Check if session token already exists (generic error to prevent enumeration)
  const existing = await AuthSession.findOne({ sessionToken });
  if (existing) {
    throw new BadRequestError('Unable to create session');
  }

  // The client-supplied `sessionToken` is the SECRET claim credential and is
  // kept as-is (never regenerated, never echoed to observers). The
  // `authorizeCode` is a SEPARATE public single-use handle that travels in the
  // QR / deep link so the Commons vault can approve without ever seeing the
  // secret sessionToken.
  const authorizeCode = crypto.randomBytes(16).toString('hex');
  const qrNonce = crypto.randomBytes(8).toString('hex');

  // Device-first attribution: when the QR was started from a device that already
  // holds a session (oxy_device cookie) or presented an add-only deviceToken,
  // persist that central deviceId so the authorize paths mint the resulting
  // session onto the SAME device set instead of sprawling a fresh device.
  const attributionDeviceId = await resolveLoginDeviceId(req, deviceToken);

  // Create new auth session
  const authSession = await AuthSession.create({
    sessionToken,
    applicationId: resolvedApp._id,
    authorizeCode,
    boundOrigin: boundOrigin ?? null,
    originVerified,
    challengeNonce: qrNonce,
    expiresAt: expiresAtDate,
    status: 'pending',
    ...(attributionDeviceId ? { deviceId: attributionDeviceId } : {}),
  });

  // Deep-link / universal-link payload for the QR. Commons parses ONLY `code`
  // from this; the `approve` path segment and `code` param name are part of its
  // deep-link router contract and MUST NOT change.
  const qrPayload = `oxycommons://approve?v=1&code=${authorizeCode}&app=${resolvedApp._id.toString()}` +
    `&origin=${encodeURIComponent(boundOrigin ?? '')}&nonce=${qrNonce}&exp=${expiresAtDate.getTime()}`;

  logger.debug('Auth session created', {
    sessionToken: sessionToken.substring(0, 8) + '...',
    authorizeCode: authorizeCode.substring(0, 8) + '...',
    applicationId: resolvedApp._id.toString(),
  });

  sendSuccess(res, {
    sessionToken: authSession.sessionToken,
    authorizeCode: authSession.authorizeCode,
    expiresAt: authSession.expiresAt.toISOString(),
    status: authSession.status,
    qrPayload,
  });
}));

/**
 * @openapi
 * /auth/session/status/{sessionToken}:
 *   get:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Poll the status of a cross-app auth session
 *     description: >
 *       Polled by the client that opened a session via
 *       `POST /auth/session/create`. Returns the session's current `status`
 *       and, once authorised, the `sessionId` / `userId` that the client
 *       should now treat as its own session.
 *     parameters:
 *       - name: sessionToken
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Current status of the auth session.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [pending, authorized, cancelled, expired]
 *                 authorized:
 *                   type: boolean
 *                 sessionToken:
 *                   type: string
 *                 application:
 *                   nullable: true
 *                   description: >
 *                     Sanitized public metadata of the registered Application
 *                     bound to this session, for the consent UI. Null only if
 *                     the app was hard-deleted after the session was created.
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     description:
 *                       type: string
 *                     icon:
 *                       type: string
 *                     websiteUrl:
 *                       type: string
 *                     type:
 *                       type: string
 *                       enum: [first_party, third_party, internal, system]
 *                     isOfficial:
 *                       type: boolean
 *                     isInternal:
 *                       type: boolean
 *                     scopes:
 *                       type: array
 *                       items:
 *                         type: string
 *                     developerName:
 *                       type: string
 *                       description: Best-effort owner display name (non-official apps only).
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *                 sessionId:
 *                   type: string
 *                   nullable: true
 *                 publicKey:
 *                   type: string
 *                   nullable: true
 *                 userId:
 *                   type: string
 *                   nullable: true
 *             examples:
 *               pending:
 *                 value:
 *                   status: pending
 *                   authorized: false
 *                   sessionToken: at_random_4e9c2a1b8e9d3f4a1c2b3d4
 *                   application:
 *                     id: 64f7c2a1b8e9d3f4a1c2b3d4
 *                     name: Oxy Accounts
 *                     type: first_party
 *                     isOfficial: true
 *                     isInternal: false
 *                     scopes: [user:read]
 *                   expiresAt: '2025-05-25T12:39:56.000Z'
 *                   sessionId: null
 *                   publicKey: null
 *                   userId: null
 *               authorized:
 *                 value:
 *                   status: authorized
 *                   authorized: true
 *                   sessionToken: at_random_4e9c2a1b8e9d3f4a1c2b3d4
 *                   application:
 *                     id: 64f7c2a1b8e9d3f4a1c2b3d4
 *                     name: Acme Widgets
 *                     type: third_party
 *                     isOfficial: false
 *                     isInternal: false
 *                     scopes: [files:read, user:read]
 *                     websiteUrl: https://acme.example
 *                     developerName: Ada Lovelace
 *                   expiresAt: '2025-05-25T12:39:56.000Z'
 *                   sessionId: sess_64f7c2a1b8e9d3f4a1c2b3d4
 *                   publicKey: '02a1b2c3d4e5f6...'
 *                   userId: 64f7c2a1b8e9d3f4a1c2b3d4
 *       404:
 *         description: Auth session not found.
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

  // Resolve sanitized public application metadata for the consent UI. Every
  // session is bound to a canonical `applicationId` at create-time, so this is
  // normally always present. If the app was later hard-deleted (or is no longer
  // active) we return null rather than throwing — defensive only.
  let application = null;
  const app = await Application.findById(authSession.applicationId);
  if (app && app.status === 'active') {
    const developerName = await resolveDeveloperName(app);
    application = serializePublicApplication(app, developerName);
  }

  sendSuccess(res, {
    status: authSession.status,
    authorized: authSession.status === 'authorized',
    sessionToken: authSession.sessionToken,
    application,
    expiresAt: authSession.expiresAt.toISOString(),
    sessionId: authSession.authorizedSessionId || null,
    publicKey: authSession.authorizedBy || null,
    userId: authSession.authorizedUserId ? authSession.authorizedUserId.toString() : null,
  });
}));

/**
 * @openapi
 * /auth/session/authorize/{sessionToken}:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Authorise a pending cross-app auth session
 *     description: >
 *       Called by the Oxy Accounts app (or any first-party UI) after the
 *       user accepts a cross-app sign-in prompt. Requires the authorising
 *       user's access token via the `Authorization: Bearer` header — the
 *       authenticated principal is the only valid source of "who is
 *       authorising". The previous `x-session-id`-based path has been
 *       removed (fixes C2).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: sessionToken
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deviceName:
 *                 type: string
 *               deviceFingerprint:
 *                 type: string
 *     responses:
 *       200:
 *         description: Session authorised.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 sessionId:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Session expired, or malformed body.
 *       401:
 *         description: Missing or invalid bearer token.
 *       404:
 *         description: Auth session not found or already processed.
 */
router.post('/session/authorize/:sessionToken', authMiddleware, validate({ params: authSessionTokenParams, body: authorizeSessionBodySchema }), asyncHandler(async (req: AuthRequest, res) => {
  const { sessionToken } = req.params;
  const { deviceName, deviceFingerprint } = req.body;

  const authenticatedUser = req.user;
  if (!authenticatedUser?._id) {
    throw new UnauthorizedError('Authentication required');
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

  const authenticatedUserId = authenticatedUser._id.toString();

  // Resolve the bound Application for the device-name label. The session can't
  // exist without a valid applicationId; fall back to a generic label only if
  // the app was hard-deleted between create and authorize.
  const app = await Application.findById(authSession.applicationId);
  const appLabel = app ? app.name : 'App';

  // Create a new session for the third-party app, owned by the
  // authenticated user identified via the bearer token. When the flow was
  // started with a device binding (`deviceId` persisted at create time), pass it
  // as the explicit deviceId so the session lands on the originating device.
  const newSession = await sessionService.createSession(
    authenticatedUserId,
    req,
    {
      deviceName: deviceName || `${appLabel} App`,
      deviceFingerprint,
      ...(authSession.deviceId ? { deviceId: authSession.deviceId } : {}),
    }
  );

  // Update auth session
  authSession.status = 'authorized';
  if (authenticatedUser.publicKey) {
    authSession.authorizedBy = authenticatedUser.publicKey;
  }
  authSession.authorizedUserId = authenticatedUser._id;
  authSession.authorizedSessionId = newSession.sessionId;
  await authSession.save();

  logger.info('Auth session authorized', {
    sessionToken: sessionToken.substring(0, 8) + '...',
    userId: authenticatedUserId,
    applicationId: authSession.applicationId.toString(),
  });

  // Emit socket event to notify the waiting client
  emitAuthSessionUpdate(sessionToken, {
    status: 'authorized',
    sessionId: newSession.sessionId,
    publicKey: authenticatedUser.publicKey,
    userId: authenticatedUserId,
    username: authenticatedUser.username,
  });

  sendSuccess(res, {
    success: true,
    sessionId: newSession.sessionId,
    user: {
      id: authenticatedUserId,
      username: authenticatedUser.username,
      publicKey: authenticatedUser.publicKey,
    },
  });
}));

// Limiter for the device-flow claim. Tighter than the OAuth token
// endpoint because each `sessionToken` is single-use — legitimate
// clients hit this at most once per flow. The cap blunts brute-force
// attempts against the 128-bit sessionToken value even though
// guessing is computationally infeasible (10^7 RPS for 100 years to
// hit a 50 % collision).
const authSessionClaimLimiter = rateLimit({
  prefix: 'rl:auth:session-claim:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 30,
});

/**
 * @openapi
 * /auth/session/claim:
 *   post:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Exchange a sessionToken for the first access token (device flow)
 *     description: >
 *       Final step of the QR-code / "Open Oxy Auth" device sign-in flow.
 *       After another authenticated device has approved this session via
 *       `POST /auth/session/authorize/{sessionToken}`, the originating
 *       client — which alone knows the secret `sessionToken` — calls
 *       this endpoint to atomically claim the resulting access token,
 *       refresh token, and session ID.
 *
 *       No `Authorization` header is required: the 128-bit `sessionToken`
 *       (held only by the originating client, never echoed back to
 *       observers) IS the credential, exactly as in RFC 8628 §3.4.
 *       The exchange is single-use: a successful claim transitions the
 *       AuthSession status from `authorized` -> `consumed`, so a replayed
 *       sessionToken is rejected. Time-bound by the AuthSession TTL
 *       (default 5 minutes). Status-bound: only `authorized` rows are
 *       claimable.
 *
 *       This endpoint is the only device-flow token handoff: the originating
 *       client starts with no bearer token, so it must claim exactly once with
 *       the secret sessionToken it created.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionToken
 *             properties:
 *               sessionToken:
 *                 type: string
 *                 description: The same 128-bit sessionToken issued by `POST /auth/session/create`.
 *               deviceFingerprint:
 *                 type: string
 *                 description: Optional fingerprint of the originating client device.
 *     responses:
 *       200:
 *         description: First access token issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *                 sessionId:
 *                   type: string
 *                 deviceId:
 *                   type: string
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation failed.
 *       401:
 *         description: SessionToken is unknown, expired, cancelled, not yet authorized, or already consumed.
 */
router.post(
  '/session/claim',
  authSessionClaimLimiter,
  validate({ body: authSessionClaimSchema }),
  asyncHandler(async (req, res) => {
    const { sessionToken } = req.body as { sessionToken: string };

    const outcome = await claimAuthSession({ sessionToken });

    if (!outcome.ok) {
      // Per RFC 6749 §5.2 we collapse all failure modes to a single
      // generic error to avoid leaking which step failed (does the
      // sessionToken exist? was it authorized?).
      logger.warn('[AuthSession] Claim rejected', {
        reason: outcome.reason,
        sessionToken: sessionToken.substring(0, 8) + '...',
      });
      throw new UnauthorizedError('invalid_grant');
    }

    const { authSession } = outcome;

    if (!authSession.authorizedSessionId || !authSession.authorizedUserId) {
      // Defensive: should never happen for an 'authorized' row but we
      // never want to return a successful response without these.
      logger.error('[AuthSession] Claimed authSession is missing bindings', new Error('missing bindings'), {
        sessionToken: sessionToken.substring(0, 8) + '...',
      });
      throw new UnauthorizedError('invalid_grant');
    }

    const tokenResult = await sessionService.getAccessToken(authSession.authorizedSessionId);
    if (!tokenResult) {
      logger.error('[AuthSession] Could not resolve access token for claimed session', new Error('no access token'), {
        sessionToken: sessionToken.substring(0, 8) + '...',
        sessionId: authSession.authorizedSessionId,
      });
      throw new UnauthorizedError('invalid_grant');
    }

    const user = await User.findById(authSession.authorizedUserId).lean();
    if (!user) {
      logger.error('[AuthSession] User not found for claimed session', new Error('user not found'), {
        sessionToken: sessionToken.substring(0, 8) + '...',
        userId: authSession.authorizedUserId.toString(),
      });
      throw new UnauthorizedError('invalid_grant');
    }

    // Pull the deviceId from the underlying Session for the response.
    const session = await Session.findOne({ sessionId: authSession.authorizedSessionId })
      .select('deviceId expiresAt')
      .lean();

    if (!session) {
      logger.error('[AuthSession] Underlying session disappeared between authorize and claim', new Error('session missing'), {
        sessionToken: sessionToken.substring(0, 8) + '...',
      });
      throw new UnauthorizedError('invalid_grant');
    }

    // Return a fresh ROTATING refresh-family token (the persisted-refresh lane),
    // NOT the legacy Session-embedded JWT. The client persists this and rotates
    // it via `POST /auth/refresh-token`. (The OAuth `/auth/oauth/token` flow is
    // deliberately untouched.)
    const refresh = await issueRefreshToken({
      sessionId: authSession.authorizedSessionId,
      userId: authSession.authorizedUserId.toString(),
    });

    const userData = formatUserResponse(user);

    // Additive 2c mint: when the claimed session's device carries a
    // `DeviceSession` doc, hand the client a rotating `deviceSecret` so it can
    // migrate onto the zero-cookie lane. Best-effort — a mint failure never fails
    // the claim, and a device with no doc simply omits the secret.
    let deviceSecret: string | undefined;
    try {
      if (typeof session.deviceId === 'string' && session.deviceId.length > 0) {
        const { deviceSessionService } = await import('../services/deviceSession.service.js');
        const minted = await deviceSessionService.issueDeviceSecret(session.deviceId);
        if (minted) deviceSecret = minted;
      }
    } catch (error) {
      logger.warn('[AuthSession] deviceSecret mint failed on claim', {
        sessionId: authSession.authorizedSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('[AuthSession] Claim succeeded', {
      sessionToken: sessionToken.substring(0, 8) + '...',
      sessionId: authSession.authorizedSessionId,
      userId: authSession.authorizedUserId.toString(),
      applicationId: authSession.applicationId.toString(),
    });

    sendSuccess(res, {
      accessToken: tokenResult.accessToken,
      refreshToken: refresh.token,
      sessionId: authSession.authorizedSessionId,
      deviceId: session.deviceId,
      expiresAt: tokenResult.expiresAt.toISOString(),
      user: userData,
      ...(deviceSecret ? { deviceSecret } : {}),
    });
  })
);

/**
 * POST /auth/session/cancel/:sessionToken
 * Cancel an auth session. The `sessionToken` is a 128-bit secret held only by
 * the originating client, so possessing it IS the ownership proof — no
 * additional identifier is required.
 */
router.post('/session/cancel/:sessionToken', validate({ params: authSessionTokenParams }), asyncHandler(async (req, res) => {
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
// "Sign in with Oxy" QR / app-to-app handoff (C2)
// ============================================
//
// The originating client (web RP / native app) creates a session and renders a
// QR whose `authorizeCode` is PUBLIC; the secret `sessionToken` never leaves the
// originator. The Commons vault scans it, fetches the server-resolved app
// identity (so a spoofed-name QR still shows the true app), biometric-gates, and
// approves by SIGNING a challenge with its local key — no bearer token. The
// originator then claims the result with its secret `sessionToken` as usual.

// Public — read-only resolution of the app identity behind an authorizeCode.
const authSessionApproveInfoLimiter = rateLimit({
  prefix: 'rl:auth:session-approve-info:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 60,
});

// Key-signed approval. Tight, like the claim limiter — a legitimate approval
// hits this once per flow; the cap blunts brute force against the authorizeCode.
const authSessionAuthorizeSignedLimiter = rateLimit({
  prefix: 'rl:auth:session-authorize-signed:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 30,
});

/**
 * GET /auth/session/approve-info/:authorizeCode
 *
 * PUBLIC. Returns the server-resolved, sanitized Application identity (never the
 * QR's self-asserted strings) plus the bound origin and status, so the Commons
 * approval screen renders the TRUE app. Never leaks the secret `sessionToken`.
 */
router.get(
  '/session/approve-info/:authorizeCode',
  authSessionApproveInfoLimiter,
  validate({ params: authorizeCodeParams }),
  asyncHandler(async (req, res) => {
    const { authorizeCode } = req.params;

    const authSession = await AuthSession.findOne({ authorizeCode });
    if (!authSession) {
      throw new NotFoundError('Auth session not found');
    }

    if (authSession.status === 'pending' && authSession.expiresAt < new Date()) {
      authSession.status = 'expired';
      await authSession.save();
    }

    let application = null;
    let scopes: string[] = [];
    const app = await Application.findById(authSession.applicationId);
    if (app && app.status === 'active') {
      const developerName = await resolveDeveloperName(app);
      application = serializePublicApplication(app, developerName);
      scopes = Array.isArray(app.scopes) ? [...app.scopes] : [];
    }

    sendSuccess(res, {
      application,
      scopes,
      boundOrigin: authSession.boundOrigin ?? null,
      // Authoritative anti-phishing signal. When false (native callers, or a
      // session NOT proven to originate from a trusted app's own registered
      // origin), Commons warns the approver that the source is unverifiable.
      originVerified: authSession.originVerified ?? false,
      expiresAt: authSession.expiresAt.toISOString(),
      status: authSession.status,
    });
  }),
);

/**
 * POST /auth/session/authorize-signed/:authorizeCode
 *
 * NO bearer auth — this is the gap-filler. The Commons vault approves with its
 * local secp256k1 key: it proves key control with a single-use challenge
 * signature (`verifyChallengeResponse` + atomic burn), and the resolved signer
 * becomes the authorizing user. The session is bound by `authorizeCode`. The
 * waiting originator is notified over the socket on the row's `sessionToken`.
 */
router.post(
  '/session/authorize-signed/:authorizeCode',
  authSessionAuthorizeSignedLimiter,
  validate({ params: authorizeCodeParams, body: authSessionAuthorizeSignedSchema }),
  asyncHandler(async (req, res) => {
    const { authorizeCode } = req.params;
    const { publicKey, challenge, signature, timestamp, deviceName, deviceFingerprint } = req.body as {
      publicKey: string;
      challenge: string;
      signature: string;
      timestamp: number;
      deviceName?: string;
      deviceFingerprint?: string;
    };

    // The challenge verify + atomic burn + session binding live in the service
    // (mirrors claimAuthSession) so the AuthChallenge/model import chain stays
    // out of the route module's load path.
    const outcome = await authorizeSessionWithSignedChallenge({
      authorizeCode,
      publicKey,
      challenge,
      signature,
      timestamp,
      deviceName,
      deviceFingerprint,
      req,
    });

    if (!outcome.ok) {
      if (outcome.status === 401) throw new UnauthorizedError(outcome.message);
      if (outcome.status === 404) throw new NotFoundError(outcome.message);
      throw new BadRequestError(outcome.message);
    }

    logger.info('Auth session authorized (key-signed)', {
      authorizeCode: authorizeCode.substring(0, 8) + '...',
      userId: outcome.userId,
    });

    // Notify the waiting originator on its secret sessionToken channel.
    emitAuthSessionUpdate(outcome.sessionToken, {
      status: 'authorized',
      sessionId: outcome.sessionId,
      publicKey: outcome.publicKey,
      userId: outcome.userId,
      username: outcome.username,
    });

    sendSuccess(res, {
      success: true,
      sessionId: outcome.sessionId,
      user: {
        id: outcome.userId,
        username: outcome.username,
        publicKey: outcome.publicKey,
      },
    });
  }),
);

/**
 * POST /auth/session/deny/:authorizeCode
 *
 * The Commons vault denies a pending approval. It never holds the secret
 * `sessionToken`, so it cannot use `/session/cancel/:sessionToken`; it cancels
 * by the public `authorizeCode` instead. Only a PENDING session can be denied
 * (so a knower of the code cannot cancel an already-authorized session).
 */
router.post(
  '/session/deny/:authorizeCode',
  validate({ params: authorizeCodeParams }),
  asyncHandler(async (req, res) => {
    const { authorizeCode } = req.params;

    const authSession = await AuthSession.findOne({ authorizeCode });
    if (!authSession) {
      throw new NotFoundError('Auth session not found');
    }

    if (authSession.status === 'pending') {
      authSession.status = 'cancelled';
      await authSession.save();
      emitAuthSessionUpdate(authSession.sessionToken, { status: 'cancelled' });
    }

    sendSuccess(res, { success: true });
  }),
);

// ============================================
// OAuth2 Authorization Code Flow (with PKCE)
// ============================================
//
// Tokenless browser authorization flow:
//
//   1. User signs into the auth UI.
//   2. UI calls POST /auth/oauth/authorize (Bearer auth) with `clientId`,
//      `redirectUri`, optional PKCE `codeChallenge` (S256) and `state`.
//   3. Server validates the `redirectUri` against the Application
//      `redirectUris` allowlist and mints a single-use authorization code.
//   4. UI redirects the browser to `redirectUri?code=<code>&state=<state>`.
//   5. The third-party app's backend (or a public client with the matching
//      PKCE `code_verifier`) POSTs `/auth/oauth/token` to exchange the code
//      for `{ accessToken, refreshToken, sessionId, user }`.
//
// Access tokens never appear in the URL bar.

/**
 * Validate a redirect URI against the Application allowlist using an exact
 * match (per OAuth2 RFC 6749 §3.1.2). Partial / prefix matching is the
 * source of countless open-redirect vulnerabilities — we never normalise
 * away path or query for the comparison. Constant-time equality keeps the
 * comparison from leaking the allowlist contents via timing.
 */
function isAllowedRedirectUri(app: { redirectUris?: string[] }, redirectUri: string): boolean {
  const allowlist = app.redirectUris ?? [];
  if (allowlist.length === 0) return false;
  const provided = Buffer.from(redirectUri);
  for (const allowed of allowlist) {
    const allowedBuf = Buffer.from(allowed);
    if (allowedBuf.length === provided.length && crypto.timingSafeEqual(allowedBuf, provided)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve an OAuth `clientId` (= ApplicationCredential.publicKey) to its
 * usable credential. Accepts `active` OR `deprecated`-within-grace credentials;
 * rejects `revoked` and any whose rotation grace has elapsed. Returns null when
 * no usable credential exists. Mirrors the resolution in `/oauth/authorize`
 * and `/oauth/token`.
 */
async function resolveUsableCredential(clientId: string): Promise<IApplicationCredential | null> {
  const credential = await ApplicationCredential.findOne({
    publicKey: clientId,
    status: { $ne: 'revoked' },
  });
  if (!credential || !isCredentialUsable(credential)) {
    return null;
  }
  return credential;
}

/** Parse the origin of a registered redirect URI, or null when malformed. */
function originFromRedirectUri(redirectUri: string): string | null {
  try {
    return new URL(redirectUri).origin;
  } catch {
    return null;
  }
}

/** First (or only) value of a possibly-array header, trimmed to a string. */
function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

/** The browser-attached `Origin` of the request, or null when absent. */
function requestOrigin(req: express.Request): string | null {
  return firstHeaderValue(req.headers.origin);
}

/**
 * A browser/web context is detectable when the user agent attached an `Origin`
 * or `Referer` header. Native clients (Expo `deviceFlowSignIn`) attach neither,
 * so the absence of BOTH signals a genuine native sign-in that cannot prove an
 * origin and must not be rejected for lacking one.
 */
function hasBrowserContext(req: express.Request): boolean {
  return Boolean(requestOrigin(req) || firstHeaderValue(req.headers.referer));
}

/** True when `origin` is the origin of one of the app's registered redirect URIs. */
function applicationAllowsOrigin(app: Pick<IApplication, 'redirectUris'>, origin: string): boolean {
  return (app.redirectUris ?? []).some((redirectUri) => originFromRedirectUri(redirectUri) === origin);
}

/**
 * Best-effort owner display name for the consent UI. Only meaningful for
 * non-official apps. Never throws — a missing/deleted owner yields undefined so
 * the serializer simply omits the attribution.
 */
async function resolveDeveloperName(app: IApplication): Promise<string | undefined> {
  if (app.isOfficial) {
    return undefined;
  }
  const owner = await User.findById(app.createdByUserId)
    .select('username name')
    .lean<{ username?: string; name?: { first?: string; last?: string } } | null>();
  if (!owner) {
    return undefined;
  }
  const first = typeof owner.name?.first === 'string' ? owner.name.first : '';
  const last = typeof owner.name?.last === 'string' ? owner.name.last : '';
  const full = [first, last].filter(Boolean).join(' ').trim();
  const display = full || (typeof owner.username === 'string' ? owner.username.trim() : '');
  return display || undefined;
}

const oauthAuthorizeLimiter = rateLimit({
  prefix: 'rl:auth:oauth-authorize:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 20,
});

const oauthTokenLimiter = rateLimit({
  prefix: 'rl:auth:oauth-token:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 30,
});

const oauthClientLookupLimiter = rateLimit({
  prefix: 'rl:auth:client-lookup:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 200 : 60,
});

const oauthConsentLimiter = rateLimit({
  prefix: 'rl:auth:oauth-consent:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 200 : 60,
});

const grantsReadLimiter = rateLimit({
  prefix: 'rl:auth:grants:read:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 200 : 60,
});

const grantsRevokeLimiter = rateLimit({
  prefix: 'rl:auth:grants:revoke:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 30,
});

/**
 * @openapi
 * /auth/oauth/authorize:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Issue an OAuth2 authorization code (after user consent)
 *     description: >
 *       Called by the Oxy auth UI after the user clicks "Allow" on a
 *       third-party app's consent screen. Requires the authenticated user's
 *       Bearer access token. Returns a short-lived single-use code that the
 *       client app exchanges for tokens via `POST /auth/oauth/token`.
 *
 *       The `redirectUri` MUST exactly match one of the Application's
 *       registered `redirectUris` — otherwise the request is rejected.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - redirectUri
 *             properties:
 *               clientId:
 *                 type: string
 *                 description: ApplicationCredential publicKey (OAuth client_id)
 *               redirectUri:
 *                 type: string
 *                 format: uri
 *               state:
 *                 type: string
 *                 description: Opaque CSRF token forwarded back to the client.
 *               codeChallenge:
 *                 type: string
 *                 description: PKCE code challenge (S256). Required for public clients.
 *               codeChallengeMethod:
 *                 type: string
 *                 enum: ['S256']
 *               scope:
 *                 type: string
 *     responses:
 *       200:
 *         description: Authorization code issued.
 *       400:
 *         description: Validation failed.
 *       401:
 *         description: Missing or invalid bearer token.
 *       403:
 *         description: Redirect URI is not registered for this client.
 */
router.post(
  '/oauth/authorize',
  authMiddleware,
  oauthAuthorizeLimiter,
  validate({ body: oauthAuthorizeSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const user = req.user;
    if (!user?._id) {
      throw new UnauthorizedError('Authentication required');
    }

    const { clientId, redirectUri, state, codeChallenge, codeChallengeMethod, scope } = req.body as {
      clientId: string;
      redirectUri: string;
      state?: string;
      codeChallenge?: string;
      codeChallengeMethod?: 'S256';
      scope?: string;
    };

    // PKCE: if a challenge is provided, the method must be S256. Plain is
    // explicitly rejected — only S256 is acceptable per current OAuth BCP.
    if (codeChallenge && codeChallengeMethod && codeChallengeMethod !== 'S256') {
      throw new BadRequestError('Only S256 code_challenge_method is supported');
    }

    // The ApplicationCredential.publicKey serves as the OAuth `client_id`.
    // Accept `active` OR `deprecated`-but-within-grace credentials; reject
    // `revoked` and any whose rotation grace window has expired.
    const credential = await ApplicationCredential.findOne({
      publicKey: clientId,
      status: { $ne: 'revoked' },
    });
    if (!credential || !isCredentialUsable(credential)) {
      // Don't leak whether the client exists vs is revoked/expired.
      throw new BadRequestError('Invalid client');
    }

    const app = await Application.findOne({ _id: credential.applicationId, status: 'active' });
    if (!app) {
      throw new BadRequestError('Invalid client');
    }

    if (!isAllowedRedirectUri(app, redirectUri)) {
      // Per RFC 6749 §3.1.2.4 the server MUST NOT redirect when the URI is
      // not registered. Surface the error to the auth UI instead.
      logger.warn('[OAuth] Rejected unregistered redirect_uri', {
        clientId: clientId.substring(0, 12) + '...',
        redirectUri,
      });
      throw new ForbiddenError('redirect_uri is not registered for this client');
    }

    const requestedScopes = scope ? scope.split(/\s+/).filter(Boolean) : [];

    // Mint a single-use opaque code. The service persists a hash, never
    // the raw value, so leakage of the AuthCode collection would not
    // allow an attacker to redeem outstanding codes.
    const { code: rawCode } = await issueAuthCode({
      userId: user._id,
      appId: app._id.toString(),
      redirectUri,
      codeChallenge,
      codeChallengeMethod: codeChallenge ? 'S256' : undefined,
      scopes: requestedScopes,
    });

    // Record (or refresh) the user's consent so a returning user skips the
    // consent screen while the granted scopes still cover the request — the
    // standard OAuth returning-user model. TRUSTED apps are auto-approved and
    // never prompt, so we DON'T persist a (revocable) grant for them; only
    // third-party grants belong in the "Connected apps" management surface.
    // Best-effort: a failure here must never block the issued code.
    if (!isTrustedApplication(app)) {
      try {
        const now = new Date();
        await AppGrant.findOneAndUpdate(
          { userId: user._id, applicationId: app._id },
          {
            $set: { lastUsedAt: now },
            $addToSet: { scopes: { $each: requestedScopes } },
            $setOnInsert: { firstGrantedAt: now },
          },
          { upsert: true, new: true }
        );
      } catch (error) {
        logger.warn('[OAuth] Failed to record AppGrant', {
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('[OAuth] Authorization code issued', {
      clientId: clientId.substring(0, 12) + '...',
      userId: user._id.toString(),
      hasPkce: Boolean(codeChallenge),
    });

    sendSuccess(res, {
      code: rawCode,
      state: state ?? null,
      redirectUri,
      expiresIn: Math.floor(AUTH_CODE_TTL_MS / 1000),
    });
  })
);

/**
 * @openapi
 * /auth/oauth/consent:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Server-authoritative decision on whether OAuth consent is needed
 *     description: >
 *       Called by the auth UI before rendering the consent screen. Resolves the
 *       `clientId` to an Application (validating the `redirectUri` exactly like
 *       `POST /auth/oauth/authorize`) and decides whether the user must consent:
 *
 *       - TRUSTED apps (first-party / internal / system / official) are
 *         auto-approved → `consentRequired: false, reason: 'trusted'`.
 *       - A prior grant whose scopes cover the requested `scope` →
 *         `consentRequired: false, reason: 'granted'`.
 *       - A prior grant missing some requested scope →
 *         `consentRequired: true, reason: 'scope_changed'`.
 *       - No prior grant → `consentRequired: true, reason: 'new'`.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: clientId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: redirectUri
 *         required: true
 *         schema: { type: string, format: uri }
 *       - in: query
 *         name: scope
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Consent decision.
 *       400:
 *         description: Invalid client.
 *       401:
 *         description: Missing or invalid bearer token.
 *       403:
 *         description: Redirect URI is not registered for this client.
 */
router.get(
  '/oauth/consent',
  authMiddleware,
  oauthConsentLimiter,
  validate({ query: oauthConsentQuerySchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const user = req.user;
    if (!user?._id) {
      throw new UnauthorizedError('Authentication required');
    }

    const { clientId, redirectUri, scope } = req.query as unknown as {
      clientId: string;
      redirectUri: string;
      scope?: string;
    };

    // Resolve credential → app EXACTLY like POST /oauth/authorize: a usable
    // (active or in-grace) credential pointing at an active application, with
    // the redirect_uri matched exactly (RFC 6749 §3.1.2).
    const credential = await resolveUsableCredential(clientId);
    if (!credential) {
      throw new BadRequestError('Invalid client');
    }
    const app = await Application.findOne({ _id: credential.applicationId, status: 'active' });
    if (!app) {
      throw new BadRequestError('Invalid client');
    }
    if (!isAllowedRedirectUri(app, redirectUri)) {
      throw new ForbiddenError('redirect_uri is not registered for this client');
    }

    // Trusted apps are auto-approved — full first-party trust, regardless of
    // scope (the Google-with-its-own-apps model).
    if (isTrustedApplication(app)) {
      sendSuccess(res, { consentRequired: false, reason: 'trusted' });
      return;
    }

    const requestedScopes = scope ? scope.split(/\s+/).filter(Boolean) : [];
    const grant = await AppGrant.findOne({ userId: user._id, applicationId: app._id })
      .select('scopes')
      .lean<{ scopes?: string[] } | null>();

    if (grant) {
      const granted = new Set(grant.scopes ?? []);
      const covered = requestedScopes.every((s) => granted.has(s));
      if (covered) {
        sendSuccess(res, { consentRequired: false, reason: 'granted' });
        return;
      }
      sendSuccess(res, { consentRequired: true, reason: 'scope_changed' });
      return;
    }

    sendSuccess(res, { consentRequired: true, reason: 'new' });
  })
);

/**
 * Public summary of an application the user has connected via OAuth — what the
 * "Connected apps" management UI consumes. Built from AppGrant rows joined with
 * Application metadata.
 */
interface ConnectedAppSummary {
  applicationId: string;
  name: string;
  logoUrl?: string;
  scopes: string[];
  firstGrantedAt: string;
  lastUsedAt: string;
}

/**
 * @openapi
 * /auth/grants:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: List the third-party apps the user has authorized (Connected apps)
 *     description: >
 *       Returns the user's revocable OAuth grants joined with the application's
 *       name + logo + granted scopes + timestamps. Trusted (auto-approved) apps
 *       are never recorded as grants, so they never appear here.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The user's connected applications.
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.get(
  '/grants',
  authMiddleware,
  grantsReadLimiter,
  asyncHandler(async (req: AuthRequest, res) => {
    const user = req.user;
    if (!user?._id) {
      throw new UnauthorizedError('Authentication required');
    }

    const grants = await AppGrant.find({ userId: user._id })
      .select('applicationId scopes firstGrantedAt lastUsedAt')
      .sort({ lastUsedAt: -1 })
      .lean<
        Array<{
          applicationId: mongoose.Types.ObjectId;
          scopes?: string[];
          firstGrantedAt: Date;
          lastUsedAt: Date;
        }>
      >();

    const applicationIds = grants.map((grant) => grant.applicationId);
    const apps = await Application.find({ _id: { $in: applicationIds } })
      .select('name icon')
      .lean<Array<{ _id: mongoose.Types.ObjectId; name: string; icon?: string }>>();

    const appById = new Map(apps.map((app) => [app._id.toString(), app]));

    const data: ConnectedAppSummary[] = [];
    for (const grant of grants) {
      const app = appById.get(grant.applicationId.toString());
      // Skip grants whose application no longer exists — effectively revoked.
      if (!app) continue;
      data.push({
        applicationId: grant.applicationId.toString(),
        name: app.name,
        logoUrl: app.icon ?? undefined,
        scopes: grant.scopes ?? [],
        firstGrantedAt: grant.firstGrantedAt.toISOString(),
        lastUsedAt: grant.lastUsedAt.toISOString(),
      });
    }

    sendSuccess(res, data);
  })
);

/**
 * @openapi
 * /auth/grants/{applicationId}:
 *   delete:
 *     tags:
 *       - Authentication
 *     summary: Revoke a connected app's OAuth grant
 *     description: >
 *       Deletes the user's AppGrant for the application so the next OAuth
 *       authorize for this app prompts for consent again.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: applicationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Grant revoked (idempotent).
 *       400:
 *         description: Invalid applicationId.
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.delete(
  '/grants/:applicationId',
  authMiddleware,
  grantsRevokeLimiter,
  validate({ params: grantApplicationIdParams }),
  asyncHandler(async (req: AuthRequest, res) => {
    const user = req.user;
    if (!user?._id) {
      throw new UnauthorizedError('Authentication required');
    }

    const { applicationId } = req.params;
    if (!isValidObjectId(applicationId)) {
      throw new BadRequestError('Invalid applicationId');
    }

    // Drop the OAuth grant — the next authorize for this app re-prompts consent.
    await AppGrant.deleteOne({ userId: user._id, applicationId });

    sendSuccess(res, { revoked: true });
  })
);

/**
 * @openapi
 * /auth/oauth/token:
 *   post:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Exchange an OAuth2 authorization code for tokens
 *     description: >
 *       Single-use exchange of an authorization code (from
 *       `POST /auth/oauth/authorize`) for a bearer access token, refresh
 *       token, and session ID. Either `clientSecret` (confidential clients)
 *       or `codeVerifier` (public clients with PKCE) is required.
 *
 *       Replaying an already-used code, sending a code past its 60-second
 *       TTL, or mismatching the `redirectUri` returns 401 with no detail
 *       about why.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - clientId
 *               - redirectUri
 *             properties:
 *               code:
 *                 type: string
 *               clientId:
 *                 type: string
 *               redirectUri:
 *                 type: string
 *                 format: uri
 *               clientSecret:
 *                 type: string
 *               codeVerifier:
 *                 type: string
 *     responses:
 *       200:
 *         description: Access token issued.
 *       400:
 *         description: Malformed request.
 *       401:
 *         description: Invalid, expired, replayed, or mis-bound code.
 */
router.post(
  '/oauth/token',
  oauthTokenLimiter,
  validate({ body: oauthTokenSchema }),
  asyncHandler(async (req, res) => {
    const { code, clientId, redirectUri, clientSecret, codeVerifier } = req.body as {
      code: string;
      clientId: string;
      redirectUri: string;
      clientSecret?: string;
      codeVerifier?: string;
    };

    // Accept `active` OR `deprecated`-but-within-grace credentials; reject
    // `revoked` and any whose rotation grace window has expired.
    const credential = await ApplicationCredential.findOne({
      publicKey: clientId,
      status: { $ne: 'revoked' },
    });
    if (!credential || !isCredentialUsable(credential)) {
      throw new UnauthorizedError('invalid_client');
    }

    const app = await Application.findOne({ _id: credential.applicationId, status: 'active' });
    if (!app) {
      throw new UnauthorizedError('invalid_client');
    }

    // If the caller asserts a confidential client secret, verify it in
    // constant time BEFORE we attempt the code exchange — that way an
    // attacker without a secret can't probe the code-binding outcomes. The
    // secret is compared as a SHA-256 hash against the stored `secretHash`.
    let clientSecretProvided = false;
    if (clientSecret) {
      if (!credential.secretHash) {
        throw new UnauthorizedError('invalid_client');
      }
      const expected = Buffer.from(credential.secretHash);
      const provided = Buffer.from(
        crypto.createHash('sha256').update(clientSecret).digest('hex')
      );
      if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
        throw new UnauthorizedError('invalid_client');
      }
      clientSecretProvided = true;
    }

    const exchange = await exchangeAuthCode({
      rawCode: code,
      appId: app._id.toString(),
      redirectUri,
      clientSecretProvided,
      codeVerifier,
    });

    if (!exchange.ok) {
      logger.warn('[OAuth] Token exchange rejected', {
        reason: exchange.reason,
        clientId: clientId.substring(0, 12) + '...',
      });
      if (exchange.reason === 'invalid_client') {
        throw new UnauthorizedError('invalid_client');
      }
      throw new UnauthorizedError('invalid_grant');
    }

    // Issue a session bound to the authenticated user from the code.
    const user = await User.findById(exchange.code.userId);
    if (!user) {
      throw new UnauthorizedError('invalid_grant');
    }

    const userId = user._id.toString();

    // Device-first attribution for the token grant — the last mint path that
    // used to orphan a UA/IP-derived deviceId (the cleanest reproduction of
    // "an RP shows a different account list"). Resolve the central device from
    // the oxy_device cookie (same-apex authorize→token) or an add-only
    // deviceToken (a cross-apex RP that persisted one at bootstrap). Absent →
    // no device attribution (we deliberately do NOT invent one).
    const oauthDeviceId = await resolveLoginDeviceId(
      req,
      (req.body as { deviceToken?: unknown }).deviceToken,
    );

    // ONE session per account per device: when the account is ALREADY registered
    // on the resolved device (added during the first-party authorize step),
    // REUSE that exact registered session so this RP converges on the SAME
    // sessionId + deviceId the DeviceSession doc holds (one socket room, shared
    // cross-domain broadcasts) instead of minting a per-RP session on a fresh
    // device. resolveRegisteredSession validates the session (managed act_as
    // re-check) before reuse and never resurrects a dead one.
    // `deviceSession.service` (and its DeviceSession Mongoose model) is imported
    // LAZILY — only when a device actually resolved — so merely loading the auth
    // router never forces the model to evaluate (mirrors deviceLogin.service).
    let session: ISession | null = null;
    if (oauthDeviceId) {
      const { deviceSessionService } = await import('../services/deviceSession.service.js');
      const registered = await deviceSessionService.resolveRegisteredSession(oauthDeviceId, userId);
      if (registered) {
        // Load the registered session for the response tokens; its access token
        // was just rotated/minted by resolveRegisteredSession and carries the
        // central deviceId claim. A race (session vanished) falls through to a
        // fresh mint below.
        session = await sessionService.getSession(registered.sessionId, false);
      }
    }

    if (!session) {
      // Fresh mint — thread the resolved device so createSession's reuse-by-
      // (userId, deviceId) converges, or a first mint lands on the central
      // device. No resolved device ⇒ pre-existing UA/IP attribution (unchanged).
      session = await sessionService.createSession(
        userId,
        req,
        { deviceName: `${app.name} OAuth`, ...(oauthDeviceId ? { deviceId: oauthDeviceId } : {}) },
      );

      // Register the freshly-minted session into the device set (add-only, never
      // steals the active account) so a SUBSEQUENT grant for this account on this
      // device reuses it via resolveRegisteredSession. Best-effort — a
      // registration failure must never fail the token grant. The lazy import is
      // module-cached, so re-importing here is free.
      if (oauthDeviceId) {
        try {
          const { deviceSessionService } = await import('../services/deviceSession.service.js');
          const { state, changed } = await deviceSessionService.addAccount(
            session.deviceId,
            { accountId: userId, sessionId: session.sessionId },
            { activate: 'if-empty' },
          );
          if (changed) broadcastDeviceState(state);
        } catch (error) {
          logger.warn('[OAuth] device-set registration failed', {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    app.lastUsedAt = new Date();
    await app.save();

    const userData = formatUserResponse(user);

    sendSuccess(res, {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      token_type: 'Bearer',
      expires_in: 15 * 60,
      session_id: session.sessionId,
      user: userData,
    });
  })
);

/**
 * @openapi
 * /auth/oauth/client/{clientId}:
 *   get:
 *     tags:
 *       - Authentication
 *     security: []
 *     summary: Public lookup of an application's consent-UI metadata
 *     description: >
 *       Resolves an OAuth `client_id` (= ApplicationCredential public key) to
 *       the sanitized public metadata of its registered Application so the auth
 *       web consent screen can render the app's name, icon, official badge, and
 *       requested scopes. No bearer token is required. Secrets, webhook config,
 *       owner identity, and capabilities are never returned. Returns a generic
 *       404 for unknown, revoked, expired, or inactive clients (no enumeration).
 *     parameters:
 *       - name: clientId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Sanitized application metadata.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 application:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     description:
 *                       type: string
 *                     icon:
 *                       type: string
 *                     websiteUrl:
 *                       type: string
 *                     type:
 *                       type: string
 *                       enum: [first_party, third_party, internal, system]
 *                     isOfficial:
 *                       type: boolean
 *                     isInternal:
 *                       type: boolean
 *                     scopes:
 *                       type: array
 *                       items:
 *                         type: string
 *                     developerName:
 *                       type: string
 *                       description: Best-effort owner display name (non-official apps only).
 *       404:
 *         description: Application not found.
 */
router.get(
  '/oauth/client/:clientId',
  oauthClientLookupLimiter,
  validate({ params: oauthClientParams }),
  asyncHandler(async (req, res) => {
    const { clientId } = req.params;

    const credential = await resolveUsableCredential(clientId);
    if (!credential) {
      // Generic 404 — don't disclose existence vs revoked/expired.
      throw new NotFoundError('Application not found');
    }

    const app = await Application.findOne({ _id: credential.applicationId, status: 'active' });
    if (!app) {
      throw new NotFoundError('Application not found');
    }

    const developerName = await resolveDeveloperName(app);

    sendSuccess(res, {
      application: serializePublicApplication(app, developerName),
    });
  })
);

// ============================================
// Service Token Authentication (Internal Services)
// ============================================

const SERVICE_TOKEN_EXPIRY = 3600; // 1 hour in seconds

const serviceTokenLimiter = rateLimit({
  prefix: 'rl:auth:service-token:',
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
 *       Exchange ApplicationCredential credentials (apiKey = publicKey,
 *       apiSecret = plaintext secret) for a short-lived service JWT (1 hour).
 *       Requires a usable credential of type `service` on an active
 *       application: either `active`, or `deprecated` but still within its
 *       rotation grace window (a credential rotated within the last 7 days keeps
 *       minting tokens until its grace `expiresAt`). `revoked` and grace-expired
 *       credentials are rejected. The minted JWT carries `appId` (Application
 *       `_id`) and `credentialId` (the minting ApplicationCredential `_id`).
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
 *                 description: ApplicationCredential publicKey
 *                 example: oxy_dk_abc123
 *               apiSecret:
 *                 type: string
 *                 description: ApplicationCredential plaintext secret
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
 *         description: Credential is not a service credential
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

  // Find the credential by its public key (apiKey). The credential must be a
  // `service` credential that is currently usable: `active`, or `deprecated`
  // but still inside its rotation grace window. `revoked` and grace-expired
  // credentials are rejected.
  const credential = await ApplicationCredential.findOne({
    publicKey: apiKey,
    status: { $ne: 'revoked' },
  });

  if (!credential || !isCredentialUsable(credential)) {
    logger.warn('[ServiceToken] Invalid apiKey attempt', { apiKey: apiKey.substring(0, 12) + '...' });
    throw new UnauthorizedError('Invalid credentials');
  }

  if (credential.type !== 'service') {
    logger.warn('[ServiceToken] Non-service credential attempted service token', {
      credentialId: credential._id.toString(),
      applicationId: credential.applicationId.toString(),
    });
    throw new ForbiddenError('Service tokens are only available to service credentials');
  }

  // Validate the secret as a SHA-256 hash with a timing-safe comparison.
  if (!credential.secretHash) {
    throw new UnauthorizedError('Invalid credentials');
  }
  const expectedBuffer = Buffer.from(credential.secretHash);
  const providedBuffer = Buffer.from(crypto.createHash('sha256').update(apiSecret).digest('hex'));

  if (expectedBuffer.length !== providedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    logger.warn('[ServiceToken] Invalid apiSecret attempt', {
      credentialId: credential._id.toString(),
      applicationId: credential.applicationId.toString(),
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  // The owning application must be active and part of the platform-trusted set.
  // Service tokens are bearer credentials for Oxy-to-Oxy / internal routes;
  // self-service third-party applications must not be able to mint them even if
  // they somehow hold a historical `service` credential row.
  const app = await Application.findOne({ _id: credential.applicationId, status: 'active' });
  if (!app) {
    logger.warn('[ServiceToken] Application inactive for service credential', {
      credentialId: credential._id.toString(),
      applicationId: credential.applicationId.toString(),
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  if (!isTrustedApplication(app)) {
    logger.warn('[ServiceToken] Untrusted application attempted service token', {
      credentialId: credential._id.toString(),
      applicationId: credential.applicationId.toString(),
    });
    throw new ForbiddenError('Service tokens are only available to trusted applications');
  }

  // Generate stateless service JWT — embed granted scopes so downstream
  // middleware can do per-scope authorisation without an extra DB lookup. The
  // `appId` claim is the Application `_id` (UNCHANGED claim name — see contract
  // §5). `credentialId` is the specific ApplicationCredential `_id` that minted
  // this token, so downstream can attribute calls to a credential (e.g. for
  // post-rotation revocation).
  //
  // SCOPE AUTHORITY: the effective scopes are the credential's requested scopes
  // INTERSECTED with the application's granted scopes — a credential can never
  // exceed its app's authority (a privileged scope like federation:write only
  // survives if BOTH the credential AND the app hold it). A credential that
  // requested no scopes inherits the app's full granted set (unchanged
  // behaviour for credentials provisioned without explicit scopes).
  const appScopes = app.scopes ?? [];
  const scopes =
    credential.scopes.length > 0 ? intersectScopes(credential.scopes, appScopes) : appScopes;
  const token = jwt.sign(
    {
      type: 'service',
      appId: app._id.toString(),
      appName: app.name,
      credentialId: credential._id.toString(),
      scopes,
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: SERVICE_TOKEN_EXPIRY }
  );

  // Update lastUsedAt on the credential and the application.
  credential.lastUsedAt = new Date();
  await credential.save();
  app.lastUsedAt = new Date();
  await app.save();

  logger.info('[ServiceToken] Service token issued', {
    credentialId: credential._id.toString(),
    applicationId: app._id.toString(),
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
