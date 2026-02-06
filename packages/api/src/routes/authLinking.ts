/**
 * Auth Linking Routes
 *
 * Endpoints for linking multiple authentication methods to a single user account.
 * Allows users to:
 * - Link identity (publicKey) to existing password account
 * - Link password (email/password) to existing identity account
 * - Link social auth (Google, Apple, GitHub) to existing account
 * - View and manage linked auth methods
 */

import { Router, Response } from 'express';
import { hashPassword, validatePasswordStrength } from '../utils/password.js';
import { User } from '../models/User.js';
import type { AuthMethod } from '../models/User.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import SignatureService from '../services/signature.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { BadRequestError, ConflictError } from '../utils/error.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/auth/methods
 * Get all linked authentication methods for the current user
 */
router.get('/methods', asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new BadRequestError('User not authenticated');
  }

  const user = await User.findById(userId).select('authMethods publicKey email createdAt').lean();
  if (!user) {
    throw new BadRequestError('User not found');
  }

  // Build methods list from user data
  const methods: Array<{
    type: string;
    linkedAt: Date | null;
    identifier: string;
  }> = [];

  // Check for identity method
  if (user.publicKey) {
    const identityMethod = user.authMethods?.find(m => m.type === 'identity');
    methods.push({
      type: 'identity',
      linkedAt: identityMethod?.linkedAt || user.createdAt,
      identifier: user.publicKey.substring(0, 12) + '...',
    });
  }

  // Check for password method
  const hasPassword = await User.findById(userId).select('+password').lean().then(u => !!u?.password);
  if (hasPassword && user.email) {
    const passwordMethod = user.authMethods?.find(m => m.type === 'password');
    methods.push({
      type: 'password',
      linkedAt: passwordMethod?.linkedAt || user.createdAt,
      identifier: user.email,
    });
  }

  // Add any social methods from authMethods array
  const socialMethods = user.authMethods?.filter(m =>
    ['google', 'apple', 'github'].includes(m.type)
  ) || [];

  for (const method of socialMethods) {
    methods.push({
      type: method.type,
      linkedAt: method.linkedAt,
      identifier: method.metadata?.email || method.metadata?.providerId || 'linked',
    });
  }

  res.json({ methods });
}));

/**
 * POST /api/auth/link
 * Link a new authentication method to the current user account
 */
