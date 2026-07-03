/**
 * Profile Routes
 * 
 * RESTful API routes for profile operations.
 * Uses service layer for business logic and standardized error handling.
 */

import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { authMiddleware } from '../middleware/auth';
import {
  optionalUserOrServiceAuth,
  resolveViewerId,
  type OptionalUserOrServiceRequest,
} from '../middleware/optionalAuth';
import { logger } from '../utils/logger';
import { asyncHandler, sendSuccess, sendPaginated } from '../utils/asyncHandler';
import {
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
} from '../utils/error';
import { userService } from '../services/user.service';
import { federationService, isFediverseHandle } from '../services/federation.service';
import Follow, { FollowType } from '../models/Follow';
import User, { type IUser } from '../models/User';
import { validate } from '../middleware/validate';
import { usernameParams, profileSearchQuerySchema } from '../schemas/profiles.schemas';
import { formatUserNameResponse, type NameParts } from '../utils/displayName';
import { eligibleUserMatch, FEDERATED_RECOMMENDATION_MAX_AGE_MS } from '../utils/profileQuery';
import { AppUserSignal } from '../models/AppUserSignal';
import { AppAffinityEdge } from '../models/AppAffinityEdge';
import { Application } from '../models/Application';
import { accountService } from '../services/account.service';
import { getRedisClient } from '../config/redis';
import {
  resolveWeightProfile,
  normalizeRepWeight,
  MUTUAL_COUNT_WINDOW,
  MAX_FOLLOWING_FOR_MUTUALS,
  MAX_APP_SIGNAL_CANDIDATES,
  REC_CACHE_TTL_SECONDS,
  REP_WEIGHT_NORM_MIN,
  REP_WEIGHT_NORM_MAX,
  ENDORSEMENT_SCORE_SATURATION,
  MUTUAL_COUNT_SATURATION,
  MAX_AFFINITY_CANDIDATES,
  decayAffinity,
  normalizeAffinity,
  type RecommendationSignal,
} from '../utils/recommendationWeights';
import { INFLUENCE_MIN } from '../utils/reputation.constants';
import {
  recommendationRequestSchema,
  type RecommendationRequest,
  type RecommendationBoost,
} from '@oxyhq/contracts';

interface AuthRequest extends Request {
  user?: {
    id: string;
  };
}

interface PaginationQuery {
  limit?: string;
  offset?: string;
}

type SearchProfileDocument = IUser & {
  _id: Types.ObjectId;
};

interface ProfileSearchAggregateResult {
  profiles?: SearchProfileDocument[];
  totalCount?: Array<{ count: number }>;
}

interface FollowCountAggregateResult {
  _id: string | Types.ObjectId;
  count: number;
}

const router = Router();
import { PAGINATION } from '../utils/constants';

// Constants
const VALID_EXCLUDE_TYPES = new Set(['federated', 'agent', 'automated']);
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 30;
// Extra follower-ranked candidates fetched before the private/excludeTypes
// filter on the public recommendations path, so post-lookup filtering can't
// shrink the page below the requested limit.
const PUBLIC_FILTER_HEADROOM = 20;
// Bound the unauthenticated popularity fallback so a public request cannot
// aggregate the entire social graph. The sorted prefix is supported by
// Follow's { followType, createdAt, _id } index and keeps work independent of the
// total follows collection size.
const PUBLIC_POPULAR_FOLLOW_WINDOW = 5000;
// Bound attacker-selected co-follower fan-out before materializing IDs or
// building the follow aggregation's $in clause. This keeps /similar stable for
// high-follower targets while still sampling enough overlap for useful results.
const SIMILAR_PROFILE_MAX_TARGET_FOLLOWERS = 5000;

/**
 * Shared aggregation stages that look up follower and following counts
 * for each user matched in a Follow-based aggregation pipeline.
 */
const followCountLookupStages = [
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
];

/**
 * Shape of a single recommendation/profile row produced by
 * {@link profileProjectionStage} and {@link userProfileProjectionStage}.
 * Both projections emit the same fields, so every recommendation pipeline
 * (personalized, public, similar, random fill) yields this row shape and it
 * feeds {@link formatProfileResult}.
 */
interface RecommendationRow {
  _id: Types.ObjectId;
  username?: string;
  publicKey?: string;
  name?: NameParts | string | null;
  avatar?: string | null;
  description?: string | null;
  type?: string;
  federation?: { domain?: string } | null;
  automation?: unknown;
  verified?: boolean;
  reputationTier?: string;
  mutualCount?: number;
  followersCount?: number;
  followingCount?: number;
  /** Final composite score (scored v2 path only). */
  score?: number;
  /** Names of the signals that contributed to the score (scored v2 path only). */
  matchedSignals?: string[];
}

