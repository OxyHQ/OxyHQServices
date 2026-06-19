/**
 * User Service
 * 
 * Business logic layer for user-related operations.
 * Separates route handlers from business logic for better testability and maintainability.
 */

import User, { IUser } from '../models/User';
import Follow, { FollowType } from '../models/Follow';
import { logger } from '../utils/logger';
import { Types } from 'mongoose';
import userCache from '../utils/userCache';
import securityActivityService from './securityActivityService';
import { sanitizeProfileUpdate } from '../utils/sanitize';
import { Request } from 'express';
import {
  PaginationParams,
  PaginatedResponse,
  PublicUserProfile,
  ProfileUpdateInput,
  UserProfile,
  UserStatistics,
  FollowActionResult,
} from '../types/user.types';
import Subscription from '../models/Subscription';
import { formatUserNameResponse, type NameParts } from '../utils/displayName';

// Constants
import { PAGINATION } from '../utils/constants';

interface UserWithCount {
  _count?: {
    followers?: number;
    following?: number;
  };
}

/**
 * Per-target outcome of a bulk follow operation.
 * - `success: true, alreadyFollowing: false`  → newly followed
 * - `success: true, alreadyFollowing: true`   → already followed (no-op / raced)
 * - `success: false, alreadyFollowing: false` → invalid id, non-existent user, or self
 */
export interface BulkFollowEntry {
  userId: string;
  success: boolean;
  alreadyFollowing: boolean;
}

/**
 * Result contract for `bulkFollow`. `followedCount` counts ONLY follows that
 * were newly created by this call (excludes already-following and raced
 * duplicate inserts).
 */
export interface BulkFollowResult {
  results: BulkFollowEntry[];
  followedCount: number;
}

/**
 * Shape of a Mongoose bulk-write / insertMany error. `insertMany` with
 * `{ ordered: false }` surfaces per-document failures under `writeErrors`,
 * each carrying the failing document `index` and the underlying driver
 * `err.code` (11000 for a duplicate key). A single-document failure may
 * instead expose `code` directly on the error.
 */
interface BulkWriteLikeError {
  writeErrors?: Array<{ err?: { code?: number }; index?: number; code?: number }>;
  code?: number;
}

function isBulkWriteLikeError(error: unknown): error is BulkWriteLikeError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { writeErrors?: unknown; code?: unknown };
  return Array.isArray(candidate.writeErrors) || typeof candidate.code === 'number';
}

