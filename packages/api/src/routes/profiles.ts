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
import { federationService, isFediverseHandle } from '../services/federation.service';
import { PaginationParams, UserProfile, UserStatistics } from '../types/user.types';
import Follow, { FollowType } from '../models/Follow';
import User from '../models/User';
import { validate } from '../middleware/validate';
import { usernameParams, profileSearchQuerySchema } from '../schemas/profiles.schemas';

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
const VALID_EXCLUDE_TYPES = new Set(['federated', 'agent', 'automated']);
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
  validate({ params: usernameParams }),
  asyncHandler(async (req: Request, res: Response) => {
    const raw = req.params.username;

    // Federated handles (user@domain) are looked up as-is;
    // local usernames are sanitised to alphanumeric + underscores/hyphens/dots.
    const isFedHandle = isFediverseHandle(raw);
    const username = isFedHandle
      ? raw.replace(/^@/, '').toLowerCase()
      : raw.replace(/[^a-zA-Z0-9._-]/g, '');

    if (!username || username.length < MIN_USERNAME_LENGTH) {
      throw new BadRequestError(
        `Username must be at least ${MIN_USERNAME_LENGTH} characters`
      );
    }

    if (!isFedHandle && username.length > MAX_USERNAME_LENGTH) {
      throw new BadRequestError(`Username must be no more than ${MAX_USERNAME_LENGTH} characters`);
    }

    let user = await User.findOne({ username })
      .select('-password -refreshToken')
      .lean({ virtuals: true });

    // If not found and it's a fediverse handle, resolve via WebFinger
    if (!user && isFedHandle) {
      const resolved = await federationService.resolveAndUpsert(username).catch(() => null);
      if (resolved) {
        user = await User.findById(resolved._id)
          .select('-password -refreshToken')
          .lean({ virtuals: true });
      }
    }

    if (!user) {
      throw new NotFoundError('Profile not found');
    }

    // Get user statistics
    const stats = await userService.getUserStats((user as any)._id.toString());

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
  validate({ query: profileSearchQuerySchema }),
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

    const searchFilter = {
      $or: [
        { username: searchRegex },
        { 'name.first': searchRegex },
        { 'name.last': searchRegex },
        { description: searchRegex },
      ],
    };

    // Run local DB search and (if query is a fediverse handle) remote resolution in parallel
    const isFediverse = isFediverseHandle(sanitizedQuery);
    const [dbResult, federatedUser] = await Promise.all([
      User.aggregate([
        { $match: searchFilter },
        {
          $facet: {
            profiles: [
              { $skip: parsedOffset },
              { $limit: parsedLimit },
              { $project: { password: 0, refreshToken: 0 } },
            ],
            totalCount: [{ $count: 'count' }],
          },
        },
      ]).then((r) => r[0]),
      isFediverse
        ? federationService.resolveAndUpsert(sanitizedQuery).catch(() => null)
        : Promise.resolve(null),
    ]);

    const profiles = dbResult.profiles || [];
    const total = dbResult.totalCount[0]?.count || 0;

    // If federation resolved a user not already in DB results, prepend it
    if (federatedUser) {
      const fedId = federatedUser._id?.toString();
      const alreadyIncluded = profiles.some((p: any) => p._id?.toString() === fedId);
      if (!alreadyIncluded) {
        profiles.unshift(federatedUser);
      }
    }

    // Batch-fetch follower/following stats for all profiles at once (avoids N+1)
    const profileIds = profiles.map((p: any) => p._id);
    const [followerCounts, followingCounts] = await Promise.all([
      Follow.aggregate([
        { $match: { followedId: { $in: profileIds.map((id: any) => id.toString()) }, followType: FollowType.USER } },
        { $group: { _id: '$followedId', count: { $sum: 1 } } },
      ]),
      Follow.aggregate([
        { $match: { followerUserId: { $in: profileIds.map((id: any) => id.toString()) }, followType: FollowType.USER } },
        { $group: { _id: '$followerUserId', count: { $sum: 1 } } },
      ]),
    ]);

    const followerMap = new Map(followerCounts.map((r: any) => [r._id.toString(), r.count]));
    const followingMap = new Map(followingCounts.map((r: any) => [r._id.toString(), r.count]));

    const enrichedProfiles = profiles.map((profile: any) => {
      const id = profile._id.toString();
      const stats = {
        followers: followerMap.get(id) || 0,
        following: followingMap.get(id) || 0,
        karma: 0,
      };
      return userService.formatUserResponse(profile, stats);
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
 * GET /profiles/resolve
 *
 * Resolve a fediverse handle (e.g. @user@mastodon.social) to an Oxy user profile.
 * Performs WebFinger discovery, fetches the ActivityPub actor, and upserts as a
 * federated user. Returns cached results if resolved within the last 24 hours.
 *
 * @query {string} handle - Fediverse handle (e.g. "@user@domain" or "user@domain")
 * @returns {User | null} Resolved user profile or null
 */
router.get(
  '/resolve',
  asyncHandler(async (req: Request, res: Response) => {
    const handle = (req.query.handle as string || '').trim();

    if (!handle || !isFediverseHandle(handle)) {
      throw new BadRequestError('Invalid fediverse handle. Expected format: @user@domain or user@domain');
    }

    const user = await federationService.resolveAndUpsert(handle);
    if (!user) {
      return sendSuccess(res, null);
    }

    const stats = await userService.getUserStats(user._id.toString());
    const response = userService.formatUserResponse(user, stats);

    logger.debug('GET /profiles/resolve', { handle });
    sendSuccess(res, response);
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
    const { limit, offset, excludeTypes: excludeTypesRaw } = req.query as PaginationQuery & { excludeTypes?: string };
    const currentUserId = req.user?.id;

    const excludeTypes = excludeTypesRaw
      ? excludeTypesRaw.split(',').filter(t => VALID_EXCLUDE_TYPES.has(t.trim())).map(t => t.trim())
      : [];

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
        // Filter by user type if excludeTypes specified
        ...(excludeTypes.length > 0
          ? [{ $match: { 'user.type': { $nin: excludeTypes } } }]
          : []),
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
            type: '$user.type',
            federation: '$user.federation',
            automation: '$user.automation',
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

      const typeFilter = excludeTypes.length > 0 ? { type: { $nin: excludeTypes } } : {};
      const randomUsers = await User.aggregate([
        { $match: { _id: { $nin: excludeIds.concat(alreadyRecommendedIds) }, ...typeFilter } },
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
            type: 1,
            federation: 1,
            automation: 1,
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
      isFederated: u.type === 'federated',
      isAgent: u.type === 'agent',
      isAutomated: u.type === 'automated',
      instance: u.federation?.domain,
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