const profileProjectionStage = {
  $project: {
    _id: 1,
    username: '$user.username',
    publicKey: '$user.publicKey',
    name: '$user.name',
    avatar: '$user.avatar',
    description: '$user.description',
    type: '$user.type',
    federation: '$user.federation',
    automation: '$user.automation',
    verified: '$user.verified',
    reputationTier: '$user.reputationTier',
    mutualCount: 1,
    followersCount: { $size: '$followersArr' },
    followingCount: { $size: '$followingArr' },
  },
};

/** Same projection but for pipelines starting from the users collection. */
const userProfileProjectionStage = {
  $project: {
    _id: 1,
    username: 1,
    publicKey: 1,
    name: 1,
    avatar: 1,
    description: 1,
    type: 1,
    federation: 1,
    automation: 1,
    verified: 1,
    reputationTier: 1,
    mutualCount: { $literal: 0 },
    followersCount: { $size: '$followersArr' },
    followingCount: { $size: '$followingArr' },
  },
};

function formatProfileResult(u: RecommendationRow) {
  return {
    id: u._id,
    username: u.username,
    name: formatUserNameResponse({
      name: typeof u.name === 'object' ? u.name : undefined,
      username: u.username,
      publicKey: u.publicKey,
    }),
    avatar: u.avatar,
    description: u.description,
    verified: u.verified === true,
    trustTier: u.reputationTier,
    mutualCount: u.mutualCount || 0,
    ...(typeof u.score === 'number' ? { score: u.score } : {}),
    ...(u.matchedSignals ? { matchedSignals: u.matchedSignals } : {}),
    isFederated: u.type === 'federated',
    isAgent: u.type === 'agent',
    isAutomated: u.type === 'automated',
    instance: u.federation?.domain,
    _count: {
      followers: u.followersCount || 0,
      following: u.followingCount || 0,
    },
  };
}

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

const parseExcludeTypesQuery = (excludeTypesRaw: unknown): string[] => {
  if (excludeTypesRaw === undefined) {
    return [];
  }

  if (typeof excludeTypesRaw !== 'string') {
    throw new BadRequestError('Invalid excludeTypes parameter. Must be a comma-separated string');
  }

  return excludeTypesRaw
    .split(',')
    .map((type) => type.trim())
    .filter((type) => VALID_EXCLUDE_TYPES.has(type));
};

/**
 * @openapi
 * /profiles/username/{username}:
 *   get:
 *     tags:
 *       - Profiles
 *     security: []
 *     summary: Public profile lookup by username
 *     description: >
 *       Resolve a username to a public profile, with follower/following
 *       counts. Federated handles (`user@domain`) are resolved on the fly via
 *       WebFinger + ActivityPub; if the actor has never been seen the
 *       endpoint will upsert it as a federated user before returning.
 *
 *       This endpoint is unauthenticated and may be cached by edge.
 *     parameters:
 *       - name: username
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           description: Local username (alphanumeric, 3-30 chars) or fediverse handle.
 *           examples:
 *             local: alice
 *             federated: alice@mastodon.social
 *     responses:
 *       200:
 *         description: Profile found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *             examples:
 *               local:
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
 *       400:
 *         description: Malformed username.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Profile not found (and federation lookup failed).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
    const stats = await userService.getUserStats(user._id.toString());

    // Format response with stats
    const response = userService.formatUserResponse(user, stats);

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
      User.aggregate<ProfileSearchAggregateResult>([
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
      ]).then((r) => r[0] ?? { profiles: [], totalCount: [] }),
      isFediverse
        ? federationService.resolveAndUpsert(sanitizedQuery).catch(() => null)
        : Promise.resolve(null),
    ]);

    const profiles = dbResult.profiles ?? [];
    const total = dbResult.totalCount?.[0]?.count ?? 0;

    // If federation resolved a user not already in DB results, prepend it
    if (federatedUser) {
      const fedId = federatedUser._id?.toString();
      const alreadyIncluded = profiles.some((profile) => profile._id.toString() === fedId);
      if (!alreadyIncluded) {
        profiles.unshift(federatedUser as SearchProfileDocument);
      }
    }

    // Batch-fetch follower/following stats for all profiles at once (avoids N+1)
    const profileIds = profiles.map((profile) => profile._id);
    const [followerCounts, followingCounts] = await Promise.all([
      Follow.aggregate<FollowCountAggregateResult>([
        { $match: { followedId: { $in: profileIds.map((id) => id.toString()) }, followType: FollowType.USER } },
        { $group: { _id: '$followedId', count: { $sum: 1 } } },
      ]),
      Follow.aggregate<FollowCountAggregateResult>([
        { $match: { followerUserId: { $in: profileIds.map((id) => id.toString()) }, followType: FollowType.USER } },
        { $group: { _id: '$followerUserId', count: { $sum: 1 } } },
      ]),
    ]);

    const followerMap = new Map(followerCounts.map((result) => [result._id.toString(), result.count]));
    const followingMap = new Map(followingCounts.map((result) => [result._id.toString(), result.count]));

    const enrichedProfiles = profiles.map((profile) => {
      const id = profile._id.toString();
      const stats = {
        followers: followerMap.get(id) || 0,
        following: followingMap.get(id) || 0,
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
 * GET /profiles/:userId/similar
 *
 * Get profiles similar to a given user, based on co-follower overlap.
 * Finds users followed by the same people who follow :userId, ranked by overlap count.
 *
 * @param {string} userId - Target user ID
 * @query {number} limit - Number of results (max 100, default 10)
 * @query {number} offset - Pagination offset (default 0)
 * @returns {UserProfile[]} List of similar profiles
 */
