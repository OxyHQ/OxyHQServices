/**
 * User Service
 * 
 * Business logic layer for user-related operations.
 * Separates route handlers from business logic for better testability and maintainability.
 */

import User, { IUser } from '../models/User';
import Follow, { FollowType } from '../models/Follow';
import Block from '../models/Block';
import { logger } from '../utils/logger';
import { Types } from 'mongoose';
import userCache from '../utils/userCache';
import securityActivityService from './securityActivityService';
import { sanitizeProfileUpdate } from '../utils/sanitize';
import { isValidDisplayName } from '../utils/displayNameSanitize';
import {
  normalizeLinks,
  normalizeLinksMetadata,
  normalizeLocations,
  normalizeProfileName,
} from '../utils/profileTextNormalization';
import { INVALID_USERNAME_MESSAGE, USERNAME_PATTERN, normalizeUsername } from '../utils/username';
import { BadRequestError } from '../utils/error';
import { Request } from 'express';
import {
  PaginationParams,
  PaginatedResponse,
  PublicUserProfile,
  ProfileUpdateInput,
  UserStatistics,
  FollowActionResult,
  ViewerGraph,
} from '../types/user.types';
import {
  PUBLIC_USER_PROFILE_SELECT,
  type PublicUserDocument,
} from '../utils/publicUserProjection';
import Subscription from '../models/Subscription';
import { userIdentityFields, deriveIsFederated } from '../utils/userTransform';
import { normalizeLocale } from '@oxyhq/core';

// Constants
import { PAGINATION } from '../utils/constants';
import {
  MAX_FOLLOWING_FOR_MUTUALS,
  MAX_MUTUAL_IDS,
  MAX_FOLLOWS_OF_FOLLOWS_IDS,
  MAX_FOF_FIRST_HOP,
  MAX_FOLLOWING_IDS,
  MAX_BLOCKED_IDS,
} from '../utils/recommendationWeights';
import graphCache from '../utils/graphCache';

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
 * One row of the follows-of-follows aggregation: a candidate user id, how many
 * of the viewer's follows follow that candidate (frequency), and the most-recent
 * time any of them did so (the recency tiebreak).
 */
interface FollowsOfFollowsRow {
  _id: Types.ObjectId;
  followerCount: number;
  lastFollowedAt: Date;
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

/** Follower/following totals for the two sides of a follow edge. */
export interface FollowCounts {
  followers: number;
  following: number;
}

/**
 * Result of the `followUser` primitive. `created` is `true` only when THIS call
 * inserted the edge; a repeated call on an already-existing edge is an
 * idempotent no-op that reports `created: false` and leaves the counters
 * untouched.
 */
export interface FollowUserResult {
  created: boolean;
  counts: FollowCounts;
}

/**
 * Result of the `unfollowUser` primitive. `removed` is `true` only when THIS
 * call deleted the edge; unfollowing an edge that does not exist is an
 * idempotent no-op that reports `removed: false` and leaves the counters
 * untouched.
 */
export interface UnfollowUserResult {
  removed: boolean;
  counts: FollowCounts;
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

/**
 * Canonicalize ONE profile-update field into exactly the form that will be
 * persisted. Every field whose value carries human- or third-party-authored text
 * is normalized here, at the single write chokepoint, so no caller can store a
 * value that a client would then render with `white-space: pre-wrap` intact.
 *
 * `bio` / `description` / `address` and the other free-text fields are already
 * normalized upstream by `sanitizeProfileUpdate` (which delegates to the
 * canonical multiline normalizer); the fields listed here are the ones it
 * deliberately skips because they are structured, not plain strings.
 *
 * Fields with no text of their own (avatar id, birthday, preference objects,
 * …) pass through untouched.
 */
function normalizeProfileField(key: string, value: unknown): unknown {
  switch (key) {
    case 'color':
      return normalizeProfileColor(value);
    case 'name':
      return normalizeProfileName(value);
    case 'username':
      return typeof value === 'string' ? normalizeUsername(value) : value;
    case 'linksMetadata':
      return normalizeLinksMetadata(value);
    case 'locations':
      return normalizeLocations(value);
    case 'links':
      return normalizeLinks(value);
    default:
      return value;
  }
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
   * Update user profile.
   *
   * Filters the input to an allowlist, validates each field at the boundary
   * (display name, color/premium gate, account locales, expiry), then applies
   * the changes through the Mongoose document so all schema validation and
   * middleware run on save.
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
      'languages',
      'accountExpiresAfterInactivityDays',
      'notificationPreferences',
      'userPreferences',
    ] as const;

