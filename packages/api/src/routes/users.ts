import { Router, Request, Response, NextFunction } from 'express';
import User, { IUser } from '../models/User';
import Follow, { FollowType } from '../models/Follow';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';
import { Types } from 'mongoose';
import { UsersController } from '../controllers/users.controller';

interface AuthRequest extends Request {
  user?: {
    id: string;
  };
}

const router = Router();
const usersController = new UsersController();

// Middleware to validate ObjectId
const validateObjectId = (req: Request, res: Response, next: NextFunction) => {
  if (!Types.ObjectId.isValid(req.params.userId)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }
  next();
};

// Get current authenticated user
router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user?.id).select('-password -refreshToken');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userObj = user.toObject({ virtuals: true });
    res.json(userObj);
  } catch (error) {
    logger.error('Error fetching current user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update current authenticated user
router.put('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const allowedUpdates = ['name', 'email', 'username', 'avatar', 'bio', 'description', 'links', 'linksMetadata', 'locations'] as const;
    type AllowedUpdate = typeof allowedUpdates[number];

    const updates = Object.entries(req.body)
      .filter(([key]) => allowedUpdates.includes(key as AllowedUpdate))
      .reduce((obj, [key, value]) => {
        if (key === 'avatar' && value && typeof value === 'object') {
          const avatarValue = value as { id?: string; url?: string };
          return { ...obj, [key]: { id: avatarValue.id || '', url: avatarValue.url || '' } };
        }
        return { ...obj, [key]: value };
      }, {} as Partial<Pick<IUser, AllowedUpdate>>);

    const user = await User.findByIdAndUpdate(
      req.user?.id,
      { $set: updates },
      { new: true }
    ).select('-password -refreshToken');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    logger.error('Error updating current user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get user by ID
router.get('/:userId', validateObjectId, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password -refreshToken');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Followers: people who follow this user
    const followersCount = await Follow.countDocuments({
      followedId: user._id,
      followType: 'user'
    });
    // Following: people this user follows
    const followingCount = await Follow.countDocuments({
      followerUserId: user._id,
      followType: 'user'
    });

    // karma count not implemented - requires posts collection integration
    const karmaCount = 0;


    const userObj = user.toObject({ virtuals: true });
    res.json({
      ...userObj,
      stats: {
        followers: followersCount,
        following: followingCount,
        karma: karmaCount
      },
      _count: {
        followers: followersCount,
        following: followingCount,
        karma: karmaCount
      }
    });
  } catch (error) {
    logger.error('Error fetching user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update user profile
router.put('/:userId', authMiddleware, validateObjectId, async (req: AuthRequest, res) => {
  try {
    // Only allow users to update their own profile
    if (req.params.userId !== req.user?.id) {
      return res.status(403).json({ message: 'Not authorized to update this profile' });
    }

    const allowedUpdates = ['name', 'email', 'username', 'avatar', 'bio', 'description'] as const;
    type AllowedUpdate = typeof allowedUpdates[number];
    
    const updates = Object.entries(req.body)
      .filter(([key]) => allowedUpdates.includes(key as AllowedUpdate))
      .reduce((obj, [key, value]) => {
        // Special handling for avatar field to ensure it's properly structured
        if (key === 'avatar' && value && typeof value === 'object') {
          const avatarValue = value as { id?: string; url?: string };
          return {
            ...obj,
            [key]: {
              id: avatarValue.id || "",
              url: avatarValue.url || ""
            }
          };
        }
        return {
          ...obj,
          [key]: value
        };
      }, {} as Partial<Pick<IUser, AllowedUpdate>>);

    logger.debug('Profile update request:', {
      requestBody: req.body,
      filteredUpdates: updates
    });

    // Check for email uniqueness if email is being updated
    if (updates.email) {
      const existingEmailUser = await User.findOne({ 
        email: updates.email, 
        _id: { $ne: req.params.userId } 
      });
      if (existingEmailUser) {
        return res.status(400).json({ message: 'Email already exists' });
      }
    }

    // Check for username uniqueness if username is being updated
    if (updates.username) {
      const existingUsernameUser = await User.findOne({ 
        username: updates.username, 
        _id: { $ne: req.params.userId } 
      });
      if (existingUsernameUser) {
        return res.status(400).json({ message: 'Username already exists' });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { $set: updates },
      { new: true }
    ).select('-password -refreshToken');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    logger.error('Error updating user profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update privacy settings
router.put('/:userId/privacy', authMiddleware, validateObjectId, async (req: AuthRequest, res) => {
  try {
    if (req.params.userId !== req.user?.id) {
      return res.status(403).json({ message: 'Not authorized to update privacy settings' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { $set: { privacySettings: req.body } },
      { new: true }
    ).select('-password -refreshToken');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    logger.error('Error updating privacy settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get user's followers
router.get('/:userId/followers', validateObjectId, async (req, res) => {
  try {
    const follows = await Follow.find({
      followedId: req.params.userId,
      followType: FollowType.USER
    }).populate({
      path: 'followerUserId',
      model: 'User',
      select: 'name avatar -email'
    });

    const followers = follows.map(follow => follow.followerUserId);
    res.json(followers);
  } catch (error) {
    logger.error('Error fetching followers:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get user's following
router.get('/:userId/following', validateObjectId, async (req, res) => {
  try {
    const follows = await Follow.find({
      followerUserId: req.params.userId,
      followType: FollowType.USER
    }).populate({
      path: 'followedId',
      model: 'User',
      select: 'name avatar -email'
    });

    const following = follows.map(follow => follow.followedId);
    res.json(following);
  } catch (error) {
    logger.error('Error fetching following:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Follow a user
router.post('/:userId/follow', authMiddleware, validateObjectId, async (req: AuthRequest, res) => {
  try {
    const targetUserId = req.params.userId;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (targetUserId === currentUserId) {
      return res.status(400).json({ message: 'Cannot follow yourself' });
    }

    const [targetUser, currentUser] = await Promise.all([
      User.findById(targetUserId),
      User.findById(currentUserId)
    ]);

    if (!targetUser || !currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already following
    const existingFollow = await Follow.findOne({
      followerUserId: currentUserId,
      followType: FollowType.USER,
      followedId: targetUserId
    });

    if (existingFollow) {
      // Unfollow
      await Promise.all([
        Follow.deleteOne({ _id: existingFollow._id }),
        User.findByIdAndUpdate(targetUserId, { $inc: { '_count.followers': -1 } }),
        User.findByIdAndUpdate(currentUserId, { $inc: { '_count.following': -1 } })
      ]);

      const [updatedTarget, updatedCurrent] = await Promise.all([
        User.findById(targetUserId).select('_count'),
        User.findById(currentUserId).select('_count')
      ]);

      return res.json({
        message: 'Successfully unfollowed user',
        action: 'unfollow',
        counts: {
          followers: updatedTarget?._count?.followers || 0,
          following: updatedCurrent?._count?.following || 0
        }
      });
    }

    // Follow
    await Promise.all([
      Follow.create({
        followerUserId: currentUserId,
        followType: FollowType.USER,
        followedId: targetUserId
      }),
      User.findByIdAndUpdate(targetUserId, { $inc: { '_count.followers': 1 } }),
      User.findByIdAndUpdate(currentUserId, { $inc: { '_count.following': 1 } })
    ]);

    const [updatedTarget, updatedCurrent] = await Promise.all([
      User.findById(targetUserId).select('_count'),
      User.findById(currentUserId).select('_count')
    ]);

    res.json({
      message: 'Successfully followed user',
      action: 'follow',
      counts: {
        followers: updatedTarget?._count?.followers || 0,
        following: updatedCurrent?._count?.following || 0
      }
    });
  } catch (error) {
    logger.error('Error following user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Unfollow a user
router.delete('/:userId/follow', authMiddleware, validateObjectId, async (req: AuthRequest, res) => {
  try {
    const targetUserId = req.params.userId;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (targetUserId === currentUserId) {
      return res.status(400).json({ message: 'Cannot unfollow yourself' });
    }

    const [targetUser, currentUser] = await Promise.all([
      User.findById(targetUserId),
      User.findById(currentUserId)
    ]);

    if (!targetUser || !currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if following using the Follow collection (consistent with other endpoints)
    const existingFollow = await Follow.findOne({
      followerUserId: currentUserId,
      followType: FollowType.USER,
      followedId: targetUserId
    });

    if (!existingFollow) {
      return res.status(400).json({ message: 'Not following this user' });
    }

    // Remove the follow relationship and update counts
    await Promise.all([
      Follow.deleteOne({ _id: existingFollow._id }),
      User.findByIdAndUpdate(targetUserId, { $inc: { '_count.followers': -1 } }),
      User.findByIdAndUpdate(currentUserId, { $inc: { '_count.following': -1 } })
    ]);

    const [updatedTarget, updatedCurrent] = await Promise.all([
      User.findById(targetUserId).select('_count'),
      User.findById(currentUserId).select('_count')
    ]);

    res.json({
      message: 'Successfully unfollowed user',
      action: 'unfollow',
      success: true,
      counts: {
        followers: updatedTarget?._count?.followers || 0,
        following: updatedCurrent?._count?.following || 0
      }
    });
  } catch (error) {
    logger.error('Error unfollowing user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get following status
router.get('/:userId/following-status', authMiddleware, validateObjectId, async (req: AuthRequest, res) => {
  try {
    const targetUserId = req.params.userId;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const follow = await Follow.findOne({
      followerUserId: currentUserId,
      followType: FollowType.USER,
      followedId: targetUserId
    });

    res.json({ isFollowing: !!follow });
  } catch (error) {
    logger.error('Error checking following status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Search users
router.post('/search', usersController.searchUsers.bind(usersController));

export default router;