router.get(
  '/:userId/similar',
  authMiddleware,
  validatePagination,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { limit, offset } = req.query as PaginationQuery;
    const currentUserId = req.user?.id;
    const targetUserId = req.params.userId;

    if (!currentUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestError('Invalid user ID');
    }

    const parsedLimit = limit
      ? Math.min(parseInt(limit, 10), PAGINATION.MAX_LIMIT)
      : PAGINATION.DEFAULT_LIMIT;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;
    const minFederatedResolvedAt = new Date(Date.now() - FEDERATED_RECOMMENDATION_MAX_AGE_MS);

    const [targetFollowers, currentFollowing] = await Promise.all([
      Follow.find({
        followedId: targetUserId,
        followType: FollowType.USER,
      })
        .select('followerUserId')
        .sort({ _id: 1 })
        .limit(SIMILAR_PROFILE_MAX_TARGET_FOLLOWERS)
        .lean(),
      Follow.find({
        followerUserId: currentUserId,
        followType: FollowType.USER,
      }).select('followedId').lean(),
    ]);

    const targetFollowerIds = targetFollowers
      .map((f) =>
        f.followerUserId instanceof Types.ObjectId
          ? f.followerUserId
          : new Types.ObjectId(f.followerUserId as string)
      )
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);

    const excludeIds: Types.ObjectId[] = [
      new Types.ObjectId(currentUserId),
      new Types.ObjectId(targetUserId),
      ...currentFollowing.map((f) =>
        f.followedId instanceof Types.ObjectId
          ? f.followedId
          : new Types.ObjectId(f.followedId as string)
      ),
    ];

    let similar: RecommendationRow[] = [];

    if (targetFollowerIds.length > 0) {
      similar = await Follow.aggregate<RecommendationRow>([
        {
          $match: {
            followerUserId: { $in: targetFollowerIds },
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
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        // Hold co-follower candidates to the same discovery eligibility bar as
        // the recommendations surface: drop incomplete shell/QA profiles and
        // stale/unavailable federated actors before they reach the response.
        { $match: eligibleUserMatch(minFederatedResolvedAt, 'user.') },
        ...followCountLookupStages,
        profileProjectionStage,
      ]);
    }

    const formattedSimilar = similar.map(formatProfileResult);

    logger.debug('GET /profiles/:userId/similar', {
      currentUserId,
      targetUserId,
      similarCount: formattedSimilar.length,
      sampledTargetFollowers: targetFollowerIds.length,
    });

    sendSuccess(res, formattedSimilar);
  })
);

/**
 * Normalized options for {@link buildRecommendations}, shared by the GET
 * (query-string) and POST (JSON body) entry points so both surfaces produce the
 * identical result for the identical inputs.
 */
interface RecommendationOptions {
  limit: number;
  offset: number;
  excludeTypes: string[];
  excludeIds: string[];
  clientId?: string;
  boosts?: RecommendationBoost[];
  signalWeights?: Partial<Record<RecommendationSignal, number>>;
}

/**
 * Authorize the caller-supplied recommendation `clientId` (an Application id used
 * to read that app's private per-user signals and weight profile) against the
 * authenticated principal, returning the normalized id ONLY when the caller is
 * entitled to it — otherwise `undefined` (the request proceeds with no app
 * context).
 *
 * A `clientId` selects an app's AppUserSignal data (endorsement/interest) and
 * per-app weight profile, so honoring an arbitrary caller-supplied id would let
 * any caller pull recommendations shaped by another tenant's private signals
 * (cross-tenant data exposure). Authorization rules:
 *  - SERVICE token: allowed only for its OWN application
 *    (`clientId === serviceApp.appId`).
 *  - USER session: allowed only when the user has effective access to the
 *    application's owning account (an `AccountMember` role over
 *    `app.ownerAccountId`, with tree inheritance).
 *  - Anonymous: no owning application context → never authorized (and no DB
 *    lookup is performed).
 */