    // Reject invalid native display names (letters/spaces/apostrophe only).
    // Federated writes strip silently via cleanDisplayName; native edits get a
    // 400 so the user corrects the name at the source. Runs BEFORE sanitization
    // so the validation sees the user's raw input.
    if (updates.name && typeof updates.name === 'object') {
      for (const part of ['first', 'last'] as const) {
        const value = updates.name[part];
        if (typeof value === 'string' && !isValidDisplayName(value)) {
          throw new BadRequestError('Name may only contain letters, spaces and apostrophes.');
        }
      }
    }

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

      // Canonicalize the value into EXACTLY the form that will be persisted,
      // before it is validated or compared — see `normalizeProfileField`.
      const normalizedValue = normalizeProfileField(key, value);

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

      // Account locales — the ONLY language field (no singular `language`). Each
      // entry must resolve to a supported BCP-47 locale; we persist the CANONICAL
      // `language-REGION` form (`normalizeLocale`) with order preserved and
      // duplicates dropped, and reject anything unsupported at the boundary with a
      // structured 400.
      if (key === 'languages') {
        if (!Array.isArray(value)) {
          throw new BadRequestError('languages must be an array of locale codes', {
            field: 'languages',
          });
        }
        const normalizedLocales: string[] = [];
        for (const entry of value) {
          const canonical = typeof entry === 'string' ? normalizeLocale(entry) : undefined;
          if (!canonical) {
            throw new BadRequestError('Unsupported locale', {
              field: 'languages',
              value: entry,
            });
          }
          if (!normalizedLocales.includes(canonical)) {
            normalizedLocales.push(canonical);
          }
        }
        (filteredUpdates as Record<string, unknown>).languages = normalizedLocales;
        continue;
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

    // Fetch user document to update
    const user = await User.findById(userId).select('-password -refreshToken');
    if (!user) {
      throw new Error('User not found');
    }

    // A username is a routing key (`/@alice`, `acct:alice@…`), not prose: it must
    // satisfy the same 3–30 ASCII-alphanumeric policy signup enforces, which in
    // particular admits no whitespace at all. Only an actual CHANGE is validated:
    // clients that PUT the whole profile back echo the stored username, and a
    // value that predates this policy must not make an unrelated bio edit fail.
    const nextUsername = filteredUpdates.username;
    if (
      typeof nextUsername === 'string' &&
      nextUsername !== user.username &&
      !USERNAME_PATTERN.test(nextUsername)
    ) {
      throw new BadRequestError(INVALID_USERNAME_MESSAGE, { field: 'username' });
    }

    // Validate uniqueness constraints
    await this.validateUniqueFields(userId, filteredUpdates);

    // Track email change for security logging
    const oldEmail = user.email;
    const emailChanged = filteredUpdates.email && filteredUpdates.email !== oldEmail;

    // Apply the validated updates directly on the document. Saving through the
    // document (not an atomic update) ensures all Mongoose middleware and
    // validation runs.
    Object.entries(filteredUpdates).forEach(([key, value]) => {
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
      const updatedFields = Object.keys(filteredUpdates);

      // Log email change if it occurred
      if (emailChanged && oldEmail && filteredUpdates.email) {
        await securityActivityService.logEmailChange(
          userId,
          oldEmail,
          filteredUpdates.email,
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

    // Convert to plain object with virtuals. The User schema's toObject
    // transform DELETES `_id` (it emits the client `id` shape). `formatUserResponse`
    // is a server-side serializer that resolves identity from `_id` (falling back
    // to `id`), so a keyless managed/org account would otherwise reach it with
    // neither field and throw "User must have an _id". Re-attach `_id` so the
    // serializer can identify keyless accounts.
    const userObj = user.toObject({ virtuals: true }) as IUser;
    userObj._id = user._id;

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
      .select(PUBLIC_USER_PROFILE_SELECT)
      .lean<PublicUserDocument[]>()
      .exec();

    // Maintain order from original follow relationships
    const followersMap = new Map(
      followers.map((user) => [user._id.toString(), user])
    );
    const orderedFollowers = followerIds
      .map((id) => followersMap.get(id))
      .filter((user): user is PublicUserDocument => user !== undefined)
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
      .select(PUBLIC_USER_PROFILE_SELECT)
      .lean<PublicUserDocument[]>()
      .exec();

    // Maintain order from original follow relationships
    const followingMap = new Map(
      following.map((user) => [user._id.toString(), user])
    );
    const orderedFollowing = followingIds
      .map((id) => followingMap.get(id))
      .filter((user): user is PublicUserDocument => user !== undefined)
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
      .select(PUBLIC_USER_PROFILE_SELECT)
      .lean<PublicUserDocument[]>()
      .exec();

    // Maintain order from the original follow relationships (most-recent first)
    const mutualsMap = new Map(
      mutuals.map((user) => [user._id.toString(), user])
    );
    const orderedMutuals = mutualIds
      .map((id) => mutualsMap.get(id))
      .filter((user): user is PublicUserDocument => user !== undefined)
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
   * Get the VIEWER's OWN mutual-follow user ids — the accounts the viewer follows
   * that ALSO follow the viewer back (a bidirectional follow edge). This is the
   * SELF intersection `following(viewer) ∩ followers(viewer)`.
   *
   * Distinct from {@link getUserMutuals} ("followers you know" about ANOTHER
   * profile, which returns hydrated DTOs and is empty for a self-target). This
   * method is lean and ids-only on purpose: it SEEDS Mention's "Mutuals" feed,
   * which then hydrates and ranks the mutuals' posts itself, so shipping bare ids
   * (not profile DTOs) keeps the payload small.
   *
   * The viewer id is ALWAYS derived server-side by the route (`resolveViewerId`),
   * never a client param. An anonymous caller (or a service token with no user
   * context) has no "you follow" set ⇒ empty. A viewer who follows nobody
   * short-circuits before the second query.
   *
   * Bounded by `MAX_MUTUAL_IDS`: both the following window scanned AND the number
   * of ids returned are capped, so the `$in` and the payload stay small. When the
   * viewer has more mutuals than the cap, the most-recently-established mutuals
   * are returned first (`createdAt` desc).
   */
  async getMutualUserIds(
    viewerId: string | undefined,
    params: { limit?: number } = {}
  ): Promise<string[]> {
    if (!viewerId) {
      return [];
    }

    const limit = Math.min(
      params.limit && params.limit > 0 ? params.limit : MAX_MUTUAL_IDS,
      MAX_MUTUAL_IDS
    );

    // 1. The viewer's following set (bounded so the `$in` below stays small).
    const viewerFollowing = await Follow.find({
      followerUserId: viewerId,
      followType: FollowType.USER,
    })
      .select('followedId')
      .limit(MAX_MUTUAL_IDS)
      .lean();

    const followingIds = viewerFollowing
      .map((follow) => follow.followedId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);

    if (followingIds.length === 0) {
      return [];
    }

    // 2. Of those, the accounts that follow the viewer BACK — the bidirectional
    //    edges — most-recently-established first.
    const mutualFollows = await Follow.find({
      followedId: viewerId,
      followType: FollowType.USER,
      followerUserId: { $in: followingIds },
    })
      .select('followerUserId')
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    return mutualFollows
      .map((follow) => follow.followerUserId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId)
      .map((id) => id.toString());
  }

  /**
   * Get the authenticated VIEWER's OWN social graph — the accounts they follow,
   * the subset who follow back (mutuals), and the accounts they have blocked —
   * as ONE ids-only payload.
   *
   * Consolidates three per-viewer graph reads consuming apps (Mention, Allo,
   * Homiio) previously made as separate round trips into a single service call,
   * so the consolidated `GET /users/me/graph` endpoint can serve (and cache) the
   * whole graph in one request. Each sub-read REUSES the existing, battle-tested
   * logic: the same following query as {@link getUserFollowing}, the same
   * bidirectional intersection as {@link getMutualUserIds}, and the same
   * `Block.find({ userId })` the privacy routes use. The three sub-reads run in
   * PARALLEL — they are independent Mongo queries.
   *
   * The viewer id is ALWAYS derived server-side by the route (`resolveViewerId`),
   * never a client param. An anonymous caller (or a service token with no user
   * context) has no graph ⇒ every list is empty.
   *
   * Every list is bounded (`MAX_FOLLOWING_IDS` / `MAX_MUTUAL_IDS` /
   * `MAX_BLOCKED_IDS`) so the queries and the payload stay small regardless of
   * how large the viewer's graph is. Bare ids only — no hydrated DTOs, no
   * `_count` — because the consumer hydrates/ranks itself.
   */
  async getViewerGraph(
    viewerId: string | undefined,
    opts: {
      followingLimit?: number;
      mutualLimit?: number;
      blockedLimit?: number;
    } = {}
  ): Promise<ViewerGraph> {
    if (!viewerId) {
      return { followingIds: [], mutualIds: [], blockedIds: [] };
    }

    const followingLimit = Math.min(
      opts.followingLimit && opts.followingLimit > 0
        ? opts.followingLimit
        : MAX_FOLLOWING_IDS,
      MAX_FOLLOWING_IDS
    );
    const blockedLimit = Math.min(
      opts.blockedLimit && opts.blockedLimit > 0
        ? opts.blockedLimit
        : MAX_BLOCKED_IDS,
      MAX_BLOCKED_IDS
    );

    const [followingIds, mutualIds, blockedIds] = await Promise.all([
      // Following — same query/shape as getUserFollowing, ids-only and bounded,
      // most-recently-established first so the cap keeps the current follows.
      Follow.find({
        followerUserId: viewerId,
        followType: FollowType.USER,
      })
        .select('followedId')
        .sort({ createdAt: -1 })
        .limit(followingLimit)
        .lean()
        .then((follows) =>
          follows
            .map((follow) => follow.followedId)
            .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId)
            .map((id) => id.toString())
        ),

      // Mutuals — reuse the canonical bidirectional intersection so there is a
      // single source of truth for "mutual" semantics and caps.
      this.getMutualUserIds(viewerId, { limit: opts.mutualLimit }),

      // Blocked — same read the privacy routes use (`Block.find({ userId })`),
      // ids-only and bounded.
      Block.find({ userId: viewerId })
        .select('blockedId')
        .limit(blockedLimit)
        .lean()
        .then((blocks) =>
          blocks
            .map((block) => block.blockedId)
            .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId)
            .map((id) => id.toString())
        ),
    ]);

    return { followingIds, mutualIds, blockedIds };
  }

  /**
   * Get the VIEWER's bounded "follows-of-follows" user ids — the union of the
   * accounts followed by the accounts the viewer follows (a two-hop walk of the
   * follow graph), MINUS the viewer's own follows and the viewer themselves.
   * This SEEDS Mention's friends-of-friends feed, which hydrates and ranks the
   * posts itself, so the payload is lean and ids-only (no hydrated DTOs, no
   * `User` lookup) — mirroring {@link getMutualUserIds}.
   *
   * The viewer id is ALWAYS derived server-side by the route (`resolveViewerId`),
   * never a client param. An anonymous caller (or a service token with no user
   * context) has no "you follow" set ⇒ empty. A viewer who follows nobody
   * short-circuits before the aggregation.
   *
   * Bounded so the fan-out cannot blow up:
   *  - the viewer's following set (used for exclusion) is scanned most-recent
   *    first and capped at `MAX_FOLLOWS_OF_FOLLOWS_IDS`;
   *  - only the `MAX_FOF_FIRST_HOP` most-recent of those follows seed the second
   *    hop, so the `$in` over the Follow collection stays small no matter how
   *    many accounts the viewer follows;
   *  - the returned set is capped at `MAX_FOLLOWS_OF_FOLLOWS_IDS`.
   *
   * Ordering: candidates are ranked by how many of the viewer's sampled follows
   * follow each one (frequency — the strongest friends-of-friends signal), with
   * the most-recently-established edge breaking ties (recency).
   */
  async getFollowsOfFollowsIds(
    viewerId: string | undefined,
    params: { limit?: number } = {}
  ): Promise<string[]> {
    if (!viewerId) {
      return [];
    }

    const limit = Math.min(
      params.limit && params.limit > 0 ? params.limit : MAX_FOLLOWS_OF_FOLLOWS_IDS,
      MAX_FOLLOWS_OF_FOLLOWS_IDS
    );

    // 1. The viewer's following set, most-recent first. Bounded so both the
    //    exclusion set and the first-hop seed stay small.
    const viewerFollowing = await Follow.find({
      followerUserId: viewerId,
      followType: FollowType.USER,
    })
      .select('followedId')
      .sort({ createdAt: -1 })
      .limit(MAX_FOLLOWS_OF_FOLLOWS_IDS)
      .lean();

    const followingIds = viewerFollowing
      .map((follow) => follow.followedId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);

    if (followingIds.length === 0) {
      return [];
    }

    // 2. Seed the second hop with only the most-recent follows to cap the
    //    fan-out. Everything the viewer already follows, plus the viewer, is
    //    excluded from the result — a follow-of-follow the viewer already
    //    follows is not a recommendation.
    const firstHopIds = followingIds.slice(0, MAX_FOF_FIRST_HOP);
    const excludeIds = [new Types.ObjectId(viewerId), ...followingIds];

    // 3. Union of the accounts THOSE follows follow, ranked by how many of the
    //    viewer's follows follow each candidate (frequency), then recency.
    const rows = await Follow.aggregate<FollowsOfFollowsRow>([
      {
        $match: {
          followerUserId: { $in: firstHopIds },
          followType: FollowType.USER,
          followedId: { $nin: excludeIds },
        },
      },
      {
        $group: {
          _id: '$followedId',
          followerCount: { $sum: 1 },
          lastFollowedAt: { $max: '$createdAt' },
        },
      },
      { $sort: { followerCount: -1, lastFollowedAt: -1 } },
      { $limit: limit },
    ]);

    return rows
      .map((row) => row._id)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId)
      .map((id) => id.toString());
  }

  /**
   * Read the current follower/following totals for the two sides of a follow
   * edge. Called AFTER a follow/unfollow mutation so the returned counts reflect
   * the post-write state.
   */
  private async readFollowCounts(
    targetId: string,
    followerId: string
  ): Promise<FollowCounts> {
    const [updatedTarget, updatedCurrent] = await Promise.all([
      User.findById(targetId).select('_count').lean(),
      User.findById(followerId).select('_count').lean(),
    ]);

    const targetCounts = (updatedTarget as UserWithCount)?._count;
    const currentCounts = (updatedCurrent as UserWithCount)?._count;

    return {
      followers: targetCounts?.followers ?? 0,
      following: currentCounts?.following ?? 0,
    };
  }

  /**
   * Idempotently create a follow edge from `followerId` to `targetId`.
   *
   * The unique compound index on `Follow` is the atomic arbiter of
   * "created vs already-following": a concurrent duplicate insert fails with
   * E11000 and is treated as a no-op, so the follower/followed counters can only
   * ever move once for a given edge. Counters are incremented ONLY on a genuine
   * insert.
   */
  async followUser(
    followerId: string,
    targetId: string
  ): Promise<FollowUserResult> {
    if (followerId === targetId) {
      throw new Error('Cannot follow yourself');
    }

    const [targetUser, currentUser] = await Promise.all([
      User.findById(targetId),
      User.findById(followerId),
    ]);

    if (!targetUser || !currentUser) {
      throw new Error('User not found');
    }

    let created = false;
    try {
      await Follow.create({
        followerUserId: followerId,
        followType: FollowType.USER,
        followedId: targetId,
      });
      created = true;
    } catch (error: unknown) {
      // A duplicate-key error means the edge already exists (or was just
      // created by a concurrent request) — an idempotent no-op, not a failure.
      // Any other error is genuine and must surface.
      const isDuplicate =
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: number }).code === 11000;
      if (!isDuplicate) {
        throw error;
      }
    }

    if (created) {
      await Promise.all([
        User.findByIdAndUpdate(targetId, { $inc: { '_count.followers': 1 } }),
        User.findByIdAndUpdate(followerId, { $inc: { '_count.following': 1 } }),
      ]);

      // The follow edge changed both sides' cached graph: the follower's
      // `followingIds`, and — because a follow can complete a bidirectional
      // edge — either side's `mutualIds`. Invalidate BOTH (mutuals are
      // symmetric) so the next `GET /users/me/graph` recomputes fresh truth.
      // No-op when the edge already existed (nothing changed) or when Redis is
      // unconfigured; invalidation errors are swallowed inside graphCache.
      await Promise.all([
        graphCache.invalidate(followerId),
        graphCache.invalidate(targetId),
      ]);
    }

    const counts = await this.readFollowCounts(targetId, followerId);
    return { created, counts };
  }

