/**
 * Authentication Routes
 * 
 * RESTful API routes for authentication operations.
 * Uses asyncHandler for consistent error handling.
 */

import express from 'express';
import { SessionController } from '../controllers/session.controller';
import { User } from '../models/User';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler, sendSuccess } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError } from '../utils/error';
import { logger } from '../utils/logger';

const router = express.Router();

// Auth routes that map to session controller methods
router.post('/signup', SessionController.register);
// Back-compat alias
router.post('/register', SessionController.register);
// Limit login attempts per IP to reduce brute-force
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });
router.post('/login', loginLimiter, SessionController.signIn);
router.post('/totp/verify-login', SessionController.verifyTotpForLogin);

// Account recovery endpoints with tighter rate limits per IP+identifier
const recoverLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.ip}:${(req.body?.identifier || '').toString()}`,
});
router.post('/recover/request', recoverLimiter, SessionController.requestRecovery);
router.post('/recover/verify', recoverLimiter, SessionController.verifyRecoveryCode);
router.post('/recover/reset', recoverLimiter, SessionController.resetPassword);
router.post('/recover/totp/reset', recoverLimiter, SessionController.resetPasswordWithTotp);
router.post('/recover/backup/reset', recoverLimiter, SessionController.resetPasswordWithBackupCode);
router.post('/recover/recovery-key/reset', recoverLimiter, SessionController.resetPasswordWithRecoveryKey);

// TOTP enrollment (requires session via x-session-id)
router.post('/totp/enroll/start', SessionController.startTotpEnrollment);
router.post('/totp/enroll/verify', SessionController.verifyTotpEnrollment);
router.post('/totp/disable', SessionController.disableTotp);

// Auth validation endpoint
router.get('/validate', asyncHandler(async (req, res) => {
  // This endpoint is used by the frontend to validate auth status
  // It should check if the user is authenticated via the auth middleware
  sendSuccess(res, { valid: true });
}));

/**
 * GET /auth/check-username/:username
 * 
 * Check if username is available
 * 
 * @param {string} username - Username to check
 * @returns {object} Availability status
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

  // Validate username format (alphanumeric only)
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
 * 
 * Check if email is available
 * 
 * @param {string} email - Email to check
 * @returns {object} Availability status
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

export default router; 
 