async function resolveAuthorizedRecommendationClientId(
  req: OptionalUserOrServiceRequest,
  suppliedClientId: string | undefined,
): Promise<string | undefined> {
  if (!suppliedClientId || !Types.ObjectId.isValid(suppliedClientId)) {
    return undefined;
  }

  const requestedAppId = new Types.ObjectId(suppliedClientId).toHexString();

  // SERVICE token: authorized only for its own application.
  const serviceAppId = req.serviceApp?.appId;
  if (serviceAppId) {
    const ownAppId = Types.ObjectId.isValid(serviceAppId)
      ? new Types.ObjectId(serviceAppId).toHexString()
      : serviceAppId;
    if (ownAppId === requestedAppId) {
      return requestedAppId;
    }
    logger.warn('recommendations: dropping unauthorized clientId', {
      suppliedClientId,
      serviceAppId,
      hasUserSession: false,
    });
    return undefined;
  }

  // USER session: authorized only when the caller has effective access to the
  // application's owning account (a member of the account, with inheritance).
  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    return undefined;
  }

  const application = await Application.findById(requestedAppId).select('ownerAccountId').lean();
  if (application?.ownerAccountId) {
    const access = await accountService.resolveEffectiveAccess(
      userId.toString(),
      application.ownerAccountId.toString()
    );
    if (access) {
      return requestedAppId;
    }
  }

  logger.warn('recommendations: dropping unauthorized clientId', {
    suppliedClientId,
    serviceAppId: null,
    hasUserSession: true,
  });
  return undefined;
}

/** Coerce a Follow.followedId (ObjectId | string) to an ObjectId, or null. */
function followedIdToObjectId(value: unknown): Types.ObjectId | null {
  if (value instanceof Types.ObjectId) return value;
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
    return new Types.ObjectId(value);
  }
  return null;
}

/**
 * Popularity-ranked fallback used by the scored builder whenever the personalized
 * candidate union is empty — anonymous callers (no viewer → no graph/app/boost
 * candidates) and cold-start viewers (a viewer who follows accounts with no
 * mutual overlap and triggers no app signals/boosts).
 *
 * Returns eligible public profiles ranked by follower count (most-followed
 * first), topping up with a random eligible sample only when popularity yields
 * fewer than `limit`. Mirrors the proven popular path while honoring the same
 * eligibility, privacy, exclusion (self/following/caller excludeIds) and
 * profile-quality gates as the scored path, and emits the uniform scored row
 * shape (`score: 0`, `mutualCount: 0`) so the response contract is identical.
 */
async function buildPopularFallback(
  excludeIds: readonly Types.ObjectId[],
  excludeTypes: readonly string[],
  parsedLimit: number,
  parsedOffset: number,
  minFederatedResolvedAt: Date,
): Promise<RecommendationRow[]> {
  const baseEligibility: Record<string, unknown> = {
    'privacySettings.isPrivateAccount': { $ne: true },
    reputationTier: { $ne: 'restricted' },
    ...eligibleUserMatch(minFederatedResolvedAt),
  };
  if (excludeTypes.length > 0) {
    baseEligibility.type = { $nin: excludeTypes };
  }

  const followerRanked = await Follow.aggregate<RecommendationRow>([
    { $match: { followType: FollowType.USER, followedId: { $nin: excludeIds } } },
    { $sort: { createdAt: -1, _id: 1 } },
    { $limit: PUBLIC_POPULAR_FOLLOW_WINDOW },
    { $group: { _id: '$followedId', followersCount: { $sum: 1 } } },
    { $sort: { followersCount: -1, _id: 1 } },
    { $skip: parsedOffset },
    { $limit: parsedLimit + PUBLIC_FILTER_HEADROOM },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $match: {
        'user.privacySettings.isPrivateAccount': { $ne: true },
        'user.reputationTier': { $ne: 'restricted' },
        ...(excludeTypes.length > 0 ? { 'user.type': { $nin: excludeTypes } } : {}),
        ...eligibleUserMatch(minFederatedResolvedAt, 'user.'),
      },
    },
    { $limit: parsedLimit },
    ...followCountLookupStages,
    profileProjectionStage,
  ]);

  let profiles: RecommendationRow[] = followerRanked;

  // Top up with a random eligible sample only on the first page, when popularity
  // alone could not fill the requested limit (e.g. a sparse graph). Offset pages
  // never random-fill so pagination stays deterministic.
  if (profiles.length < parsedLimit && parsedOffset === 0) {
    const alreadyIncluded = profiles.map((u) => u._id);
    const fillLimit = parsedLimit - profiles.length;

    const randomUsers = await User.aggregate<RecommendationRow>([
      {
        $match: {
          _id: { $nin: [...excludeIds, ...alreadyIncluded] },
          ...baseEligibility,
        },
      },
      { $sample: { size: fillLimit } },
      ...followCountLookupStages,
      userProfileProjectionStage,
    ]);

    profiles = profiles.concat(randomUsers);
  }

  // Stamp the uniform scored-row fields so the popular fallback and the scored
  // path return the identical shape.
  return profiles.map((row) => ({ ...row, mutualCount: 0, score: 0, matchedSignals: [] }));
}

