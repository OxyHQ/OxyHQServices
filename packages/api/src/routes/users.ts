/**
 * User Routes
 * 
 * RESTful API routes for user management, following enterprise-grade patterns:
 * - Separation of concerns (routes -> service -> model)
 * - Consistent error handling
 * - Standardized response formats
 * - Comprehensive validation
 * - Proper logging
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import User from '../models/User';
import { authMiddleware, serviceAuthMiddleware, type ServiceAuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { asyncHandler, sendSuccess, sendPaginated } from '../utils/asyncHandler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
} from '../utils/error';
import { userService } from '../services/user.service';
import { UsersController } from '../controllers/users.controller';
import { resolveUserIdToObjectId } from '../utils/validation';
import userCache from '../utils/userCache';
import SignatureService from '../services/signature.service';
import { emailService } from '../services/email.service';
import { validate } from '../middleware/validate';
import {
  searchUsersBodySchema,
  verifyRequestSchema,
  deleteAccountSchema,
  dataExportQuerySchema,
  updatePrivacyBodySchema,
} from '../schemas/users.schemas';

// Types
interface AuthRequest extends Request {
  user?: {
    id: string;
  };
}

interface PaginationQuery {
  limit?: string;
  offset?: string;
}

import { PAGINATION } from '../utils/constants';
import { federationService } from '../services/federation.service';

// Initialize router and controller
const router = Router();
const usersController = new UsersController();

// ============================================================================
// Middleware
// ============================================================================

/**
 * Resolves userId parameter (ObjectId or publicKey) to MongoDB ObjectId
 * Accepts both ObjectId strings and publicKey strings
 * Stores the resolved ObjectId back in req.params.userId
 */
const resolveUserId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'User ID is required',
      });
      return;
    }

    // Resolve userId (ObjectId or publicKey) to ObjectId
    const resolvedObjectId = await resolveUserIdToObjectId(userId);
    
    // Store the resolved ObjectId back in params for route handlers
    req.params.userId = resolvedObjectId;
    
    next();
  } catch (error) {
    if (error instanceof BadRequestError) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: error.message,
      });
      return;
    }
    if (error instanceof NotFoundError) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: error.message,
      });
      return;
    }
    logger.error('Error resolving user ID', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Error resolving user ID',
    });
  }
};

/**
 * Validates pagination query parameters
 */
const validatePagination = (req: Request, res: Response, next: NextFunction): void => {
  const query = req.query as PaginationQuery;
  const limit = query.limit ? parseInt(query.limit, 10) : undefined;
  const offset = query.offset ? parseInt(query.offset, 10) : undefined;

  if (limit !== undefined && (isNaN(limit) || limit < 0)) {
    res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'Invalid limit parameter',
    });
    return;
  }

  if (offset !== undefined && (isNaN(offset) || offset < 0)) {
    res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'Invalid offset parameter',
    });
    return;
  }

  next();
};

/**
 * Ensures authenticated user owns the resource or is authorized
 * Note: This middleware should be used after resolveUserId, so req.params.userId is already an ObjectId
 * We need to resolve req.user.id (which might be a publicKey) to ObjectId for comparison
 */
const requireOwnership = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.params.userId; // Already resolved to ObjectId by resolveUserId middleware
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    // Resolve current user's ID to ObjectId for comparison (it might be a publicKey)
    const currentUserObjectId = await resolveUserIdToObjectId(currentUserId);

    if (userId !== currentUserObjectId) {
      throw new ForbiddenError('Not authorized to access this resource');
    }

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      throw error;
    }
    logger.error('Error in requireOwnership middleware', error instanceof Error ? error : new Error(String(error)));
    throw new ForbiddenError('Error validating ownership');
  }
};

// ============================================================================
// Routes
// ============================================================================