  /**
   * Idempotently remove a follow edge from `followerId` to `targetId`.
   *
   * `deleteOne` reports whether a document was actually removed; counters are
   * decremented ONLY when a real edge was deleted, so unfollowing an edge that
   * does not exist is a safe no-op that never drives counts negative.
   */
  async unfollowUser(
    followerId: string,
    targetId: string
  ): Promise<UnfollowUserResult> {
    if (followerId === targetId) {
      throw new Error('Cannot follow yourself');
    }

    const [targetUser, currentUser] = await Promise.all([
      User.findById(targetId),
      User.findById(followerId),
    ]);

    if (!targetUser || !currentUser) {
      throw new Error('User not found');
    }

    const { deletedCount } = await Follow.deleteOne({
      followerUserId: followerId,
      followType: FollowType.USER,
      followedId: targetId,
    });
    const removed = deletedCount === 1;

    if (removed) {
      await Promise.all([
        User.findByIdAndUpdate(targetId, { $inc: { '_count.followers': -1 } }),
        User.findByIdAndUpdate(followerId, { $inc: { '_count.following': -1 } }),
      ]);

      // Symmetric to followUser: removing the edge changed the follower's
      // `followingIds` and can break a bidirectional edge, so invalidate BOTH
      // sides' cached graph. No-op when no edge was actually removed.
      await Promise.all([
        graphCache.invalidate(followerId),
        graphCache.invalidate(targetId),
      ]);
    }

    const counts = await this.readFollowCounts(targetId, followerId);
    return { removed, counts };
  }