router.post('/link', asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new BadRequestError('User not authenticated');
  }

  const { type, publicKey, signature, timestamp, email, password, providerId } = req.body;

  // Validate type is a non-empty string to prevent NoSQL injection
  if (typeof type !== 'string' || !type.trim()) {
    throw new BadRequestError('Auth method type is required and must be a string');
  }
  const safeType = type.trim();

  const user = await User.findById(userId).select('+password');
  if (!user) {
    throw new BadRequestError('User not found');
  }

  switch (safeType) {
    case 'identity': {
      // Link identity (publicKey) to account
      if (!publicKey || !signature || !timestamp) {
        throw new BadRequestError('publicKey, signature, and timestamp are required for identity linking');
      }

      // Validate publicKey is a non-empty string to prevent NoSQL injection
      if (typeof publicKey !== 'string' || !publicKey.trim()) {
        throw new BadRequestError('publicKey must be a non-empty string');
      }
      const safePublicKey = publicKey.trim();

      // Check if publicKey is already used by another user
      const existingUser = await User.findOne({ publicKey: safePublicKey }).select('_id').lean();
      if (existingUser && existingUser._id.toString() !== userId.toString()) {
        throw new ConflictError('This identity is already linked to another account');
      }

      // Verify signature proves ownership of the private key
      const message = JSON.stringify({
        action: 'link_identity',
        userId: userId.toString(),
        timestamp,
      });

      const isValid = SignatureService.verifySignature(message, signature, safePublicKey);
      if (!isValid) {
        throw new BadRequestError('Invalid signature - cannot verify identity ownership');
      }

      // Check timestamp is recent (within 5 minutes) and not in the future
      const age = Date.now() - timestamp;
      if (age > 5 * 60 * 1000 || age < 0) {
        throw new BadRequestError('Signature expired or invalid timestamp - please try again');
      }

      // Link the identity
      user.publicKey = safePublicKey;

      // Add to authMethods array
      if (!user.authMethods) {
        user.authMethods = [];
      }
      const existingMethod = user.authMethods.find(m => m.type === 'identity');
      if (!existingMethod) {
        user.authMethods.push({
          type: 'identity',
          linkedAt: new Date(),
          metadata: { publicKey: safePublicKey },
        });
      }

      await user.save();
      res.json({ success: true, message: 'Identity linked successfully' });
      break;
    }

    case 'password': {
      // Link password auth to account
      if (!email || !password) {
        throw new BadRequestError('email and password are required for password linking');
      }

      // Validate email and password are strings to prevent NoSQL injection
      if (typeof email !== 'string' || typeof password !== 'string') {
        throw new BadRequestError('email and password must be strings');
      }
      const safeEmail = email.trim().toLowerCase();

      // Check if email is already used by another user
      const existingUser = await User.findOne({ email: safeEmail }).select('_id').lean();
      if (existingUser && existingUser._id.toString() !== userId.toString()) {
        throw new ConflictError('This email is already linked to another account');
      }

      // Validate password strength
      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        throw new BadRequestError(passwordValidation.errors[0] || 'Password does not meet security requirements');
      }

      // Hash password and update user
      const hashedPassword = await hashPassword(password);
      user.email = safeEmail;
      user.password = hashedPassword;

      // Add to authMethods array
      if (!user.authMethods) {
        user.authMethods = [];
      }
      const existingMethod = user.authMethods.find(m => m.type === 'password');
      if (!existingMethod) {
        user.authMethods.push({
          type: 'password',
          linkedAt: new Date(),
          metadata: { email: safeEmail },
        });
      }

      await user.save();
      res.json({ success: true, message: 'Password auth linked successfully' });
      break;
    }

    case 'google':
    case 'apple':
    case 'github': {
      // Link social auth to account
      if (!providerId) {
        throw new BadRequestError('providerId is required for social auth linking');
      }

      // Validate providerId is a non-empty string to prevent NoSQL injection
      if (typeof providerId !== 'string' || !providerId.trim()) {
        throw new BadRequestError('providerId must be a non-empty string');
      }
      const safeProviderId = providerId.trim();

      // Check if this social account is already linked to another user
      // Use literal type values instead of user-controlled type to prevent injection
      const existingUser = await User.findOne({
        'authMethods.type': safeType,
        'authMethods.metadata.providerId': safeProviderId,
      }).select('_id').lean();
      if (existingUser && existingUser._id.toString() !== userId.toString()) {
        throw new ConflictError(`This ${safeType} account is already linked to another user`);
      }

      // Add to authMethods array
      if (!user.authMethods) {
        user.authMethods = [];
      }
      const existingMethod = user.authMethods.find(
        m => m.type === safeType && m.metadata?.providerId === safeProviderId
      );
      if (!existingMethod) {
        user.authMethods.push({
          type: safeType as AuthMethod['type'],
          linkedAt: new Date(),
          metadata: {
            providerId: safeProviderId,
            email: typeof email === 'string' ? email.trim() : undefined,
          },
        });
      }

      await user.save();
      res.json({ success: true, message: `${safeType} auth linked successfully` });
      break;
    }

    default:
      throw new BadRequestError(`Unknown auth method type: ${safeType}`);
  }
}));

/**
 * DELETE /api/auth/link/:type
 * Unlink an authentication method from the current user account
 * Must keep at least one auth method
 */
router.delete('/link/:type', asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new BadRequestError('User not authenticated');
  }

  const { type } = req.params;
  const validTypes = ['identity', 'password', 'google', 'apple', 'github'];
  if (!validTypes.includes(type)) {
    throw new BadRequestError(`Invalid auth method type: ${type}`);
  }

  const user = await User.findById(userId).select('+password');
  if (!user) {
    throw new BadRequestError('User not found');
  }

  // Count current auth methods
  let methodCount = 0;
  if (user.publicKey) methodCount++;
  if (user.password) methodCount++;
  const socialMethods = user.authMethods?.filter(m =>
    ['google', 'apple', 'github'].includes(m.type)
  ) || [];
  methodCount += socialMethods.length;

  if (methodCount <= 1) {
    throw new BadRequestError('Cannot unlink last authentication method - account would become inaccessible');
  }

  switch (type) {
    case 'identity':
      if (!user.publicKey) {
        throw new BadRequestError('No identity is linked to this account');
      }
      user.publicKey = undefined;
      user.authMethods = user.authMethods?.filter(m => m.type !== 'identity');
      break;

    case 'password':
      if (!user.password) {
        throw new BadRequestError('No password is set for this account');
      }
      user.password = undefined;
      user.authMethods = user.authMethods?.filter(m => m.type !== 'password');
      // Keep email for contact purposes but remove auth capability
      break;

    case 'google':
    case 'apple':
    case 'github':
      const methodIndex = user.authMethods?.findIndex(m => m.type === type);
      if (methodIndex === undefined || methodIndex === -1) {
        throw new BadRequestError(`No ${type} account is linked`);
      }
      user.authMethods?.splice(methodIndex, 1);
      break;
  }

  await user.save();
  res.json({ success: true, message: `${type} auth unlinked successfully` });
}));

export default router;
