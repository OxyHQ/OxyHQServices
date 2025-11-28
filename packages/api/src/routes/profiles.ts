/**
 * Profile Routes
 * 
 * RESTful API routes for profile operations.
 * Uses service layer for business logic and standardized error handling.
 */

import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';
import { asyncHandler, sendSuccess, sendPaginated } from '../utils/asyncHandler';
import {
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
} from '../utils/error';
import { userService } from '../services/user.service';
import { PaginationParams, UserProfile, UserStatistics } from '../types/user.types';
import Follow, { FollowType } from '../models/Follow';
import User from '../models/User';

interface AuthRequest extends Request {
  user?: {
    id: string;
  };
}

interface PaginationQuery {
  limit?: string;
  offset?: string;
}

const router = Router();
import { PAGINATION } from '../utils/constants';

// Constants
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 30;

/**
 * Validates pagination query parameters
 */
const validatePagination = (req: Request, res: Response, next: () => void): void => {
  const query = req.query as PaginationQuery;
  const limit = query.limit ? parseInt(query.limit, 10) : undefined;
  const offset = query.offset ? parseInt(query.offset, 10) : undefined;

  if (limit !== undefined && (isNaN(limit) || limit < 0 || limit > PAGINATION.MAX_LIMIT)) {
    res.status(400).json({
      error: 'BAD_REQUEST',
      message: `Invalid limit parameter. Must be between 1 and ${PAGINATION.MAX_LIMIT}`,
    });
    return;
  }

  if (offset !== undefined && (isNaN(offset) || offset < 0)) {
    res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'Invalid offset parameter. Must be >= 0',
    });
    return;
  }

  next();
};

/**
 * GET /profiles/username/:username
 * 
 * Get user profile by username
 * 
 * @param {string} username - Username (alphanumeric only)
 * @returns {UserProfile} User profile with statistics
 */
router.get(
  '/username/:username',
  asyncHandler(async (req: Request, res: Response) => {
    // Sanitize username: only allow alphanumeric characters
    const username = req.params.username.replace(/[^a-zA-Z0-9]/g, '');

    if (!username || username.length < MIN_USERNAME_LENGTH) {
      throw new BadRequestError(
        `Username must be at least ${MIN_USERNAME_LENGTH} characters long and contain only letters and numbers`
      );
    }

    if (username.length > MAX_USERNAME_LENGTH) {
      throw new BadRequestError(`Username must be no more than ${MAX_USERNAME_LENGTH} characters`);
    }

    const user = await User.findOne({ username })
      .select('-password -refreshToken')
      .lean({ virtuals: true });

    if (!user) {
      throw new NotFoundError('Profile not found');
    }

    // Get user statistics
    const stats = await userService.getUserStats(user._id.toString());

    // Format response with stats
    const response = userService.formatUserResponse(user as any, stats);

    logger.debug('GET /profiles/username/:username', { username });
    sendSuccess(res, response);
  })
);

/**
 * GET /profiles/search
 * 
 * Search for user profiles by username or name
 * 
 * @query {string} query - Search query (required)
 * @query {number} limit - Number of results (max 100, default 10)
 * @query {number} offset - Pagination offset (default 0)
 * @returns {PaginatedResponse<UserProfile>} Paginated list of matching profiles
 */
router.get(
  '/search',
  validatePagination,
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query.query as string;
    const { limit, offset } = req.query as PaginationQuery;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new BadRequestError('Search query is required');
    }

    const parsedLimit = limit
      ? Math.min(parseInt(limit, 10), PAGINATION.MAX_LIMIT)
      : PAGINATION.DEFAULT_LIMIT;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    // Sanitize search query to prevent regex injection
    const sanitizedQuery = query.trim().substring(0, 100);
    const searchRegex = new RegExp(sanitizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const profiles = await User.find({
      $or: [
        { username: searchRegex },
        { 'name.first': searchRegex },
        { 'name.last': searchRegex },
        { description: searchRegex },
      ],
    })
      .select('-password -refreshToken')
      .limit(parsedLimit)
      .skip(parsedOffset)
      .lean({ virtuals: true });

    // Enrich profiles with statistics
    const enrichedProfiles = await Promise.all(
      profiles.map(async (profile) => {
        const stats = await userService.getUserStats(profile._id.toString());
        return userService.formatUserResponse(profile as any, stats);
      })
    );

    // Get total count for pagination
    const total = await User.countDocuments({
      $or: [
        { username: searchRegex },
        { 'name.first': searchRegex },
        { 'name.last': searchRegex },
        { description: searchRegex },
      ],
    });

    logger.debug('GET /profiles/search', {
      query: sanitizedQuery,
      limit: parsedLimit,
      offset: parsedOffset,
      total,
    });

    sendPaginated(res, enrichedProfiles, total, parsedLimit, parsedOffset);
  })
);