  /**
   * Follow or unfollow a user, toggling on the current relationship. Thin
   * dispatcher over the idempotent `followUser` / `unfollowUser` primitives.
   */
  async toggleFollow(
    currentUserId: string,
    targetUserId: string
  ): Promise<FollowActionResult> {
    const existingFollow = await Follow.findOne({
      followerUserId: currentUserId,
      followType: FollowType.USER,
      followedId: targetUserId,
    });

    if (existingFollow) {
      const { counts } = await this.unfollowUser(currentUserId, targetUserId);
      return { action: 'unfollow', counts };
    }

    const { counts } = await this.followUser(currentUserId, targetUserId);
    return { action: 'follow', counts };
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

      // The batch changed the viewer's `followingIds` and can complete
      // bidirectional edges, so invalidate the viewer plus every newly-followed
      // target's cached graph (mutuals are symmetric). Only the ids whose edge
      // actually changed are invalidated.
      await Promise.all([
        graphCache.invalidate(currentUserId),
        ...newlyFollowedIds.map((id) => graphCache.invalidate(id)),
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

        // Symmetric to bulkFollow: invalidate the viewer plus every target
        // whose edge was actually removed (mutuals are symmetric).
        await Promise.all([
          graphCache.invalidate(currentUserId),
          ...actuallyRemovedIds.map((id) => graphCache.invalidate(id)),
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
   * Format user response with stats.
   *
   * Reads only PUBLIC profile fields. A source document must therefore be loaded
   * with a projection that covers them — `PUBLIC_USER_PROFILE_SELECT` for list
   * queries, `-password -refreshToken` for the single-user reads — otherwise the
   * unprojected fields serialize as `undefined` with no error anywhere.
   */
  formatUserResponse(
    user: IUser | PublicUserDocument,
    stats?: UserStatistics,
    options: { includePrivateFields?: boolean } = {}
  ): PublicUserProfile {
    // The load-bearing identity fields (`id`, `name`, `username`, `avatar`) come
    // from the SHARED `userIdentityFields` definer, so this serializer can never
    // diverge from the public/self/recommendation serializers on them. In
    // particular the DTO `id` is ALWAYS the stable Mongo ObjectId, never the
    // publicKey: the social graph the whole ecosystem keys on (`Post.oxyUserId`,
    // follow edges, client follow-state maps) is anchored on `_id`, so a
    // key-anchored account keeps `id === _id` (flipping it to the publicKey once
    // a user links a Commons identity makes author-feed/follow lookups miss). Key
    // identity stays available via the separate `publicKey`/`did` fields, and the
    // helper's `id` fallback covers already-transformed keyless managed/org
    // objects (schema toObject deletes `_id` and folds the identifier into `id`).
    const identity = userIdentityFields(user);
    if (!identity.id) {
      throw new Error('User must have an _id');
    }
    const userAny = user as unknown as Record<string, unknown>;

    const response: PublicUserProfile = {
      id: identity.id,
      username: identity.username,
      name: identity.name,
      avatar: identity.avatar,
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
    response.isFederated = deriveIsFederated(userAny.type);
    // Public, derived: whether this account participates in fediverse sharing.
    // Intentionally public (like isFederated) — the state is observable anyway
    // (the AP actor 404s when off). The rest of privacySettings stays private.
    const privacySettings = userAny.privacySettings as { fediverseSharing?: boolean } | undefined;
    response.fediverseSharing = privacySettings?.fediverseSharing !== false;

    if (stats) {
      response._count = stats;
    }

    return response;
  }
}

// Export singleton instance
export const userService = new UserService();
export default userService;