/**
 * SCORED recommendation builder. A single aggregation over the candidate
 * union (mutual-overlap window ∪ app-signal candidates ∪ boost members) minus
 * the viewer/following/excludeIds, ranked by a weighted composite of:
 *   graph (mutual overlap), completeness, verified, curation (endorsement
 *   roll-up), interest, appBoost (caller boost map), and repCandidate
 *   (denormalized reputation rank weight). `restricted` users are floored out.
 */
async function buildRecommendationsScored(
  viewerId: string | undefined,
  opts: RecommendationOptions
): Promise<ReturnType<typeof formatProfileResult>[]> {
  const { limit: parsedLimit, offset: parsedOffset, excludeTypes } = opts;
  const minFederatedResolvedAt = new Date(Date.now() - FEDERATED_RECOMMENDATION_MAX_AGE_MS);
  const weights = resolveWeightProfile(opts.clientId, opts.signalWeights);

  // ---- Pre-queries -------------------------------------------------------
  // 1. The viewer's following set (for graph signal + exclusion).
  const followingIds: Types.ObjectId[] = [];
  if (viewerId) {
    const following = await Follow.find({
      followerUserId: viewerId,
      followType: FollowType.USER,
    })
      .select('followedId')
      .limit(MAX_FOLLOWING_FOR_MUTUALS)
      .lean();
    for (const f of following) {
      const id = followedIdToObjectId(f.followedId);
      if (id) followingIds.push(id);
    }
  }

  // 2. Mutual-overlap map (people followed by the people the viewer follows),
  //    bounded to the top window so the in-memory map stays small.
  const mutualMap = new Map<string, number>();
  if (followingIds.length > 0) {
    const mutualRows = await Follow.aggregate<{ _id: Types.ObjectId; mutualCount: number }>([
      {
        $match: {
          followerUserId: { $in: followingIds },
          followType: FollowType.USER,
        },
      },
      { $group: { _id: '$followedId', mutualCount: { $sum: 1 } } },
      { $sort: { mutualCount: -1 } },
      { $limit: MUTUAL_COUNT_WINDOW },
    ]);
    for (const row of mutualRows) {
      const id = followedIdToObjectId(row._id);
      if (id) mutualMap.set(id.toHexString(), row.mutualCount);
    }
  }

  // 3. App-signal candidates for the selected app (top endorsement/interest).
  const appSignalMap = new Map<string, { endorsementScore: number; interestScore: number }>();
  if (opts.clientId && Types.ObjectId.isValid(opts.clientId)) {
    const signalRows = await AppUserSignal.find({
      applicationId: new Types.ObjectId(opts.clientId),
    })
      .select('userId endorsementScore interestScore')
      .sort({ endorsementScore: -1 })
      .limit(MAX_APP_SIGNAL_CANDIDATES)
      .lean();
    for (const row of signalRows) {
      appSignalMap.set(row.userId.toHexString(), {
        endorsementScore: typeof row.endorsementScore === 'number' ? row.endorsementScore : 0,
        interestScore: typeof row.interestScore === 'number' ? row.interestScore : 0,
      });
    }
  }

  // 3b. Interaction-affinity map (candidate id → decayed-on-read affinity).
  //     The viewer's strongest directed affinity edges within the selected app,
  //     decayed once more on read so a dormant relationship fades toward 0.
  //     Empty when the viewer has no edges (no app context, or no events folded
  //     yet) → 0 contribution and no injected candidates (strict no-op).
  const affinityMap = new Map<string, number>();
  if (viewerId && Types.ObjectId.isValid(viewerId) && opts.clientId && Types.ObjectId.isValid(opts.clientId)) {
    const nowMs = Date.now();
    const affinityRows = await AppAffinityEdge.find({
      applicationId: new Types.ObjectId(opts.clientId),
      fromUserId: new Types.ObjectId(viewerId),
    })
      .select('toUserId affinity lastEventAt')
      .sort({ affinity: -1 })
      .limit(MAX_AFFINITY_CANDIDATES)
      .lean();
    for (const row of affinityRows) {
      const decayed = decayAffinity(
        typeof row.affinity === 'number' ? row.affinity : 0,
        row.lastEventAt ?? null,
        nowMs
      );
      if (decayed > 0) {
        affinityMap.set(row.toUserId.toHexString(), decayed);
      }
    }
  }

  // 4. Boost map (member id → summed boost weight). Boost members join the
  //    candidate union but still pass the eligibility/privacy gate.
  const boostMap = new Map<string, number>();
  for (const boost of opts.boosts ?? []) {
    for (const userId of boost.userIds) {
      if (!Types.ObjectId.isValid(userId)) continue;
      const key = new Types.ObjectId(userId).toHexString();
      boostMap.set(key, (boostMap.get(key) ?? 0) + boost.weight);
    }
  }

  // ---- Candidate union minus excludeIds ∪ following ∪ self ----------------
  const excluded = new Set<string>(opts.excludeIds
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id).toHexString()));
  if (viewerId && Types.ObjectId.isValid(viewerId)) {
    excluded.add(new Types.ObjectId(viewerId).toHexString());
  }
  for (const id of followingIds) {
    excluded.add(id.toHexString());
  }

  const candidateKeys = new Set<string>();
  for (const key of mutualMap.keys()) candidateKeys.add(key);
  for (const key of appSignalMap.keys()) candidateKeys.add(key);
  for (const key of affinityMap.keys()) candidateKeys.add(key);
  for (const key of boostMap.keys()) candidateKeys.add(key);
  for (const key of excluded) candidateKeys.delete(key);

  const candidateIds = Array.from(candidateKeys).map((key) => new Types.ObjectId(key));

  // When the personalized candidate union is empty (anonymous caller, or a
  // cold-start viewer with no mutual overlap / app signals / boosts), fall back
  // to popularity-ranked eligible profiles so the surface is never blank and the
  // anonymous case returns the most-followed accounts (not a random sample). The
  // fallback honors the same self/following/excludeIds exclusion set and emits
  // the uniform scored-row shape.
  if (candidateIds.length === 0) {
    const excludeObjectIds = Array.from(excluded).map((key) => new Types.ObjectId(key));
    const fallbackRows = await buildPopularFallback(
      excludeObjectIds,
      excludeTypes,
      parsedLimit,
      parsedOffset,
      minFederatedResolvedAt,
    );
    return fallbackRows.map(formatProfileResult);
  }

  // ---- Single scoring aggregation over the candidate users ----------------
  const repNormDenominator = REP_WEIGHT_NORM_MAX - REP_WEIGHT_NORM_MIN;

  const scoreAddFields = {
    $addFields: {
      mutualCount: { $literal: 0 },
      // completeness = (has avatar + has structured name + has bio/description) / 3
      completenessScore: {
        $divide: [
          {
            $add: [
              { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$avatar', ''] } }, 0] }, 1, 0] },
              {
                $cond: [
                  {
                    $or: [
                      { $gt: [{ $strLenCP: { $ifNull: ['$name.first', ''] } }, 0] },
                      { $gt: [{ $strLenCP: { $ifNull: ['$name.last', ''] } }, 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
              {
                $cond: [
                  {
                    $or: [
                      { $gt: [{ $strLenCP: { $ifNull: ['$bio', ''] } }, 0] },
                      { $gt: [{ $strLenCP: { $ifNull: ['$description', ''] } }, 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            ],
          },
          3,
        ],
      },
      verifiedScore: { $cond: [{ $eq: ['$verified', true] }, 1, 0] },
      // repCandScore = normalize(reputationRankWeight) into [0, 1].
      repCandScore: {
        $max: [
          0,
          {
            $min: [
              1,
              {
                $divide: [
                  {
                    $subtract: [
                      { $ifNull: ['$reputationRankWeight', INFLUENCE_MIN] },
                      REP_WEIGHT_NORM_MIN,
                    ],
                  },
                  repNormDenominator,
                ],
              },
            ],
          },
        ],
      },
    },
  };

  const eligibilityMatch: Record<string, unknown> = {
    'privacySettings.isPrivateAccount': { $ne: true },
    reputationTier: { $ne: 'restricted' },
    ...eligibleUserMatch(minFederatedResolvedAt),
  };
  if (excludeTypes.length > 0) {
    eligibilityMatch.type = { $nin: excludeTypes };
  }

  const matchStage = { $match: { _id: { $in: candidateIds }, ...eligibilityMatch } };

  const rows = await User.aggregate<
    RecommendationRow & {
      reputationRankWeight?: number;
      completenessScore: number;
      verifiedScore: number;
      repCandScore: number;
    }
  >([
    matchStage,
    scoreAddFields,
    // Project the raw profile fields plus the in-aggregation score components.
    // Follower/following counts are intentionally NOT computed here — they are
    // looked up for the final page only (see below), so the scoring pass never
    // pays the per-candidate follower-count lookup for candidates that won't be
    // returned.
    {
      $project: {
        _id: 1,
        username: 1,
        publicKey: 1,
        name: 1,
        avatar: 1,
        description: 1,
        type: 1,
        federation: 1,
        automation: 1,
        verified: 1,
        reputationTier: 1,
        reputationRankWeight: 1,
        completenessScore: 1,
        verifiedScore: 1,
        repCandScore: 1,
      },
    },
  ]);

  // ---- Compose composite score in app code (per-candidate signals live in
  //      the in-memory maps; aggregation-only signals come from the projection).
  const scored = rows.map((row) => {
    const key = row._id.toHexString();
    const mutual = mutualMap.get(key) ?? 0;
    const appSignal = appSignalMap.get(key);
    const endorsement = appSignal?.endorsementScore ?? 0;
    const interest = appSignal?.interestScore ?? 0;
    const boost = boostMap.get(key) ?? 0;
    // Decayed affinity for this candidate, normalized to [0, 1]. Absent → 0.
    const affinityScore = normalizeAffinity(affinityMap.get(key) ?? 0);

    const graphScore = Math.min(mutual / MUTUAL_COUNT_SATURATION, 1);
    const curationScore = Math.max(
      0,
      Math.min(endorsement / ENDORSEMENT_SCORE_SATURATION, 1)
    );
    const completeness = typeof row.completenessScore === 'number' ? row.completenessScore : 0;
    const verifiedScore = typeof row.verifiedScore === 'number' ? row.verifiedScore : 0;
    const repCand = typeof row.repCandScore === 'number'
      ? row.repCandScore
      : normalizeRepWeight(
          typeof row.reputationRankWeight === 'number' ? row.reputationRankWeight : INFLUENCE_MIN
        );

    const terms: Array<[RecommendationSignal, number]> = [
      ['graph', graphScore],
      ['completeness', completeness],
      ['verified', verifiedScore],
      ['curation', curationScore],
      ['interest', interest],
      ['appBoost', boost],
      ['repCandidate', repCand],
      ['affinity', affinityScore],
    ];

    let score = 0;
    const matchedSignals: string[] = [];
    for (const [signal, value] of terms) {
      const contribution = weights[signal] * value;
      score += contribution;
      if (contribution > 0) matchedSignals.push(signal);
    }

    return { row: { ...row, mutualCount: mutual, score, matchedSignals } };
  });

  // Sort by score desc, stable by _id; page with skip/limit.
  scored.sort((a, b) => {
    if (b.row.score !== a.row.score) return b.row.score - a.row.score;
    return a.row._id.toHexString().localeCompare(b.row._id.toHexString());
  });

  const pageRows = scored
    .slice(parsedOffset, parsedOffset + parsedLimit)
    .map((s) => s.row);

  // Follower/following counts are looked up for the PAGE ONLY — a single
  // aggregation over the (≤ limit) returned ids — so the scoring pass never pays
  // the per-candidate count lookup for candidates that fall off the page.
  const pageIds = pageRows.map((row) => row._id);
  const countMap = new Map<string, { followers: number; following: number }>();
  if (pageIds.length > 0) {
    const counted = await User.aggregate<RecommendationRow>([
      { $match: { _id: { $in: pageIds } } },
      ...followCountLookupStages,
      {
        $project: {
          _id: 1,
          followersCount: { $size: '$followersArr' },
          followingCount: { $size: '$followingArr' },
        },
      },
    ]);
    for (const row of counted) {
      countMap.set(row._id.toHexString(), {
        followers: row.followersCount ?? 0,
        following: row.followingCount ?? 0,
      });
    }
  }

  return pageRows.map((row) => {
    const counts = countMap.get(row._id.toHexString());
    return formatProfileResult({
      ...row,
      followersCount: counts?.followers ?? 0,
      followingCount: counts?.following ?? 0,
    });
  });
}

/**
 * Single shared entry point for both the GET and POST recommendation surfaces.
 * Runs the reputation-weighted scored builder (the only recommendation path) and
 * wraps the result in a per-viewer Redis cache (TTL bounded by
 * `REC_CACHE_TTL_SECONDS`) keyed including the viewer id so an anonymous and an
 * authenticated response are never shared. Cache is a best-effort optimization —
 * a null Redis client (REDIS_URL unset) transparently falls back to no cache.
 */
async function buildRecommendations(
  viewerId: string | undefined,
  opts: RecommendationOptions
): Promise<ReturnType<typeof formatProfileResult>[]> {
  const redis = getRedisClient();
  const cacheKey = redis
    ? `rec:v2:${viewerId ?? 'anon'}:${JSON.stringify({
        limit: opts.limit,
        offset: opts.offset,
        excludeTypes: opts.excludeTypes,
        excludeIds: opts.excludeIds,
        clientId: opts.clientId ?? null,
        boosts: opts.boosts ?? null,
        signalWeights: opts.signalWeights ?? null,
      })}`
    : null;

  if (redis && cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as ReturnType<typeof formatProfileResult>[];
      }
    } catch (error) {
      logger.warn('recommendations: cache read failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result = await buildRecommendationsScored(viewerId, opts);

  if (redis && cacheKey) {
    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', REC_CACHE_TTL_SECONDS);
    } catch (error) {
      logger.warn('recommendations: cache write failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * GET /profiles/recommendations
 *
 * Get recommended user profiles. Maps the query string to the shared
 * {@link buildRecommendations}, which runs the reputation-weighted scorer.
 *
 * Optional auth: when a valid session token is present the response is
 * personalized; when absent it returns popular public profiles. Private accounts
 * are always excluded; `excludeTypes` filters federated/agent/automated users.
 *
 * @query {number} limit - Number of results (max 100, default 10)
 * @query {number} offset - Pagination offset (default 0)
 * @query {string} excludeTypes - Comma-separated user types to exclude
 *   (federated, agent, automated)
 * @returns {UserProfile[]} List of recommended profiles
 */
router.get(
  '/recommendations',
  optionalUserOrServiceAuth,
  validatePagination,
  asyncHandler(async (req: OptionalUserOrServiceRequest, res: Response) => {
    const { limit, offset, excludeTypes: excludeTypesRaw } = req.query as PaginationQuery & { excludeTypes?: string };
    const currentUserId = resolveViewerId(req);

    const excludeTypes = parseExcludeTypesQuery(excludeTypesRaw);

    const parsedLimit = limit
      ? Math.min(parseInt(limit, 10), PAGINATION.MAX_LIMIT)
      : PAGINATION.DEFAULT_LIMIT;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    logger.debug('GET /profiles/recommendations', {
      currentUserId: currentUserId ?? null,
      authenticated: !!currentUserId,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    const recommendations = await buildRecommendations(currentUserId, {
      limit: parsedLimit,
      offset: parsedOffset,
      excludeTypes,
      excludeIds: [],
    });

    sendSuccess(res, recommendations);
  })
);

/**
 * POST /profiles/recommendations
 *
 * Rich recommendation surface accepting a JSON body: per-app weight profile
 * (`clientId`), explicit `excludeIds`, editorial `boosts`, and per-request
 * `signalWeights`. Optional auth (same personalization rules as GET). Validates
 * the body against `recommendationRequestSchema`. Shares the exact builder/cache
 * with GET, so identical inputs yield identical output.
 */
router.post(
  '/recommendations',
  optionalUserOrServiceAuth,
  validate({ body: recommendationRequestSchema }),
  asyncHandler(async (req: OptionalUserOrServiceRequest, res: Response) => {
    const currentUserId = resolveViewerId(req);
    const body = req.body as RecommendationRequest;

    const parsedLimit = body.limit ?? PAGINATION.DEFAULT_LIMIT;
    const parsedOffset = body.offset ?? 0;

    // Only honor a clientId the caller is actually entitled to (its own service
    // application, or an application the user actively belongs to). An
    // unauthorized clientId is dropped → no app context.
    const authorizedClientId = await resolveAuthorizedRecommendationClientId(req, body.clientId);

    logger.debug('POST /profiles/recommendations', {
      currentUserId: currentUserId ?? null,
      authenticated: !!currentUserId,
      limit: parsedLimit,
      offset: parsedOffset,
      clientId: authorizedClientId ?? null,
    });

    const recommendations = await buildRecommendations(currentUserId, {
      limit: parsedLimit,
      offset: parsedOffset,
      excludeTypes: body.excludeTypes ?? [],
      excludeIds: body.excludeIds ?? [],
      clientId: authorizedClientId,
      boosts: body.boosts,
      signalWeights: body.signalWeights,
    });

    sendSuccess(res, recommendations);
  })
);

export default router;
