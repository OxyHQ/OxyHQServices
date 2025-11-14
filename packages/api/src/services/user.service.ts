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

// Constants
const MAX_PAGINATION_LIMIT = 100;
const DEFAULT_PAGINATION_LIMIT = 50;

// Types
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export interface UpdateUserProfileParams {
  name?: { first?: string; last?: string; full?: string };
  email?: string;
  username?: string;
  avatar?: string;
  bio?: string;
  description?: string;
  links?: string[];
  linksMetadata?: Array<{ url: string; title: string; description: string; image?: string }>;
  locations?: Array<any>;
  language?: string;
}

export interface UserStats {
  followers: number;
  following: number;
  karma: number;
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
    updates: UpdateUserProfileParams
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
    ] as const;

    // Filter and validate updates
    const filteredUpdates = Object.entries(updates)
      .filter(([key]) => allowedFields.includes(key as any))
      .reduce((acc, [key, value]) => {
        // Handle avatar field - can be string ID or object with id
        if (key === 'avatar') {
          if (typeof value === 'string') {
            acc[key] = value;
          } else if (value && typeof value === 'object' && 'id' in (value as any)) {
            acc[key] = (value as any).id || '';
          }
          return acc;
        }
        acc[key as keyof UpdateUserProfileParams] = value;
        return acc;
      }, {} as Partial<UpdateUserProfileParams>);

    // Validate uniqueness constraints
    await this.validateUniqueFields(userId, filteredUpdates);

    // Handle language field separately to avoid MongoDB text index conflict
    const { language, ...otherUpdates } = filteredUpdates;

    // Update other fields using $set if there are any
    if (Object.keys(otherUpdates).length > 0) {
      await User.updateOne(
        { _id: userId },
        { $set: otherUpdates }
      );
    }

    // Handle language field separately (MongoDB interprets 'language' in $set as text index override)
    const user = await User.findById(userId).select('-password -refreshToken');
    if (!user) {
      throw new Error('User not found');
    }

    // Update language directly on document to avoid MongoDB conflict
    if (language !== undefined) {
      (user as any).language = language;
    }

    // Update other fields directly
    Object.entries(otherUpdates).forEach(([key, value]) => {
      (user as any)[key] = value;
    });

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
    updates: Partial<UpdateUserProfileParams>
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
  ): Promise<PaginatedResult<IUser>> {
    const limit = Math.min(
      params.limit || DEFAULT_PAGINATION_LIMIT,
      MAX_PAGINATION_LIMIT
    );
    const offset = params.offset || 0;

    const total = await Follow.countDocuments({
      followedId: userId,
      followType: FollowType.USER,
    });

    const follows = await Follow.find({
      followedId: userId,
      followType: FollowType.USER,
    })
      .populate({
        path: 'followerUserId',
        model: 'User',
        select: 'name avatar -email',
      })
      .limit(limit)
      .skip(offset)
      .sort({ createdAt: -1 });

    const followers = follows
      .map((follow) => follow.followerUserId)
      .filter(Boolean) as IUser[];

    return {
      data: followers,
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
  ): Promise<PaginatedResult<IUser>> {
    const limit = Math.min(
      params.limit || DEFAULT_PAGINATION_LIMIT,
      MAX_PAGINATION_LIMIT
    );
    const offset = params.offset || 0;

    const total = await Follow.countDocuments({
      followerUserId: userId,
      followType: FollowType.USER,
    });

    const follows = await Follow.find({
      followerUserId: userId,
      followType: FollowType.USER,
    })
      .populate({
        path: 'followedId',
        model: 'User',
        select: 'name avatar -email',
      })
      .limit(limit)
      .skip(offset)
      .sort({ createdAt: -1 });

    const following = follows
      .map((follow) => follow.followedId)
      .filter(Boolean) as IUser[];

    return {
      data: following,
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
  ): Promise<{ action: 'follow' | 'unfollow'; counts: { followers: number; following: number } }> {
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

      return {
        action: 'unfollow',
        counts: {
          followers: (updatedTarget as any)?._count?.followers || 0,
          following: (updatedCurrent as any)?._count?.following || 0,
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

    return {
      action: 'follow',
      counts: {
        followers: (updatedTarget as any)?._count?.followers || 0,
        following: (updatedCurrent as any)?._count?.following || 0,
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
  async getUserStats(userId: string): Promise<UserStats> {
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
  formatUserResponse(user: IUser, stats?: UserStats): any {
    const response: any = {
      id: user._id || user.id,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      verified: user.verified,
      bio: user.bio,
      description: user.description,
      links: user.links,
      linksMetadata: user.linksMetadata,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    if (stats) {
      response.stats = stats;
      response._count = stats;
    }

    // Ensure name.full exists
    if (response.name && typeof response.name === 'object') {
      const first = (response.name.first as string) || '';
      const last = (response.name.last as string) || '';
      if (!response.name.full) {
        response.name.full = [first, last].filter(Boolean).join(' ').trim();
      }
    }

    return response;
  }
}

// Export singleton instance
export const userService = new UserService();
export default userService;