/**
 * @openapi
 * /users/me:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get the current authenticated user
 *     description: >
 *       Returns the full profile for the bearer-token holder, including
 *       privacy settings, identity flags, and connected account types. This
 *       is the canonical "who am I" endpoint that every Oxy app calls on
 *       startup.
 *     responses:
 *       200:
 *         description: Current user profile.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *             examples:
 *               success:
 *                 value:
 *                   id: 64f7c2a1b8e9d3f4a1c2b3d4
 *                   username: alice
 *                   name:
 *                     first: Alice
 *                     last: Example
 *                   description: Coffee, code, and open source.
 *                   type: local
 *                   _count:
 *                     followers: 42
 *                     following: 17
 *                   createdAt: '2024-01-15T12:34:56.789Z'
 *                   updatedAt: '2025-05-12T09:00:00.000Z'
 *       401:
 *         description: Missing or invalid bearer token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const user = await userService.getCurrentUser(req.user.id);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    logger.debug('GET /users/me', { userId: req.user.id });
    sendSuccess(res, user);
  })
);

/**
 * @openapi
 * /users/me:
 *   put:
 *     tags:
 *       - Users
 *     summary: Update the current authenticated user
 *     description: >
 *       Partial profile update for the authenticated user. Only fields
 *       supplied in the body are touched — missing fields keep their existing
 *       values. The server enforces uniqueness on `email` and `username`;
 *       conflicts return 409. Always invalidates the in-memory user cache so
 *       the next read returns the updated record.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 30
 *                 pattern: '^[a-zA-Z0-9]{3,30}$'
 *                 example: alice
 *               email:
 *                 type: string
 *                 format: email
 *                 example: alice@placeholder.example
 *               name:
 *                 type: object
 *                 properties:
 *                   first:
 *                     type: string
 *                     example: Alice
 *                   last:
 *                     type: string
 *                     example: Example
 *               description:
 *                 type: string
 *                 example: Updated bio.
 *               avatar:
 *                 type: string
 *                 description: Asset ID or absolute URL.
 *                 example: 64f7c2a1b8e9d3f4a1c2b3d4
 *           examples:
 *             rename:
 *               summary: Update the display name
 *               value:
 *                 name:
 *                   first: Alice
 *                   last: Example
 *     responses:
 *       200:
 *         description: Updated user profile.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation failed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Missing or invalid bearer token.
 *       409:
 *         description: Email or username conflict.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put(
  '/me',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required');
    }

    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
      throw new BadRequestError('Invalid request body');
    }

    logger.debug('PUT /users/me', {
      userId: req.user.id,
      updateFields: Object.keys(req.body),
    });

    try {
      const updatedUser = await userService.updateUserProfile(
        req.user.id,
        req.body,
        req
      );

      logger.info('User profile updated', {
        userId: req.user.id,
        updatedFields: Object.keys(req.body),
      });

      sendSuccess(res, updatedUser);
    } catch (error) {
      // Handle known errors from service layer
      if (error instanceof Error) {
        if (error.message === 'Email already exists') {
          throw new ConflictError('Email already exists', {
            field: 'email',
            value: req.body.email,
          });
        }
        if (error.message === 'Username already exists') {
          throw new ConflictError('Username already exists', {
            field: 'username',
            value: req.body.username,
          });
        }
        if (error.message === 'User not found') {
          throw new NotFoundError('User not found');
        }
      }
      throw error;
    }
  })
);

/**
 * GET /users/:userId
 * 
 * Get user profile by ID
 * 
 * @param {string} userId - User ID
 * @returns {User} User profile with statistics
 */
router.get(
  '/:userId',
  resolveUserId,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    const user = await userService.getUserById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Get user statistics
    const stats = await userService.getUserStats(userId);

    // Format response with stats
    const response = userService.formatUserResponse(user, stats);

    logger.debug('GET /users/:userId', { userId });
    sendSuccess(res, response);
  })
);

/**
 * GET /users/:userId/followers
 * 
 * Get user's followers with pagination
 * 
 * @param {string} userId - User ID
 * @query {number} limit - Number of results (max 100, default 50)
 * @query {number} offset - Pagination offset (default 0)
 * @returns {PaginatedResponse<UserProfile>} Paginated list of followers
 */
router.get(
  '/:userId/followers',
  resolveUserId,
  validatePagination,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { limit, offset } = req.query as PaginationQuery;

    const parsedLimit = limit
      ? Math.min(parseInt(limit, 10), PAGINATION.MAX_LIMIT)
      : PAGINATION.DEFAULT_LIMIT;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    const result = await userService.getUserFollowers(userId, {
      limit: parsedLimit,
      offset: parsedOffset,
    });

    logger.debug('GET /users/:userId/followers', {
      userId,
      limit: parsedLimit,
      offset: parsedOffset,
      total: result.total,
    });

    sendPaginated(res, result.data, result.total, result.limit, result.offset);
  })
);

/**
 * GET /users/:userId/following
 * 
 * Get users that this user is following with pagination
 * 
 * @param {string} userId - User ID
 * @query {number} limit - Number of results (max 100, default 50)
 * @query {number} offset - Pagination offset (default 0)
 * @returns {PaginatedResponse<UserProfile>} Paginated list of following
 */