/**
 * GET /profiles/recommendations
 * 
 * Get recommended user profiles based on mutual connections
 * 
 * @query {number} limit - Number of results (max 100, default 10)
 * @query {number} offset - Pagination offset (default 0)
 * @returns {UserProfile[]} List of recommended profiles
 */
router.get(
  '/recommendations',
  authMiddleware,
  validatePagination,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { limit, offset } = req.query as PaginationQuery;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const parsedLimit = limit
      ? Math.min(parseInt(limit, 10), PAGINATION.MAX_LIMIT)
      : PAGINATION.DEFAULT_LIMIT;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    logger.debug('GET /profiles/recommendations', {
      currentUserId,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    let excludeIds: Types.ObjectId[] = [];
    let followingIds: Types.ObjectId[] = [];

    excludeIds.push(new Types.ObjectId(currentUserId));

    // Get users that current user follows
    const following = await Follow.find({
      followerUserId: currentUserId,
      followType: FollowType.USER,
    }).select('followedId').lean();

    followingIds = following
      .map((f) =>
        f.followedId instanceof Types.ObjectId
          ? f.followedId
          : new Types.ObjectId(f.followedId)
      )
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);

    excludeIds = excludeIds.concat(followingIds);

    let recommendations: any[] = [];

    // Find users followed by people you follow (mutuals), ranked by mutual count
    if (followingIds.length > 0) {
      recommendations = await Follow.aggregate([
        {
          $match: {
            followerUserId: { $in: followingIds },
            followType: FollowType.USER,
            followedId: { $nin: excludeIds },
          },
        },
        {
          $group: {
            _id: '$followedId',
            mutualCount: { $sum: 1 },
          },
        },
        { $sort: { mutualCount: -1 } },
        { $skip: parsedOffset },
        { $limit: parsedLimit },
        // Join with User
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        // Get follower/following counts
        {
          $lookup: {
            from: 'follows',
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$followedId', '$$userId'] },
                      { $eq: ['$followType', FollowType.USER] },
                    ],
                  },
                },
              },
            ],
            as: 'followersArr',
          },
        },
        {
          $lookup: {
            from: 'follows',
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$followerUserId', '$$userId'] },
                      { $eq: ['$followType', FollowType.USER] },
                    ],
                  },
                },
              },
            ],
            as: 'followingArr',
          },
        },
        {
          $project: {
            _id: 1,
            username: '$user.username',
            name: '$user.name',
            avatar: '$user.avatar',
            description: '$user.description',
            mutualCount: 1,
            followersCount: { $size: '$followersArr' },
            followingCount: { $size: '$followingArr' },
          },
        },
      ]);
    }

    // If not enough recommendations, fill with random users
    if (recommendations.length < parsedLimit) {
      const alreadyRecommendedIds = recommendations.map((u) => u._id);
      const fillLimit = parsedLimit - recommendations.length;

      const randomUsers = await User.aggregate([
        { $match: { _id: { $nin: excludeIds.concat(alreadyRecommendedIds) } } },
        { $sample: { size: fillLimit } },
        {
          $lookup: {
            from: 'follows',
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$followedId', '$$userId'] },
                      { $eq: ['$followType', FollowType.USER] },
                    ],
                  },
                },
              },
            ],
            as: 'followersArr',
          },
        },
        {
          $lookup: {
            from: 'follows',
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$followerUserId', '$$userId'] },
                      { $eq: ['$followType', FollowType.USER] },
                    ],
                  },
                },
              },
            ],
            as: 'followingArr',
          },
        },
        {
          $project: {
            _id: 1,
            username: 1,
            name: 1,
            avatar: 1,
            description: 1,
            mutualCount: { $literal: 0 },
            followersCount: { $size: '$followersArr' },
            followingCount: { $size: '$followingArr' },
          },
        },
      ]);

      recommendations = recommendations.concat(randomUsers);
    }

    // Format recommendations response
    const formattedRecommendations = recommendations.map((u) => ({
      id: u._id,
      username: u.username,
      name: u.name,
      avatar: u.avatar,
      description: u.description,
      mutualCount: u.mutualCount || 0,
      _count: {
        followers: u.followersCount || 0,
        following: u.followingCount || 0,
      },
    }));

    logger.debug('GET /profiles/recommendations', {
      currentUserId,
      recommendationsCount: formattedRecommendations.length,
    });

    sendSuccess(res, formattedRecommendations);
  })
);

export default router;