export class UserService {
  /**
   * Get user by ID with proper serialization
   */
  async getUserById(userId: string): Promise<IUser | null> {
    return await User.findById(userId)
      .select('-password -refreshToken')
      .lean({ virtuals: true }) as IUser | null;
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(userId: string): Promise<IUser | null> {
    // `lean({ virtuals: true })` populates `name.full` from the User schema virtual.
    return await User.findById(userId)
      .select('-password -refreshToken')
      .lean({ virtuals: true }) as IUser | null;
  }

  /**
   * Update user profile
   * Handles MongoDB language field conflict with text indexes
   */
  async updateUserProfile(
    userId: string,
    updates: ProfileUpdateInput,
    req?: Request
  ): Promise<IUser> {
    // Allowed fields for updates
    const allowedFields = [
      'name',
      'email',
      'username',
      'avatar',
      'color',
      'bio',
      'description',
      'links',
      'linksMetadata',
      'locations',
      'language',
      'accountExpiresAfterInactivityDays',
      'notificationPreferences',
      'userPreferences',
    ] as const;

    // Sanitize text fields to prevent XSS
    const sanitizedUpdates = sanitizeProfileUpdate(updates as Record<string, unknown>) as ProfileUpdateInput;

    // Filter and validate updates
    const filteredUpdates: Partial<ProfileUpdateInput> = {};

    for (const [key, value] of Object.entries(sanitizedUpdates)) {
      if (!(allowedFields as readonly string[]).includes(key)) continue;
      
      if (key === 'avatar') {
        if (typeof value === 'string') {
          filteredUpdates.avatar = value;
        }
        continue;
      }

      // Validate premium-exclusive colors
      if (key === 'color' && value === 'oxy') {
        const user = await User.findById(userId).select('username').lean();
        const isOxyUser = user?.username?.toLowerCase() === 'oxy';
        if (!isOxyUser) {
          const subscription = await Subscription.findOne({
            userId,
            status: 'active',
            plan: { $in: ['pro', 'business'] },
          }).lean();
          if (!subscription) {
            throw new Error('The oxy color is exclusive to premium subscribers');
          }
        }
      }

      // Validate accountExpiresAfterInactivityDays
      if (key === 'accountExpiresAfterInactivityDays') {
        if (value !== null && value !== undefined) {
          const validValues = [30, 90, 180, 365];
          if (!validValues.includes(value as number)) {
            throw new Error('accountExpiresAfterInactivityDays must be 30, 90, 180, 365, or null');
          }
        }
      }
      
      // Assign other fields
      (filteredUpdates as Record<string, unknown>)[key] = value;
    }

    // Validate uniqueness constraints
    await this.validateUniqueFields(userId, filteredUpdates);

    // Handle language field separately to avoid MongoDB text index conflict
    const { language, ...otherUpdates } = filteredUpdates;

    // Fetch user document to update
    const user = await User.findById(userId).select('-password -refreshToken');
    if (!user) {
      throw new Error('User not found');
    }

    // Track email change for security logging
    const oldEmail = user.email;
    const emailChanged = otherUpdates.email && otherUpdates.email !== oldEmail;

    // Update language directly on document to avoid MongoDB conflict
    if (language !== undefined) {
      user.set('language', language);
    }

    // Update other fields directly on the document
    Object.entries(otherUpdates).forEach(([key, value]) => {
      user.set(key, value);
    });

    // Save the document - this ensures all Mongoose middleware and validation runs
    await user.save();

    // Invalidate the in-memory user cache so the next session-bound lookup
    // (getUserBySession, validateSessionById) re-reads from MongoDB and
    // serves the just-updated avatar/name/etc. Without this, the cache
    // returns the pre-write document and clients see their update silently
    // revert on the next refetch.
    userCache.invalidate(userId);

    // Log security events
    try {
      const updatedFields = Object.keys(otherUpdates);
      
      // Log email change if it occurred
      if (emailChanged && oldEmail && otherUpdates.email) {
        await securityActivityService.logEmailChange(
          userId,
          oldEmail,
          otherUpdates.email,
          req
        );
      }
      
      // Log profile update (excluding email which is logged separately)
      const profileFields = updatedFields.filter(field => field !== 'email');
      if (profileFields.length > 0) {
        await securityActivityService.logProfileUpdate(
          userId,
          profileFields,
          req
        );
      }
    } catch (error) {
      // Don't fail the update if logging fails
      logger.error('Failed to log security event for profile update:', error);
    }

    // Convert to plain object with virtuals
    const userObj = user.toObject({ virtuals: true }) as IUser;

    // Ensure name.full exists
    if (userObj.name && typeof userObj.name === 'object') {
      const first = (userObj.name.first as string) || '';
      const last = (userObj.name.last as string) || '';
      if (!('full' in userObj.name) || !userObj.name.full) {
        userObj.name.full = [first, last].filter(Boolean).join(' ').trim();
      }
    }

    return userObj;
  }

  /**
   * Validate unique fields (email, username)
   */
  private async validateUniqueFields(
    userId: string,
    updates: Partial<ProfileUpdateInput>
  ): Promise<void> {
    if (updates.email) {
      const existing = await User.findOne({
        email: updates.email,
        _id: { $ne: userId },
      });
      if (existing) {
        throw new Error('Email already exists');
      }
    }

    if (updates.username) {
      const existing = await User.findOne({
        username: updates.username,
        _id: { $ne: userId },
      });
      if (existing) {
        throw new Error('Username already exists');
      }
    }
  }

  /**
   * Get user followers with pagination
   */
  async getUserFollowers(
    userId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResponse<PublicUserProfile>> {
    const limit = Math.min(
      params.limit || PAGINATION.DEFAULT_LIMIT,
      PAGINATION.MAX_LIMIT
    );
    const offset = params.offset || 0;

    const total = await Follow.countDocuments({
      followedId: userId,
      followType: FollowType.USER,
    });

    // Get follow relationships
    const follows = await Follow.find({
      followedId: userId,
      followType: FollowType.USER,
    })
      .select('followerUserId')
      .limit(limit)
      .skip(offset)
      .sort({ createdAt: -1 })
      .lean();

    // Extract user IDs
    const followerIds = follows
      .map((follow) => follow.followerUserId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId)
      .map((id) => id.toString());

    // Fetch users directly (returns plain objects, not Mongoose documents)
    const followers = await User.find({
      _id: { $in: followerIds },
    })
      .select('username name avatar color -email')
      .lean()
      .exec() as UserProfile[];

    // Maintain order from original follow relationships
    const followersMap = new Map(
      followers.map((user) => [user._id.toString(), user])
    );
    const orderedFollowers = followerIds
      .map((id) => followersMap.get(id))
      .filter((user): user is UserProfile => user !== undefined)
      .map((user) => this.formatUserResponse(user));

    return {
      data: orderedFollowers,
      total,
      hasMore: offset + limit < total,
      limit,
      offset,
    };
  }

  /**
   * Get user following with pagination
   */
  async getUserFollowing(
    userId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResponse<PublicUserProfile>> {
    const limit = Math.min(
      params.limit || PAGINATION.DEFAULT_LIMIT,
      PAGINATION.MAX_LIMIT
    );
    const offset = params.offset || 0;

    const total = await Follow.countDocuments({
      followerUserId: userId,
      followType: FollowType.USER,
    });

    // Get follow relationships
    const follows = await Follow.find({
      followerUserId: userId,
      followType: FollowType.USER,
    })
      .select('followedId')
      .limit(limit)
      .skip(offset)
      .sort({ createdAt: -1 })
      .lean();

    // Extract user IDs
    const followingIds = follows
      .map((follow) => follow.followedId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId)
      .map((id) => id.toString());

    // Fetch users directly (returns plain objects, not Mongoose documents)
    const following = await User.find({
      _id: { $in: followingIds },
    })
      .select('username name avatar color -email')
      .lean()
      .exec() as UserProfile[];

    // Maintain order from original follow relationships
    const followingMap = new Map(
      following.map((user) => [user._id.toString(), user])
    );
    const orderedFollowing = followingIds
      .map((id) => followingMap.get(id))
      .filter((user): user is UserProfile => user !== undefined)
      .map((user) => this.formatUserResponse(user));

    return {
      data: orderedFollowing,
      total,
      hasMore: offset + limit < total,
      limit,
      offset,
    };
  }

  /**
   * Follow or unfollow a user
   */
  async toggleFollow(
    currentUserId: string,
    targetUserId: string
  ): Promise<FollowActionResult> {
    if (currentUserId === targetUserId) {
      throw new Error('Cannot follow yourself');
    }

    // Verify both users exist
    const [targetUser, currentUser] = await Promise.all([
      User.findById(targetUserId),
      User.findById(currentUserId),
    ]);

    if (!targetUser || !currentUser) {
      throw new Error('User not found');
    }

    // Federated users are always public — their privacy settings are governed
    // by their home instance, not by Oxy privacy controls.
    const isFederatedTarget = (targetUser as unknown as { type?: string }).type === 'federated';

    // Check existing follow relationship
    const existingFollow = await Follow.findOne({
      followerUserId: currentUserId,
      followType: FollowType.USER,
      followedId: targetUserId,
    });

    if (existingFollow) {
      // Unfollow
      await Promise.all([
        Follow.deleteOne({ _id: existingFollow._id }),
        User.findByIdAndUpdate(targetUserId, { $inc: { '_count.followers': -1 } }),
        User.findByIdAndUpdate(currentUserId, { $inc: { '_count.following': -1 } }),
      ]);

      const [updatedTarget, updatedCurrent] = await Promise.all([
        User.findById(targetUserId).select('_count').lean(),
        User.findById(currentUserId).select('_count').lean(),
      ]);

      const targetCounts = (updatedTarget as UserWithCount)?._count;
      const currentCounts = (updatedCurrent as UserWithCount)?._count;

      return {
        action: 'unfollow',
        counts: {
          followers: targetCounts?.followers ?? 0,
          following: currentCounts?.following ?? 0,
        },
      };
    }

    // Follow
    await Promise.all([
      Follow.create({
        followerUserId: currentUserId,
        followType: FollowType.USER,
        followedId: targetUserId,
      }),
      User.findByIdAndUpdate(targetUserId, { $inc: { '_count.followers': 1 } }),
      User.findByIdAndUpdate(currentUserId, { $inc: { '_count.following': 1 } }),
    ]);

    const [updatedTarget, updatedCurrent] = await Promise.all([
      User.findById(targetUserId).select('_count').lean(),
      User.findById(currentUserId).select('_count').lean(),
    ]);

    const targetCounts = (updatedTarget as UserWithCount)?._count;
    const currentCounts = (updatedCurrent as UserWithCount)?._count;

    return {
      action: 'follow',
      counts: {
        followers: targetCounts?.followers ?? 0,
        following: currentCounts?.following ?? 0,
      },
    };
  }

  /**
   * Follow many users in a single batched operation.
   *
   * Follow-only and idempotent: users already followed stay followed and are
   * never toggled/unfollowed. One bad id never fails the whole batch — every
   * deduped candidate (including structurally-invalid ids) gets an entry in the
   * returned `results` array.
   *
   * Efficiency: at most one batched query for existing follows, one for user
   * existence, one bulk insert, and two count-increment updates — regardless of
   * how many targets are supplied. Does NOT loop over `toggleFollow`.
   *
   * @param currentUserId The follower (authenticated user) id.
   * @param targetUserIds Candidate user ids to follow (may contain duplicates,
   *   the caller's own id, or invalid ids).
   * @returns Per-target results and the count of NEWLY created follows.
   */
  async bulkFollow(
    currentUserId: string,
    targetUserIds: string[]
  ): Promise<BulkFollowResult> {
    // Dedupe while preserving first-seen order, and drop the caller's own id
    // (cannot self-follow). The deduped list drives the results array.
    const seen = new Set<string>();
    const dedupedIds: string[] = [];
    for (const rawId of targetUserIds) {
      if (typeof rawId !== 'string') continue;
      const id = rawId.trim();
      if (!id || id === currentUserId || seen.has(id)) continue;
      seen.add(id);
      dedupedIds.push(id);
    }

    // Partition into structurally-valid candidates (safe to query) and invalid
    // ids. Invalid ids must never enter the `$in` queries.
    const candidateIds = dedupedIds.filter((id) => Types.ObjectId.isValid(id));

    // No queryable candidates — return graceful failures for every deduped id.
    if (candidateIds.length === 0) {
      return {
        results: dedupedIds.map((userId) => ({
          userId,
          success: false,
          alreadyFollowing: false,
        })),
        followedCount: 0,
      };
    }

    // ONE batched query for follows that already exist.
    const existingFollows = await Follow.find({
      followerUserId: currentUserId,
      followType: FollowType.USER,
      followedId: { $in: candidateIds },
    })
      .select('followedId')
      .lean();

    const alreadyFollowedIds = new Set<string>(
      existingFollows
        .map((follow) => follow.followedId)
        .filter((id): id is Types.ObjectId | string => id != null)
        .map((id) => id.toString())
    );

    // ONE batched query to verify which candidates correspond to real users.
    const existingUsers = await User.find({
      _id: { $in: candidateIds },
    })
      .select('_id')
      .lean();

    const existingUserIds = new Set<string>(
      existingUsers.map((user) => user._id.toString())
    );

    // Candidates that exist and are not yet followed are the insert set. Keep
    // them ordered so write-error indexes map back to the right id.
    const toInsertIds = candidateIds.filter(
      (id) => existingUserIds.has(id) && !alreadyFollowedIds.has(id)
    );

    // Track ids that lost a concurrency race (E11000) so we treat them as
    // already-following rather than newly created.
    const racedDuplicateIds = new Set<string>();
    let newlyFollowedIds: string[] = [];

    if (toInsertIds.length > 0) {
      const docs = toInsertIds.map((id) => ({
        followerUserId: currentUserId,
        followType: FollowType.USER,
        followedId: id,
      }));

      try {
        await Follow.insertMany(docs, { ordered: false });
        newlyFollowedIds = toInsertIds;
      } catch (error: unknown) {
        if (!isBulkWriteLikeError(error)) {
          // Unexpected, non-duplicate failure — surface it.
          logger.error(
            'Bulk follow insert failed',
            error instanceof Error ? error : new Error(String(error)),
            { currentUserId, attempted: toInsertIds.length }
          );
          throw error;
        }

        const writeErrors = error.writeErrors ?? [];
        const duplicateIndexes = new Set<number>();
        let sawNonDuplicate = false;

        if (writeErrors.length > 0) {
          for (const writeError of writeErrors) {
            const code = writeError.err?.code ?? writeError.code;
            if (code === 11000) {
              if (typeof writeError.index === 'number') {
                duplicateIndexes.add(writeError.index);
              }
            } else {
              sawNonDuplicate = true;
            }
          }
        } else if (error.code === 11000) {
          // Single-document duplicate failure (no per-doc writeErrors array).
          // With `ordered:false` and multiple docs this is unusual, but handle
          // it: every attempted id collided.
          for (let i = 0; i < toInsertIds.length; i += 1) {
            duplicateIndexes.add(i);
          }
        } else {
          sawNonDuplicate = true;
        }

        // Any failure that is NOT a duplicate key is unexpected — do not
        // silently swallow it.
        if (sawNonDuplicate) {
          logger.error(
            'Bulk follow insert failed with non-duplicate write error',
            error instanceof Error ? error : new Error(String(error)),
            { currentUserId, attempted: toInsertIds.length }
          );
          throw error;
        }

        // Newly inserted = attempted minus those that collided (raced).
        toInsertIds.forEach((id, index) => {
          if (duplicateIndexes.has(index)) {
            racedDuplicateIds.add(id);
          } else {
            newlyFollowedIds.push(id);
          }
        });
      }
    }

    // Increment counts based ONLY on newly created follows.
    if (newlyFollowedIds.length > 0) {
      await Promise.all([
        User.updateMany(
          { _id: { $in: newlyFollowedIds } },
          { $inc: { '_count.followers': 1 } }
        ),
        User.findByIdAndUpdate(currentUserId, {
          $inc: { '_count.following': newlyFollowedIds.length },
        }),
      ]);
    }

    const newlyFollowedSet = new Set<string>(newlyFollowedIds);

    // Build a result entry for EVERY deduped candidate id (including invalid
    // ones that never reached the queries).
    const results: BulkFollowEntry[] = dedupedIds.map((userId) => {
      if (newlyFollowedSet.has(userId)) {
        return { userId, success: true, alreadyFollowing: false };
      }
      if (alreadyFollowedIds.has(userId) || racedDuplicateIds.has(userId)) {
        return { userId, success: true, alreadyFollowing: true };
      }
      // Invalid id, non-existent user, or genuinely failed.
      return { userId, success: false, alreadyFollowing: false };
    });

    return {
      results,
      followedCount: newlyFollowedIds.length,
    };
  }

  /**
   * Check if current user is following target user
   */
  async isFollowing(
    currentUserId: string,
    targetUserId: string
  ): Promise<boolean> {
    const follow = await Follow.findOne({
      followerUserId: currentUserId,
      followType: FollowType.USER,
      followedId: targetUserId,
    });

    return !!follow;
  }

  /**
   * Get user statistics (followers, following)
   */
  async getUserStats(userId: string): Promise<UserStatistics> {
    const [followersCount, followingCount] = await Promise.all([
      Follow.countDocuments({
        followedId: userId,
        followType: FollowType.USER,
      }),
      Follow.countDocuments({
        followerUserId: userId,
        followType: FollowType.USER,
      }),
    ]);

    return {
      followers: followersCount,
      following: followingCount,
    };
  }

  /**
   * Format user response with stats
   */
  formatUserResponse(user: IUser | UserProfile, stats?: UserStatistics): PublicUserProfile {
    // Handle both IUser (Mongoose document) and UserData (plain object)
    // Use publicKey as id - publicKey is the primary identifier, fallback to _id
    const userAsIUser = user as IUser;
    const userId = userAsIUser.publicKey || userAsIUser._id?.toString();
    if (!userId) {
      throw new Error('User must have a publicKey or _id');
    }
    const userAny = user as unknown as Record<string, unknown>;

    const response: PublicUserProfile = {
      id: userId,
      username: user.username,
      name: formatUserNameResponse({
        name: user.name as NameParts | undefined,
        username: user.username,
        publicKey: userAsIUser.publicKey,
      }),
      avatar: user.avatar,
      verified: userAny.verified as boolean | undefined,
      bio: userAny.bio as string | undefined,
      description: userAny.description as string | undefined,
      color: userAny.color as string | undefined,
      links: userAny.links as string[] | undefined,
      linksMetadata: userAny.linksMetadata as unknown,
      createdAt: userAny.createdAt as Date | undefined,
      updatedAt: userAny.updatedAt as Date | undefined,
    };

    if (userAny.type) {
      response.type = userAny.type;
    }
    if (userAny.federation) {
      response.federation = userAny.federation;
    }
    response.isFederated = userAny.type === 'federated';

    if (stats) {
      response._count = stats;
    }

    return response;
  }
}

// Export singleton instance
export const userService = new UserService();
export default userService;