router.get(
  '/:userId/following',
  resolveUserId,
  validatePagination,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { limit, offset } = req.query as PaginationQuery;

    const parsedLimit = limit
      ? Math.min(parseInt(limit, 10), PAGINATION.MAX_LIMIT)
      : PAGINATION.DEFAULT_LIMIT;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    const result = await userService.getUserFollowing(userId, {
      limit: parsedLimit,
      offset: parsedOffset,
    });

    logger.debug('GET /users/:userId/following', {
      userId,
      limit: parsedLimit,
      offset: parsedOffset,
      total: result.total,
    });

    sendPaginated(res, result.data, result.total, result.limit, result.offset);
  })
);

/**
 * GET /users/:userId/follow-status
 * 
 * Check if current user is following target user
 * 
 * @param {string} userId - Target user ID
 * @returns {boolean} Following status
 */
router.get(
  '/:userId/follow-status',
  authMiddleware,
  resolveUserId,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId: targetUserId } = req.params;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const isFollowing = await userService.isFollowing(currentUserId, targetUserId);

    logger.debug('GET /users/:userId/follow-status', {
      currentUserId,
      targetUserId,
      isFollowing,
    });

    sendSuccess(res, { isFollowing });
  })
);

/**
 * POST /users/:userId/follow
 * 
 * Toggle follow relationship (follow if not following, unfollow if following)
 * 
 * @param {string} userId - Target user ID to follow/unfollow
 * @returns {object} Action result with updated counts
 */
router.post(
  '/:userId/follow',
  authMiddleware,
  resolveUserId,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId: targetUserId } = req.params;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    try {
      const result = await userService.toggleFollow(currentUserId, targetUserId);

      logger.info('User follow toggled', {
        currentUserId,
        targetUserId,
        action: result.action,
      });

      sendSuccess(res, {
        message: `Successfully ${result.action === 'follow' ? 'followed' : 'unfollowed'} user`,
        action: result.action,
        counts: result.counts,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Cannot follow yourself') {
          throw new BadRequestError('Cannot follow yourself');
        }
        if (error.message === 'User not found') {
          throw new NotFoundError('User not found');
        }
      }
      throw error;
    }
  })
);

/**
 * DELETE /users/:userId/follow
 * 
 * Unfollow a user
 * 
 * @param {string} userId - Target user ID to unfollow
 * @returns {object} Action result with updated counts
 */
router.delete(
  '/:userId/follow',
  authMiddleware,
  resolveUserId,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId: targetUserId } = req.params;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    // Check if currently following
    const isFollowing = await userService.isFollowing(currentUserId, targetUserId);

    if (!isFollowing) {
      throw new BadRequestError('Not following this user');
    }

    // Toggle will unfollow since we know they're following
    const result = await userService.toggleFollow(currentUserId, targetUserId);

    logger.info('User unfollowed', {
      currentUserId,
      targetUserId,
    });

    sendSuccess(res, {
      message: 'Successfully unfollowed user',
      action: result.action,
      counts: result.counts,
    });
  })
);

/**
 * PUT /users/:userId/privacy
 * 
 * Update user privacy settings (requires ownership)
 * 
 * @param {string} userId - User ID
 * @body {object} privacySettings - Privacy settings object
 * @returns {User} Updated user object
 */
router.put(
  '/:userId/privacy',
  authMiddleware,
  resolveUserId,
  requireOwnership,
  validate({ body: updatePrivacyBodySchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;

    if (!req.body?.privacySettings || typeof req.body.privacySettings !== 'object') {
      throw new BadRequestError('Invalid privacy settings');
    }

    const user = await userService.getUserById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Merge only the provided fields into privacySettings using dot-path
    // updates. Using `{ $set: { privacySettings: ... } }` would replace the
    // whole subdocument and wipe any fields the client did not include.
    const incoming = req.body.privacySettings as Record<string, unknown>;
    const setOps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(incoming)) {
      setOps[`privacySettings.${key}`] = value;
    }

    // Update privacy settings
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      Object.keys(setOps).length > 0 ? { $set: setOps } : {},
      { new: true, runValidators: true }
    )
      .select('-password -refreshToken')
      .lean({ virtuals: true });

    if (!updatedUser) {
      throw new NotFoundError('User not found');
    }

    // Bust the in-memory user cache so subsequent session-bound lookups
    // return the fresh privacy state instead of the stale pre-write doc.
    userCache.invalidate(userId);

    logger.info('User privacy settings updated', { userId });

    sendSuccess(res, updatedUser);
  })
);

