/**
 * Auth Linking Routes
 *
 * Endpoints for linking multiple authentication methods to a single user account.
 * Allows users to:
 * - Link an identity (publicKey) to an existing account
 * - View and manage linked auth methods
 * - Unlink an identity or an individual passkey (webauthn)
 */

import { Router, type Request, type Response } from 'express';
import { User, buildAuthMethod } from '../models/User.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import SignatureService from '../services/signature.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { BadRequestError, ConflictError, UnauthorizedError } from '../utils/error.js';
import { validate } from '../middleware/validate.js';
import { linkAuthMethodSchema, unlinkTypeParams, unlinkWebauthnParams } from '../schemas/authLinking.schemas.js';
import WebauthnCredential from '../models/WebauthnCredential.js';
import AuthChallenge from '../models/AuthChallenge.js';
import Session from '../models/Session.js';
import sessionService from '../services/session.service.js';
import { rateLimit } from '../middleware/rateLimiter.js';
import { hashedIpKey } from '../utils/ipKey.js';
import { extractTokenFromRequest, decodeToken } from '../middleware/authUtils.js';
import userCache from '../utils/userCache.js';
import { buildUserDid } from '../services/did.service.js';
import { buildAuthMethodEntries } from '../utils/authMethodEntries.js';
import {
  authMethodsResponseSchema,
  rotateKeyChallengeResponseSchema,
  rotateKeyCompleteRequestSchema,
  rotateKeyCompleteResponseSchema,
  type RotateKeyCompleteRequest,
} from '@oxyhq/contracts';

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

/** Rotation-challenge time-to-live (5 minutes), matching the signin challenge. */
const ROTATE_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Max age accepted for the client rotation signature (5 minutes). */
const ROTATE_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/** Per-authenticated-user rate-limit key (falls back to a hashed IP pre-auth). */
function rotateKey(scope: string) {
  return (req: Request): string => {
    const userId = (req as AuthRequest).user?._id?.toString();
    return userId ? `${scope}:${userId}` : `${scope}:ip:${hashedIpKey(req)}`;
  };
}

const rotateChallengeLimiter = rateLimit({
  prefix: 'rl:identity:rotate:challenge:',
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many key-rotation requests. Please try again later.',
  keyGenerator: rotateKey('identity:rotate:challenge'),
});

const rotateCompleteLimiter = rateLimit({
  prefix: 'rl:identity:rotate:complete:',
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many key-rotation attempts. Please try again later.',
  keyGenerator: rotateKey('identity:rotate:complete'),
});

/**
 * Revoke every OTHER active session for the account, keeping the session that
 * made this request signed in (mirrors the "logout all sessions" controller).
 * Pushes a `sessions_removed` event so connected clients drop immediately.
 *
 * `emitSessionUpdate` is loaded DYNAMICALLY to avoid a load-time import cycle
 * with `server.ts` (which imports this router).
 */
async function revokeOtherSessions(req: Request, userId: string): Promise<void> {
  const token = extractTokenFromRequest(req);
  const currentSessionId = token ? decodeToken(token)?.sessionId : undefined;

  const filter: Record<string, unknown> = { userId, isActive: true, expiresAt: { $gt: new Date() } };
  if (currentSessionId) filter.sessionId = { $ne: currentSessionId };

  const others = await Session.find(filter).select('sessionId').lean();
  const sessionIds = others.map((s) => s.sessionId);

  await sessionService.deactivateAllUserSessions(userId, currentSessionId);

  if (sessionIds.length > 0) {
    const { emitSessionUpdate } = await import('../server.js');
    emitSessionUpdate(userId, { type: 'sessions_removed', sessionIds });
  }
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
 * POST /api/auth/rotate/challenge
 * Mint a single-use `rotate_key` challenge for the current account. The client
 * signs it with its CURRENT key to prove control before the swap.
 *
 * The challenge is bound to the account's current `publicKey` and carries
 * `purpose: 'rotate_key'`, so a signin challenge (default purpose) can never be
 * spent here and vice-versa.
 */
router.post('/rotate/challenge', rotateChallengeLimiter, asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new BadRequestError('User not authenticated');
  }

  const oldPublicKey = req.user?.publicKey;
  if (!oldPublicKey) {
    throw new BadRequestError('No identity key is linked to this account — nothing to rotate.');
  }

  const challenge = SignatureService.generateChallenge();
  const expiresAt = new Date(Date.now() + ROTATE_CHALLENGE_TTL_MS);

  await AuthChallenge.create({
    publicKey: oldPublicKey,
    challenge,
    purpose: 'rotate_key',
    expiresAt,
    used: false,
  });

  const response = rotateKeyChallengeResponseSchema.parse({
    challenge,
    expiresAt: expiresAt.toISOString(),
  });
  res.json(response);
}));

/**
 * POST /api/auth/rotate/complete
 * Atomically REPLACE the account's identity key with `newPublicKey`.
 *
 * Rotation is a single atomic swap — never a remove-then-add — so it never
 * passes through a zero-auth-method state and is independent of the unlink
 * guards. Because control of the CURRENT key is proven (from SecureStore OR a
 * recovery-phrase re-derivation), even the LAST remaining credential can be
 * replaced.
 *
 * Security invariants:
 *  - `oldPublicKey` is ALWAYS derived from the authenticated user doc, NEVER
 *    from the request (prevents proving control of key X but rotating key Y).
 *  - control of the CURRENT key is proven (`signature`) AND possession of the
 *    NEW key is proven (`newKeyProof`) — the latter stops an attacker rotating
 *    their account to a re-encoding of a key they do not control.
 *  - the incoming key is canonicalized (uncompressed, lowercased) before the
 *    uniqueness check and the write, so two encodings of the same point cannot
 *    coexist across accounts.
 *  - the `rotate_key` challenge is burned ATOMICALLY (single-use); the timestamp
 *    is checked BEFORE the burn so a stale request cannot self-burn a challenge.
 *  - the array length of `authMethods` is never changed (the single identity
 *    entry is replaced in place), so `countAuthMethods()` is never 0.
 */
