/**
 * Auth Linking Routes
 *
 * Endpoints for linking multiple authentication methods to a single user account.
 * Allows users to:
 * - Link an identity (publicKey) to an existing account
 * - View and manage linked auth methods
 * - Unlink an identity or an individual passkey (webauthn)
 */

import { Router, type Response } from 'express';
import { User, buildAuthMethod } from '../models/User.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import SignatureService from '../services/signature.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { BadRequestError, ConflictError } from '../utils/error.js';
import { validate } from '../middleware/validate.js';
import { linkAuthMethodSchema, unlinkTypeParams, unlinkWebauthnParams } from '../schemas/authLinking.schemas.js';
import WebauthnCredential from '../models/WebauthnCredential.js';
import userCache from '../utils/userCache.js';
import { buildUserDid } from '../services/did.service.js';
import { buildAuthMethodEntries } from '../utils/authMethodEntries.js';
import { authMethodsResponseSchema } from '@oxyhq/contracts';

const router = Router();

/**
 * Count the account's distinct authentication methods: the identity key AND
 * each registered passkey. Used by the unlink guards to keep every account with
 * at least ONE usable auth method (removing the last would lock the user out).
 */
function countAuthMethods(user: {
  publicKey?: string | null;
  authMethods?: Array<{ type: string }> | null;
}): number {
  let count = 0;
  if (user.publicKey) count++;
  const methods = user.authMethods ?? [];
  count += methods.filter((m) => m.type === 'webauthn').length;
  return count;
}

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/auth/methods
 * Get the account DID and all linked authentication methods for the current
 * user, shaped to the `authMethodsResponseSchema` contract. Identity methods
 * carry their DID verification-method id (`#key-1`); passkeys carry none.
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

  const methods = buildAuthMethodEntries({
    publicKey: user.publicKey,
    authMethods: user.authMethods,
    createdAt: user.createdAt,
  });

  const response = authMethodsResponseSchema.parse({
    did: buildUserDid(userId.toString()),
    methods,
  });

  res.json(response);
}));

/**
 * POST /api/auth/link
 * Link an identity (publicKey) to the current user account.
 */
router.post('/link', validate({ body: linkAuthMethodSchema }), asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new BadRequestError('User not authenticated');
  }

  const { type, publicKey, signature, timestamp } = req.body;

  // Validate type is a non-empty string to prevent NoSQL injection
  if (typeof type !== 'string' || !type.trim()) {
    throw new BadRequestError('Auth method type is required and must be a string');
  }
  const safeType = type.trim();

  const user = await User.findById(userId);
  if (!user) {
    throw new BadRequestError('User not found');
  }

  if (safeType !== 'identity') {
    throw new BadRequestError(`Unknown auth method type: ${safeType}`);
  }

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
    user.authMethods.push(buildAuthMethod('identity', { publicKey: safePublicKey }));
  }

  await user.save();
  userCache.invalidate(userId.toString());
  res.json({ success: true, message: 'Identity linked successfully' });
}));

/**
 * DELETE /api/auth/link/webauthn/:credentialID
 * Unlink ONE passkey (by its public credential id) from the current account.
 * Passkeys are per-credential, so this needs the specific id rather than the
 * generic per-type unlink. Removes the `authMethods[]` row AND the
 * WebauthnCredential document, keeping at least one usable auth method overall.
 *
 * Registered BEFORE `DELETE /link/:type` so the two-segment webauthn path is not
 * shadowed by the single-segment `:type` route.
 */
router.delete('/link/webauthn/:credentialID', validate({ params: unlinkWebauthnParams }), asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new BadRequestError('User not authenticated');
  }

  const { credentialID } = req.params;

  const user = await User.findById(userId);
  if (!user) {
    throw new BadRequestError('User not found');
  }

  // The passkey must belong to the caller (its public id alone is not proof of
  // ownership — scope the lookup by userId).
  const credential = await WebauthnCredential.findOne({ credentialID, userId });
  if (!credential) {
    throw new BadRequestError('No such passkey is linked to this account');
  }

  // Removing the last remaining auth method would lock the account out.
  if (countAuthMethods(user) <= 1) {
    throw new BadRequestError('Cannot unlink last authentication method - account would become inaccessible');
  }

  user.authMethods = user.authMethods?.filter(
    (m) => !(m.type === 'webauthn' && m.metadata?.credentialID === credentialID)
  );
  await user.save();
  await WebauthnCredential.deleteOne({ _id: credential._id });
  userCache.invalidate(userId.toString());

  res.json({ success: true, message: 'Passkey unlinked successfully' });
}));

/**
 * DELETE /api/auth/link/:type
 * Unlink an authentication method from the current user account.
 * Must keep at least one auth method. Only `identity` is unlinkable by type —
 * passkeys are per-credential (see the webauthn route above).
 */
router.delete('/link/:type', validate({ params: unlinkTypeParams }), asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new BadRequestError('User not authenticated');
  }

  const { type } = req.params;
  if (type !== 'identity') {
    throw new BadRequestError(`Invalid auth method type: ${type}`);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new BadRequestError('User not found');
  }

  // Count current auth methods
  const methodCount = countAuthMethods(user);

  if (methodCount <= 1) {
    throw new BadRequestError('Cannot unlink last authentication method - account would become inaccessible');
  }

  if (!user.publicKey) {
    throw new BadRequestError('No identity is linked to this account');
  }
  user.publicKey = undefined;
  user.authMethods = user.authMethods?.filter(m => m.type !== 'identity');

  await user.save();
  userCache.invalidate(userId.toString());
  res.json({ success: true, message: `${type} auth unlinked successfully` });
}));

export default router;