/**
 * POST /users/search
 * 
 * Search for users by username or name
 * 
 * @body {string} query - Search query
 * @returns {User[]} Array of matching users
 */
router.post(
  '/search',
  validate({ body: searchUsersBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await usersController.searchUsers(req, res, () => {});
  })
);

/**
 * POST /users/verify/request
 * 
 * Request account verification
 * 
 * @body {string} reason - Reason for verification request
 * @body {string} [evidence] - Optional evidence/documentation
 * @returns {object} Confirmation with request ID
 */
router.post(
  '/verify/request',
  authMiddleware,
  validate({ body: verifyRequestSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const { reason, evidence } = req.body;
    if (!reason || typeof reason !== 'string') {
      throw new BadRequestError('Reason is required for verification request');
    }

    // Create verification request (in a real app, you'd save this to a database)
    const requestId = `VERIFY-${Date.now()}-${userId}`;
    
    // For now, we'll just log it. In production, you'd save this to a VerificationRequest model
    logger.info('Account verification requested', {
      userId,
      requestId,
      reason,
      hasEvidence: !!evidence,
    });

    sendSuccess(res, {
      message: 'Verification request submitted successfully',
      requestId,
      status: 'pending',
    });
  })
);

/**
 * GET /users/me/data
 * 
 * Download account data export
 * 
 * @query {string} [format] - Export format: 'json' or 'csv' (default: 'json')
 * @returns {Blob} Account data file
 */