router.post('/rotate/complete', rotateCompleteLimiter, validate({ body: rotateKeyCompleteRequestSchema }), asyncHandler(async (req: AuthRequest, res: Response) => {
  const userIdObj = req.user?._id;
  if (!userIdObj) {
    throw new BadRequestError('User not authenticated');
  }
  const userId = userIdObj.toString();

  const { newPublicKey, challenge, signature, newKeyProof, timestamp, signOutEverywhere } = req.body as RotateKeyCompleteRequest;
  const safeNewPublicKey = newPublicKey.trim();

  // Load the authoritative user document (for the write AND the server-derived
  // old key).
  const user = await User.findById(userIdObj);
  if (!user) {
    throw new BadRequestError('User not found');
  }

  // 1. oldPublicKey is derived from the USER DOC — never client-supplied.
  const oldPublicKey = user.publicKey;
  if (!oldPublicKey) {
    throw new BadRequestError('No identity key is linked to this account — nothing to rotate.');
  }

  // Structural guards on the incoming new key.
  if (!SignatureService.isValidPublicKey(safeNewPublicKey)) {
    throw new BadRequestError('newPublicKey is not a valid public key');
  }

  // Canonicalize BOTH keys (uncompressed, lowercased). The differ-check, the
  // uniqueness query, and the write all operate on the canonical form so a
  // re-encoded (compressed / re-cased) duplicate can never slip past them.
  const canonicalNewPublicKey = SignatureService.canonicalizePublicKey(safeNewPublicKey);
  const canonicalOldPublicKey = SignatureService.canonicalizePublicKey(oldPublicKey);
  if (canonicalNewPublicKey === canonicalOldPublicKey) {
    throw new BadRequestError('newPublicKey must differ from the current identity key');
  }

  // 2. Timestamp freshness (recent, not in the future) — BEFORE the burn, so a
  //    stale-but-otherwise-valid request cannot consume its own challenge.
  const age = Date.now() - timestamp;
  if (age > ROTATE_SIGNATURE_MAX_AGE_MS || age < 0) {
    throw new BadRequestError('Signature expired or invalid timestamp — please try again');
  }

  // 3. Atomically burn the rotate_key challenge (single-use, purpose-scoped,
  //    bound to the account's CURRENT key). If nothing matches, the challenge
  //    was never minted for rotation, was for a different key, is expired, or
  //    was already consumed — reject in every case.
  const burned = await AuthChallenge.findOneAndUpdate(
    { challenge, publicKey: oldPublicKey, used: false, purpose: 'rotate_key', expiresAt: { $gt: new Date() } },
    { $set: { used: true } },
    { new: false },
  );
  if (!burned) {
    throw new UnauthorizedError('Invalid or expired rotation challenge');
  }

  // 4. Verify the client signature proves control of the CURRENT key. The signed
  //    bytes MUST match this reconstruction exactly (same key order).
  const message = JSON.stringify({
    action: 'rotate_key',
    userId,
    oldPublicKey,
    newPublicKey: safeNewPublicKey,
    challenge,
    timestamp,
  });
  if (!SignatureService.verifySignature(message, signature, oldPublicKey)) {
    throw new BadRequestError('Invalid signature — cannot verify control of the current key');
  }

  // 5. Verify proof-of-possession of the NEW key. Without this, an attacker
  //    could rotate their OWN account to a re-encoding of a victim's key (read
  //    from the public DID) — passing the uniqueness check but never controlling
  //    the private key. Requiring the new key to sign closes that.
  const newKeyMessage = JSON.stringify({
    action: 'rotate_key_new',
    userId,
    newPublicKey: safeNewPublicKey,
    challenge,
    timestamp,
  });
  if (!SignatureService.verifySignature(newKeyMessage, newKeyProof, safeNewPublicKey)) {
    throw new BadRequestError('Invalid new-key proof — cannot verify possession of the new key');
  }

  // 6. Reject if the (canonical) new key already belongs to another account.
  const conflict = await User.findOne({ publicKey: canonicalNewPublicKey }).select('_id').lean();
  if (conflict && conflict._id.toString() !== userId) {
    throw new ConflictError('This identity is already linked to another account');
  }

  // 7. ATOMIC REPLACE: swap `publicKey` AND replace the single identity
  //    `authMethods` entry in place, storing the CANONICAL key. The array length
  //    is never changed, so the account never passes through
  //    `countAuthMethods() === 0`. `user.save()` persists both fields in one
  //    document update.
  const methods = user.authMethods ?? [];
  const hasIdentity = methods.some((m) => m.type === 'identity');
  user.authMethods = hasIdentity
    ? methods.map((m) =>
        m.type === 'identity'
          ? buildAuthMethod('identity', { ...m.metadata, publicKey: canonicalNewPublicKey })
          : m,
      )
    : [...methods, buildAuthMethod('identity', { publicKey: canonicalNewPublicKey })];
  user.publicKey = canonicalNewPublicKey;
  await user.save();
  userCache.invalidate(userId);

  // 8. Optional: revoke every OTHER session (the rotating device stays signed
  //    in) when the caller suspects the old key is compromised.
  if (signOutEverywhere) {
    await revokeOtherSessions(req, userId);
  }

  const response = rotateKeyCompleteResponseSchema.parse({
    success: true,
    publicKey: canonicalNewPublicKey,
    message: 'Identity key rotated successfully',
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
