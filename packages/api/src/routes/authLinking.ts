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

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { User, AuthMethod } from '../models/User';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import SignatureService from '../services/signature.service';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, ConflictError } from '../utils/error';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/auth/methods
 * Get all linked authentication methods for the current user
 */
router.get('/methods', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new BadRequestError('User not authenticated');
  }

  const user = await User.findById(userId).select('authMethods publicKey email');
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
  const hasPassword = await User.findById(userId).select('+password').then(u => !!u?.password);
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
router.post('/link', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new BadRequestError('User not authenticated');
  }

  const { type, publicKey, signature, timestamp, email, password, providerId, providerToken } = req.body;

  if (!type) {
    throw new BadRequestError('Auth method type is required');
  }

  const user = await User.findById(userId).select('+password');
  if (!user) {
    throw new BadRequestError('User not found');
  }

  switch (type) {
    case 'identity': {
      // Link identity (publicKey) to account
      if (!publicKey || !signature || !timestamp) {
        throw new BadRequestError('publicKey, signature, and timestamp are required for identity linking');
      }

      // Check if publicKey is already used by another user
      const existingUser = await User.findOne({ publicKey });
      if (existingUser && existingUser._id.toString() !== userId.toString()) {
        throw new ConflictError('This identity is already linked to another account');
      }

      // Verify signature proves ownership of the private key
      const message = JSON.stringify({
        action: 'link_identity',
        userId: userId.toString(),
        timestamp,
      });

      const isValid = SignatureService.verifySignature(publicKey, message, signature);
      if (!isValid) {
        throw new BadRequestError('Invalid signature - cannot verify identity ownership');
      }

      // Check timestamp is recent (within 5 minutes)
      const age = Date.now() - timestamp;
      if (age > 5 * 60 * 1000) {
        throw new BadRequestError('Signature expired - please try again');
      }

      // Link the identity
      user.publicKey = publicKey;

      // Add to authMethods array
      if (!user.authMethods) {
        user.authMethods = [];
      }
      const existingMethod = user.authMethods.find(m => m.type === 'identity');
      if (!existingMethod) {
        user.authMethods.push({
          type: 'identity',
          linkedAt: new Date(),
          metadata: { publicKey },
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

      // Check if email is already used by another user
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser && existingUser._id.toString() !== userId.toString()) {
        throw new ConflictError('This email is already linked to another account');
      }

      // Validate password strength
      if (password.length < 8) {
        throw new BadRequestError('Password must be at least 8 characters');
      }

      // Hash password and update user
      const hashedPassword = await bcrypt.hash(password, 10);
      user.email = email.toLowerCase();
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
          metadata: { email: email.toLowerCase() },
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

      // Check if this social account is already linked to another user
      const existingUser = await User.findOne({
        'authMethods.type': type,
        'authMethods.metadata.providerId': providerId,
      });
      if (existingUser && existingUser._id.toString() !== userId.toString()) {
        throw new ConflictError(`This ${type} account is already linked to another user`);
      }

      // Add to authMethods array
      if (!user.authMethods) {
        user.authMethods = [];
      }
      const existingMethod = user.authMethods.find(
        m => m.type === type && m.metadata?.providerId === providerId
      );
      if (!existingMethod) {
        user.authMethods.push({
          type: type as AuthMethod['type'],
          linkedAt: new Date(),
          metadata: {
            providerId,
            email: email || undefined,
          },
        });
      }

      await user.save();
      res.json({ success: true, message: `${type} auth linked successfully` });
      break;
    }

    default:
      throw new BadRequestError(`Unknown auth method type: ${type}`);
  }
}));

/**
 * DELETE /api/auth/link/:type
 * Unlink an authentication method from the current user account
 * Must keep at least one auth method
 */
router.delete('/link/:type', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
