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
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';
import { asyncHandler, sendSuccess, sendPaginated } from '../utils/asyncHandler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
  ApiError,
} from '../utils/error';
import { userService } from '../services/user.service';
import { UsersController } from '../controllers/users.controller';
import { PaginationParams, UserStatistics } from '../types/user.types';

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

// Initialize router and controller
const router = Router();
const usersController = new UsersController();

// ============================================================================
// Middleware
// ============================================================================

/**
 * Validates MongoDB ObjectId parameter
 * Returns 400 if invalid
 */
const validateObjectId = (req: Request, res: Response, next: NextFunction): void => {
  const { userId } = req.params;
  
  if (!userId || !Types.ObjectId.isValid(userId)) {
    res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'Invalid user ID format',
    });
    return;
  }
  
  next();
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
 */
const requireOwnership = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const userId = req.params.userId;
  const currentUserId = req.user?.id;

  if (!currentUserId) {
    throw new UnauthorizedError('Authentication required');
  }

  if (userId !== currentUserId) {
    throw new ForbiddenError('Not authorized to access this resource');
  }

  next();
};

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /users/me
 * 
 * Get current authenticated user profile
 * 
 * @returns {User} Current user object
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
 * PUT /users/me
 * 
 * Update current authenticated user profile
 * 
 * @body {ProfileUpdateInput} Profile updates
 * @returns {User} Updated user object
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
  validateObjectId,
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
  validateObjectId,
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
  validateObjectId,
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
  validateObjectId,
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
  validateObjectId,
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
  validateObjectId,
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
  validateObjectId,
  requireOwnership,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;

    if (!req.body?.privacySettings || typeof req.body.privacySettings !== 'object') {
      throw new BadRequestError('Invalid privacy settings');
    }

    const user = await userService.getUserById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Update privacy settings
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: { privacySettings: req.body.privacySettings } },
      { new: true, runValidators: true }
    )
      .select('-password -refreshToken')
      .lean({ virtuals: true });

    if (!updatedUser) {
      throw new NotFoundError('User not found');
    }

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
 * DELETE /users/me
 * 
 * Permanently delete the current user's account
 * 
 * @body {string} signature - Signature of "delete:{publicKey}:{timestamp}" for confirmation
 * @body {number} timestamp - Timestamp when the signature was created
 * @body {string} confirmText - Confirmation text (usually username)
 * @returns {object} Confirmation message
 */
router.delete(
  '/me',
  authMiddleware,
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

    // Verify signature using SignatureService
    const SignatureService = require('../services/signature.service').default;
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

    // Delete the user account
    await User.findByIdAndDelete(userId);

    logger.info('Account deleted', { userId, username: user.username });

    sendSuccess(res, {
      message: 'Account deleted successfully',
    });
  })
);

export default router;
