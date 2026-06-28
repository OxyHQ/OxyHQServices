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
import { MAX_FOLLOWING_FOR_MUTUALS } from '../utils/recommendationWeights';

interface UserWithCount {
  _count?: {
    followers?: number;
    following?: number;
  };
}

/**
 * One row of a `$group`-by-id Follow count aggregation: the grouped user id and
 * its follower/following count for that side of the relationship.
 */
interface FollowCountRow {
  _id: Types.ObjectId;
  count: number;
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
 * Per-target outcome of a bulk unfollow operation.
 * - `success: true, wasFollowing: true`   → was followed and has been removed
 * - `success: true, wasFollowing: false`  → valid id that wasn't followed
 *   (desired end state already holds — not following)
 * - `success: false, wasFollowing: false` → invalid id (cannot assert end state)
 */
export interface BulkUnfollowEntry {
  userId: string;
  success: boolean;
  wasFollowing: boolean;
}

/**
 * Result contract for `bulkUnfollow`. `unfollowedCount` counts ONLY follows that
 * were actually removed by this call (excludes ids that were not being
 * followed and structurally-invalid ids).
 */
export interface BulkUnfollowResult {
  results: BulkUnfollowEntry[];
  unfollowedCount: number;
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

/**
 * Normalize a profile `color` value with the SAME canonicalization the User
 * schema applies on save (`trim` + `lowercase`). Running the premium-name check
 * against this normalized value closes a bypass where ` oxy ` / `OXY` would skip
 * the premium gate yet still persist as the gated `oxy` preset. Non-string
 * values are passed through untouched for the caller's own handling.
 */
function normalizeProfileColor(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
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
      .select('-password -refreshToken +phone')
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
      'phone',
      'address',
      'birthday',
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

      const normalizedValue = key === 'color' ? normalizeProfileColor(value) : value;

      // Validate premium-exclusive colors against the SAME normalized value the
      // User schema will persist (trim + lowercase), so ' oxy '/'OXY' can't slip
      // past the premium gate.
      if (key === 'color' && normalizedValue === 'oxy') {
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
      (filteredUpdates as Record<string, unknown>)[key] = normalizedValue;
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
   * Get the MUTUAL followers between a viewer and a target user — "followers you
   * know": users U such that the VIEWER follows U AND U follows `targetUserId`.
   *
   * Optional-viewer semantics (the viewer id is always derived server-side from
   * the auth token by the route, never from a client param):
   * - No viewer (anonymous caller, or a service token with no user context) ⇒
   *   there is no "you follow" set, so the result is an empty page.
   * - A self-target (`viewerId === targetUserId`) has no mutuals with itself ⇒
   *   empty page.
   *
   * The viewer's following set is bounded to the same window the recommendation
   * pipeline uses (`MAX_FOLLOWING_FOR_MUTUALS`) so the `$in` stays small. The
   * returned page mirrors `getUserFollowers`: most-recent mutual first, public
   * DTOs via `formatUserResponse`, and the same `{ data, total, hasMore, limit,
   * offset }` shape.
   */
  async getUserMutuals(
    viewerId: string | undefined,
    targetUserId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResponse<PublicUserProfile>> {
    const limit = Math.min(
      params.limit || PAGINATION.DEFAULT_LIMIT,
      PAGINATION.MAX_LIMIT
    );
    const offset = params.offset || 0;

    const empty = (): PaginatedResponse<PublicUserProfile> => ({
      data: [],
      total: 0,
      hasMore: false,
      limit,
      offset,
    });

    // No viewer ⇒ no "you follow" set; self ⇒ no mutuals with yourself.
    if (!viewerId || viewerId === targetUserId) {
      return empty();
    }

    // 1. The viewer's following set V (bounded — mirrors the recommendations
    //    mutual-overlap window so the `$in` below stays small).
    const viewerFollowing = await Follow.find({
      followerUserId: viewerId,
      followType: FollowType.USER,
    })
      .select('followedId')
      .limit(MAX_FOLLOWING_FOR_MUTUALS)
      .lean();

    const followingIds = viewerFollowing
      .map((follow) => follow.followedId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);

    if (followingIds.length === 0) {
      return empty();
    }

    // 2. Mutuals = the target's followers who are also in V.
    const mutualFilter = {
      followedId: targetUserId,
      followType: FollowType.USER,
      followerUserId: { $in: followingIds },
    };

    const total = await Follow.countDocuments(mutualFilter);
    if (total === 0) {
      return empty();
    }

    const mutualFollows = await Follow.find(mutualFilter)
      .select('followerUserId')
      .limit(limit)
      .skip(offset)
      .sort({ createdAt: -1 })
      .lean();

    const mutualIds = mutualFollows
      .map((follow) => follow.followerUserId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId)
      .map((id) => id.toString());

    // Fetch users directly (returns plain objects, not Mongoose documents)
    const mutuals = await User.find({
      _id: { $in: mutualIds },
    })
      .select('username name avatar color -email')
      .lean()
      .exec() as UserProfile[];

    // Maintain order from the original follow relationships (most-recent first)
    const mutualsMap = new Map(
      mutuals.map((user) => [user._id.toString(), user])
    );
    const orderedMutuals = mutualIds
      .map((id) => mutualsMap.get(id))
      .filter((user): user is UserProfile => user !== undefined)
      .map((user) => this.formatUserResponse(user));

    return {
      data: orderedMutuals,
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
   * Unfollow many users in a single batched operation.
   *
   * Unfollow-only and idempotent: ids that are not currently followed are left
   * untouched and reported as already in the desired (not-following) state. One
   * bad id never fails the whole batch — every deduped candidate (including
   * structurally-invalid ids) gets an entry in the returned `results` array.
   *
   * Efficiency: at most one batched query for existing follows, one bulk delete,
   * and two count-decrement updates — regardless of how many targets are
   * supplied. Does NOT loop over `toggleFollow`.
   *
   * @param currentUserId The follower (authenticated user) id.
   * @param targetUserIds Candidate user ids to unfollow (may contain duplicates,
   *   the caller's own id, or invalid ids).
   * @returns Per-target results and the count of follows actually removed.
   */
  async bulkUnfollow(
    currentUserId: string,
    targetUserIds: string[]
  ): Promise<BulkUnfollowResult> {
    // Dedupe while preserving first-seen order, and drop the caller's own id
    // (cannot self-unfollow). The deduped list drives the results array.
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
          wasFollowing: false,
        })),
        unfollowedCount: 0,
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

    const existingFollowedIds = new Set<string>(
      existingFollows
        .map((follow) => follow.followedId)
        .filter((id): id is Types.ObjectId | string => id != null)
        .map((id) => id.toString())
    );

    // Candidates that are currently followed are the removal set. Keep them
    // ordered (filter candidateIds) so result ordering stays stable.
    const toRemoveIds = candidateIds.filter((id) => existingFollowedIds.has(id));

    let actuallyRemovedIds: string[] = [];

    if (toRemoveIds.length > 0) {
      // Delete each follow with an atomic find-and-delete so concurrent bulk
      // unfollow requests only decrement counters for documents THIS call
      // actually removed. A plain deleteMany() reports only an aggregate
      // deletedCount, which is not enough to safely update each target's
      // follower counter under races (two callers could both observe the same
      // follow as existing and both decrement). Mirrors bulkFollow, where
      // counts derive from the ids actually inserted.
      const deletedFollows = await Promise.all(
        toRemoveIds.map((followedId) =>
          Follow.findOneAndDelete({
            followerUserId: currentUserId,
            followType: FollowType.USER,
            followedId,
          })
            .select('followedId')
            .lean()
        )
      );

      actuallyRemovedIds = deletedFollows
        .map((follow) => follow?.followedId)
        .filter((id): id is Types.ObjectId | string => id != null)
        .map((id) => id.toString());

      // Decrement counts based ONLY on follows actually removed — the exact
      // symmetric inverse of bulkFollow's increment.
      if (actuallyRemovedIds.length > 0) {
        await Promise.all([
          User.updateMany(
            { _id: { $in: actuallyRemovedIds } },
            { $inc: { '_count.followers': -1 } }
          ),
          User.findByIdAndUpdate(currentUserId, {
            $inc: { '_count.following': -actuallyRemovedIds.length },
          }),
        ]);
      }
    }

    const removedSet = new Set<string>(actuallyRemovedIds);
    const candidateSet = new Set<string>(candidateIds);

    // Build a result entry for EVERY deduped candidate id (including invalid
    // ones that never reached the queries).
    const results: BulkUnfollowEntry[] = dedupedIds.map((userId) => {
      if (removedSet.has(userId)) {
        return { userId, success: true, wasFollowing: true };
      }
      if (candidateSet.has(userId)) {
        // Valid id, wasn't followed — desired (not-following) state already holds.
        return { userId, success: true, wasFollowing: false };
      }
      // Invalid id — cannot assert it is now not-followed.
      return { userId, success: false, wasFollowing: false };
    });

    return {
      results,
      unfollowedCount: actuallyRemovedIds.length,
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
   * Batch-resolve PUBLIC user DTOs for a set of ids.
   *
   * Returns the SAME shape as `GET /users/:id` (`formatUserResponse`), including
   * canonical `name.displayName` and an `_count: { followers, following }` block
   * for every returned user. Designed for server-to-server fan-out (e.g. Mention
   * feed hydration) so callers avoid N+1 `GET /users/:id` round-trips.
   *
   * Efficiency contract: at most THREE queries total regardless of `ids.length`
   * — one `User.find({ _id: $in })` and two `Follow` group-by-id aggregations
   * (followers + following), keyed by the whole id set. No per-user query.
   *
   * Resilient to bad input: ids that are not valid ObjectIds (or that match no
   * user) are silently dropped — the result only contains resolved users. The
   * caller is responsible for any "missing id" handling. Order is NOT guaranteed
   * to match the input order.
   *
   * @param ids - Candidate user ids (ObjectId strings).
   * @returns Array of public user DTOs, each with `_count`.
   */
  async getUsersByIds(ids: string[]): Promise<PublicUserProfile[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    if (objectIds.length === 0) {
      return [];
    }

    // One batched user fetch. `lean({ virtuals: true })` populates `name.full`
    // (schema virtual) which `formatUserNameResponse` consumes. The typed lean
    // generic yields plain `IUser` objects so `formatUserResponse` (which reads
    // `publicKey`, `type`, `federation`, etc.) sees the full profile shape.
    const users = await User.find({ _id: { $in: objectIds } })
      .select('-password -refreshToken')
      .lean<IUser[]>({ virtuals: true });

    if (users.length === 0) {
      return [];
    }

    // Two batched count aggregations keyed by the whole id set (not per-user):
    // followers (others following the user) and following (the user follows
    // others). Each is a single grouped query over the `follows` collection.
    const [followerRows, followingRows] = await Promise.all([
      Follow.aggregate<FollowCountRow>([
        {
          $match: {
            followedId: { $in: objectIds },
            followType: FollowType.USER,
          },
        },
        { $group: { _id: '$followedId', count: { $sum: 1 } } },
      ]),
      Follow.aggregate<FollowCountRow>([
        {
          $match: {
            followerUserId: { $in: objectIds },
            followType: FollowType.USER,
          },
        },
        { $group: { _id: '$followerUserId', count: { $sum: 1 } } },
      ]),
    ]);

    const followersById = new Map<string, number>(
      followerRows.map((row) => [String(row._id), row.count])
    );
    const followingById = new Map<string, number>(
      followingRows.map((row) => [String(row._id), row.count])
    );

    return users.map((user) => {
      const key = user._id?.toString() ?? '';
      return this.formatUserResponse(user, {
        followers: followersById.get(key) ?? 0,
        following: followingById.get(key) ?? 0,
      });
    });
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
  formatUserResponse(
    user: IUser | UserProfile,
    stats?: UserStatistics,
    options: { includePrivateFields?: boolean } = {}
  ): PublicUserProfile {
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

    if (options.includePrivateFields) {
      response.phone = userAny.phone as string | undefined;
      response.address = userAny.address as string | undefined;
      response.birthday = userAny.birthday as string | undefined;
    }

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
