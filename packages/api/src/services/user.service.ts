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
import {
  PaginationParams,
  PaginatedResponse,
  ProfileUpdateInput,
  UserProfile,
  UserStatistics,
  FollowActionResult,
} from '../types/user.types';

// Constants
import { PAGINATION } from '../utils/constants';

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
    const user = await User.findById(userId)
      .select('-password -refreshToken')
      .lean({ virtuals: true }) as IUser | null;

    if (user && user.name && typeof user.name === 'object') {
      // Ensure name.full exists for backward compatibility
      const first = (user.name.first as string) || '';
      const last = (user.name.last as string) || '';
      if (!('full' in user.name) || !user.name.full) {
        (user.name as any).full = [first, last].filter(Boolean).join(' ').trim();
      }
    }

    return user;
  }

  /**
   * Update user profile
   * Handles MongoDB language field conflict with text indexes
   */
  async updateUserProfile(
    userId: string,
    updates: ProfileUpdateInput
  ): Promise<IUser> {
    // Allowed fields for updates
    const allowedFields = [
      'name',
      'email',
      'username',
      'avatar',
      'bio',
      'description',
      'links',
      'linksMetadata',
      'locations',
      'language',
      'accountExpiresAfterInactivityDays',
    ] as const;

    // Filter and validate updates
    const filteredUpdates: Partial<ProfileUpdateInput> = {};
    
    for (const [key, value] of Object.entries(updates)) {
      if (!allowedFields.includes(key as any)) continue;
      
      // Handle avatar field - can be string ID or object with id
      if (key === 'avatar') {
        if (typeof value === 'string') {
          filteredUpdates.avatar = value;
        } else if (value && typeof value === 'object' && 'id' in value) {
          filteredUpdates.avatar = (value as { id?: string }).id || '';
        }
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
      (filteredUpdates as any)[key] = value;
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

    // Update language directly on document to avoid MongoDB conflict
    if (language !== undefined) {
      (user as any).language = language;
    }

    // Update other fields directly on the document
    Object.entries(otherUpdates).forEach(([key, value]) => {
      (user as any)[key] = value;
    });

    // Save the document - this ensures all Mongoose middleware and validation runs
    await user.save();

    // Convert to plain object with virtuals
    const userObj = user.toObject({ virtuals: true }) as IUser;

    // Ensure name.full exists
    if (userObj.name && typeof userObj.name === 'object') {
      const first = (userObj.name.first as string) || '';
      const last = (userObj.name.last as string) || '';
      if (!('full' in userObj.name) || !userObj.name.full) {
        (userObj.name as any).full = [first, last].filter(Boolean).join(' ').trim();
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
  ): Promise<PaginatedResponse<UserProfile>> {
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
      .select('username name avatar -email')
      .lean()
      .exec() as UserProfile[];

    // Maintain order from original follow relationships
    const followersMap = new Map(
      followers.map((user) => [user._id.toString(), user])
    );
    const orderedFollowers: UserProfile[] = followerIds
      .map((id) => followersMap.get(id))
      .filter((user): user is UserProfile => user !== undefined);

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
  ): Promise<PaginatedResponse<UserProfile>> {
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
      .select('username name avatar -email')
      .lean()
      .exec() as UserProfile[];

    // Maintain order from original follow relationships
    const followingMap = new Map(
      following.map((user) => [user._id.toString(), user])
    );
    const orderedFollowing: UserProfile[] = followingIds
      .map((id) => followingMap.get(id))
      .filter((user): user is UserProfile => user !== undefined);

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

      interface UserWithCount {
        _count?: {
          followers?: number;
          following?: number;
        };
      }

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

    interface UserWithCount {
      _count?: {
        followers?: number;
        following?: number;
      };
    }

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
   * Get user statistics (followers, following, karma)
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

    // Karma count requires posts collection integration (not implemented)
    const karmaCount = 0;

    return {
      followers: followersCount,
      following: followingCount,
      karma: karmaCount,
    };
  }

  /**
   * Format user response with stats
   */
  formatUserResponse(user: IUser | UserProfile, stats?: UserStatistics): Record<string, unknown> {
    // Handle both IUser (Mongoose document) and UserData (plain object)
    // Use publicKey as id - publicKey is the primary identifier
    const userId = (user as IUser).publicKey;
    if (!userId) {
      throw new Error('User must have a publicKey');
    }
    const userAny = user as unknown as Record<string, unknown>;
    
    const response: Record<string, unknown> = {
      id: userId,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      verified: userAny.verified as boolean | undefined,
      bio: userAny.bio as string | undefined,
      description: userAny.description as string | undefined,
      links: userAny.links as string[] | undefined,
      linksMetadata: userAny.linksMetadata as unknown,
      createdAt: userAny.createdAt as Date | undefined,
      updatedAt: userAny.updatedAt as Date | undefined,
    };

    if (stats) {
      response._count = stats;
    }

    // Ensure name.full exists
    if (response.name && typeof response.name === 'object' && response.name !== null) {
      const name = response.name as { first?: string; last?: string; full?: string };
      const first = name.first ?? '';
      const last = name.last ?? '';
      if (!name.full) {
        name.full = [first, last].filter(Boolean).join(' ').trim();
      }
    }

    return response;
  }
}

// Export singleton instance
export const userService = new UserService();
export default userService;