router.get(
  '/me/data',
  authMiddleware,
  validate({ query: dataExportQuerySchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const format = (req.query.format as string) || 'json';
    const user = await User.findById(userId).select('-refreshToken').lean();

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Remove sensitive fields
    const { refreshToken, ...safeUserData } = user;

    let data: string;
    let contentType: string;
    let filename: string;

    if (format === 'csv') {
      // Convert to CSV format (simplified - you'd want a proper CSV library)
      const fields = Object.keys(safeUserData);
      const headers = fields.join(',');
      const values = fields.map(field => {
        const value = (safeUserData as any)[field];
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        return String(value || '');
      }).join(',');
      data = `${headers}\n${values}`;
      contentType = 'text/csv';
      filename = `account-data-${Date.now()}.csv`;
    } else {
      data = JSON.stringify(safeUserData, null, 2);
      contentType = 'application/json';
      filename = `account-data-${Date.now()}.json`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(data);

    logger.info('Account data exported', { userId, format });
  })
);

/**
 * @openapi
 * /users/me:
 *   delete:
 *     tags:
 *       - Users
 *     summary: Permanently delete the current account
 *     description: >
 *       Hard-delete the authenticated user's account. To prove identity at
 *       the time of deletion the client signs `delete:{publicKey}:{timestamp}`
 *       with the local secp256k1 private key (see `KeyManager.sign` in
 *       `@oxyhq/core`). The signature is rejected if it is older than 5
 *       minutes, if the confirmation text does not match the account's
 *       username, or if the account has no associated public key.
 *
 *       Successful deletion removes all mailboxes, messages, and S3
 *       attachments owned by the user.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signature
 *               - timestamp
 *               - confirmText
 *             properties:
 *               signature:
 *                 type: string
 *                 description: Hex-encoded secp256k1 signature over `delete:{publicKey}:{timestamp}`.
 *                 example: 3045022100abcd...3045022100efgh
 *               timestamp:
 *                 type: integer
 *                 description: Unix milliseconds when the signature was produced.
 *                 example: 1714576800000
 *               confirmText:
 *                 type: string
 *                 description: Must equal the account's username.
 *                 example: alice
 *     responses:
 *       200:
 *         description: Account deleted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Account deleted successfully
 *       400:
 *         description: Missing field, expired signature, or mismatched confirmText.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid signature.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete(
  '/me',
  authMiddleware,
  validate({ body: deleteAccountSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const { signature, timestamp, confirmText } = req.body;
    
    if (!signature || !timestamp) {
      throw new BadRequestError('Signature and timestamp are required to delete account');
    }

    if (!confirmText) {
      throw new BadRequestError('Confirmation text is required');
    }

    const user = await User.findById(userId).select('+publicKey +username');
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify user has a publicKey for signature verification
    if (!user.publicKey) {
      throw new BadRequestError('Account does not have an identity key for signature verification');
    }

    // Verify signature using SignatureService
    const message = `delete:${user.publicKey}:${timestamp}`;
    const isValidSignature = SignatureService.verifySignature(message, signature, user.publicKey);
    
    // Check timestamp is recent (within 5 minutes)
    const now = Date.now();
    if (now - timestamp > 5 * 60 * 1000) {
      throw new BadRequestError('Signature has expired. Please try again.');
    }
    
    if (!isValidSignature) {
      throw new UnauthorizedError('Invalid signature');
    }

    // Verify confirmation text matches username
    if (confirmText !== user.username) {
      throw new BadRequestError('Confirmation text does not match username');
    }

    // Delete all email data (mailboxes, messages, S3 attachments)
    await emailService.deleteAllUserData(userId);

    // Delete the user account
    await User.findByIdAndDelete(userId);

    logger.info('Account deleted', { userId, username: user.username });

    sendSuccess(res, {
      message: 'Account deleted successfully',
    });
  })
);

/**
 * PUT /users/resolve
 *
 * Find or create a non-local user (federated, agent, or automated).
 * Called by Oxy ecosystem services when they encounter an external user
 * that needs an Oxy identity. Requires a valid service token whose
 * Application has been granted the `federation:write` scope.
 *
 * Hardening (C4):
 *  - Scope check: rejects service tokens that lack `federation:write`.
 *  - Actor URI binding: `actorUri.hostname` must match the asserted
 *    `domain` (so a malicious service can't claim to vouch for a user on
 *    a host they don't actually own).
 *  - Username squatting: for `agent` / `automated`, refuse to upsert when
 *    a `local` (or other-type) user already owns the username.
 *  - Type immutability: never let `type` change on an existing user — a
 *    federated user cannot be silently upgraded to an `agent`, etc.
 *
 * @body {'federated' | 'agent' | 'automated'} type
 * @body {string} username      - Unique username (e.g. "user@mastodon.social")
 * @body {string} [actorUri]    - ActivityPub actor URI (required for federated)
 * @body {string} [domain]      - Origin domain (required for federated)
 * @body {string} [displayName] - Display name
 * @body {string} [avatar]      - Avatar URL or asset ID
 * @body {string} [bio]         - Profile bio
 * @body {string} [ownerId]     - Owner user ID (for agent/automated)
 * @body {boolean} [refresh]            - When true, force re-downloading an http
 *                                        avatar even if a stored file id already
 *                                        exists (eventually-fresh refresh).
 * @body {boolean} [forceAvatarRefresh] - Alias for `refresh`; either truthy forces it.
 * @returns {User} The resolved user document
 */
interface ResolveUserBody {
  type?: unknown;
  username?: unknown;
  actorUri?: unknown;
  domain?: unknown;
  displayName?: unknown;
  avatar?: unknown;
  bio?: unknown;
  ownerId?: unknown;
  refresh?: unknown;
  forceAvatarRefresh?: unknown;
}

router.put(
  '/resolve',
  serviceAuthMiddleware,
  asyncHandler(async (req: ServiceAuthRequest, res: Response) => {
    // Scope gate — only service tokens explicitly granted `federation:write`
    // may create or update federated/agent/automated users.
    const scopes = req.serviceApp?.scopes ?? [];
    if (!scopes.includes('federation:write')) {
      throw new ForbiddenError('Missing required scope: federation:write');
    }

    const body = req.body as ResolveUserBody;
    const { type, username, actorUri, domain, displayName, avatar, bio, ownerId } = body;
    // Either flag (truthy) forces an http avatar to be re-downloaded, replacing
    // any existing stored file id. Mention passes `refresh: true` on its
    // scheduled federated-actor refresh.
    const forceAvatarRefresh = body.refresh === true || body.forceAvatarRefresh === true;

    const RESOLVE_USER_TYPES = ['federated', 'agent', 'automated'] as const;
    type ResolveUserType = (typeof RESOLVE_USER_TYPES)[number];
    const isResolveUserType = (value: unknown): value is ResolveUserType =>
      typeof value === 'string' && (RESOLVE_USER_TYPES as readonly string[]).includes(value);
    if (!isResolveUserType(type)) {
      throw new BadRequestError('type must be "federated", "agent", or "automated"');
    }
    if (!username || typeof username !== 'string') {
      throw new BadRequestError('username is required');
    }

    // Build the upsert filter and $set payload — never touch auth fields
    let filter: Record<string, unknown>;
    const setFields: Record<string, unknown> = { username };

    if (type === 'federated') {
      if (!actorUri || typeof actorUri !== 'string') {
        throw new BadRequestError('actorUri is required for federated users');
      }
      if (!domain || typeof domain !== 'string') {
        throw new BadRequestError('domain is required for federated users');
      }
      // Bind the actor URI hostname to the asserted domain so a service
      // can't claim "alice@mastodon.social" actually lives at
      // attacker.example.
      let actorHostname: string;
      try {
        actorHostname = new URL(actorUri).hostname.toLowerCase();
      } catch {
        throw new BadRequestError('actorUri must be a valid URL');
      }
      const normalisedDomain = domain.toLowerCase();
      if (actorHostname !== normalisedDomain) {
        throw new BadRequestError('actorUri hostname does not match domain');
      }
      filter = { 'federation.actorUri': actorUri };
      setFields['federation.actorUri'] = actorUri;
      setFields['federation.domain'] = normalisedDomain;
    } else {
      // For agent / automated, refuse to clobber a username already taken
      // by a local user — that would be account takeover via the
      // federation pipeline.
      const localCollision = await User.findOne({
        username,
        type: { $nin: ['agent', 'automated'] },
      }).select('_id type').lean();
      if (localCollision) {
        throw new ConflictError('Username is already taken by a non-automated user');
      }
      filter = { username, type: { $in: ['agent', 'automated'] } };
      if (typeof ownerId === 'string') {
        setFields['automation.ownerId'] = ownerId;
      }
    }

    // Type immutability check: if a user already exists, its `type` must
    // match what the caller is asserting. We never allow a federated user
    // to be silently re-typed as an agent, or vice versa.
    const existingByFilter = await User.findOne(filter).select('_id type').lean();
    if (existingByFilter && existingByFilter.type && existingByFilter.type !== type) {
      throw new ConflictError('Cannot change the type of an existing user');
    }

    // Only set `type` on initial insert; never overwrite on update. The
    // immutability invariant above already rejected mismatched updates.
    const setOnInsert: Record<string, unknown> = { type };

    if (typeof displayName === 'string') {
      setFields['name.first'] = displayName;
    }
    if (typeof bio === 'string') {
      setFields.bio = bio;
    }

    // Avatar handling splits two ways:
    //  - A raw http(s) URL is downloaded into an Oxy file OFF the request path
    //    (fire-and-forget after the upsert) so we never block the response on
    //    remote I/O. The avatar field may therefore lag one refresh cycle: the
    //    response carries the previous (or absent) avatar and the new file id
    //    lands shortly after. The scheduler throttles forced re-downloads and
    //    sends conditional (ETag / Last-Modified) requests.
    //  - A non-URL value is already a stored file id; set it synchronously.
    let remoteAvatarUrl: string | undefined;
    let existingAvatarFileId: string | undefined;
    if (typeof avatar === 'string' && avatar.startsWith('http')) {
      const existingUser = await User.findOne(filter).select('avatar').lean();
      existingAvatarFileId = typeof existingUser?.avatar === 'string' ? existingUser.avatar : undefined;
      remoteAvatarUrl = avatar;
    } else if (typeof avatar === 'string') {
      // Non-URL avatar (already a file ID) — set directly
      setFields.avatar = avatar;
    }

    const user = await User.findOneAndUpdate(
      filter,
      { $set: setFields, $setOnInsert: setOnInsert },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    )
      .select('-password -refreshToken')
      .lean({ virtuals: true });

    if (!user) {
      throw new Error('Failed to resolve user');
    }

    // This route mutates user state (avatar/name/bio/federation fields), so the
    // in-memory user cache must be invalidated — otherwise getUserBySession can
    // serve a stale record and silently revert this update.
    userCache.invalidate(user._id.toString());

    // Kick the remote avatar download off the request path. The scheduler
    // resolves the user fresh, honours the throttle + conditional requests, and
    // invalidates the cache again once the new file id is persisted. Never
    // awaited — must not delay the response.
    if (remoteAvatarUrl) {
      federationService.scheduleAvatarRefresh(
        user._id.toString(),
        remoteAvatarUrl,
        existingAvatarFileId,
        { force: forceAvatarRefresh },
      );
    }

    logger.info('External user resolved', { type, username, userId: user._id });

    sendSuccess(res, user);
  })
);

export default router;
