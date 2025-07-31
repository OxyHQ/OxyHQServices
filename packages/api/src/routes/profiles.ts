import { Router, Request, Response } from 'express';
import User, { IUser } from '../models/User';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';
import { Types } from 'mongoose';
import { ParsedQs } from 'qs';
import Follow, { FollowType } from '../models/Follow';

interface SearchQuery extends ParsedQs {
  query?: string;
  limit?: string;
  offset?: string;
}

const router = Router();

// Get profile by username
router.get('/username/:username', async (req: Request, res: Response) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('-password -refreshToken');

    if (!user) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    res.json(user);
  } catch (error) {
    logger.error('Error fetching profile by username:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Search profiles
router.get('/search', async (req: Request<{}, {}, {}, SearchQuery>, res: Response) => {
  try {
    const { query, limit = '10', offset = '0' } = req.query;
    
    if (!query) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const searchRegex = new RegExp(query, 'i');
    const profiles = await User.find({
      $or: [
        { username: searchRegex },
        { 'name.first': searchRegex },
        { 'name.last': searchRegex },
        { description: searchRegex }
      ]
    })
    .select('-password -refreshToken')
    .limit(parseInt(limit))
    .skip(parseInt(offset));

    const enrichedProfiles = await Promise.all(
      profiles.map(async (profile: IUser) => {
        // Followers: people who follow this user
        const followersCount = await Follow.countDocuments({
          followedId: profile._id,
          followType: 'user'
        });
        // Following: people this user follows
        const followingCount = await Follow.countDocuments({
          followerUserId: profile._id,
          followType: 'user'
        });

        logger.info(`Stats for user ${profile._id}: followers=${followersCount}, following=${followingCount}`);

        return {
          ...profile.toObject(),
          _count: {
            followers: followersCount,
            following: followingCount
          }
        };
      })
    );

    res.json(enrichedProfiles);
  } catch (error) {
    logger.error('Error searching profiles:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get recommended profiles
router.get('/recommendations', authMiddleware, async (req: Request<{}, {}, {}, { limit?: string; offset?: string }> & { user?: { id: string } }, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 10;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const currentUserId = req.user?.id;

    logger.info(`Fetching recommendations${currentUserId ? ` for user ${currentUserId}` : ''} with limit ${limit} and offset ${offset}`);

    let excludeIds: Types.ObjectId[] = [];
    let followingIds: Types.ObjectId[] = [];
    if (currentUserId) {
      excludeIds.push(new Types.ObjectId(currentUserId));
      const following = await Follow.find({
        followerUserId: currentUserId,
        followType: FollowType.USER
      }).select('followedId');
      followingIds = following.map(f => f.followedId instanceof Types.ObjectId ? f.followedId : new Types.ObjectId(f.followedId));
      excludeIds = excludeIds.concat(followingIds);
    }

    let recommendations: any[] = [];
    if (followingIds.length > 0) {
      // Find users followed by people you follow (mutuals), ranked by how many of your followings follow them
      recommendations = await Follow.aggregate([
        { $match: {
            followerUserId: { $in: followingIds },
            followType: 'user',
            followedId: { $nin: excludeIds }
        }},
        { $group: {
            _id: '$followedId',
            mutualCount: { $sum: 1 }
        }},
        { $sort: { mutualCount: -1 } },
        { $skip: offset },
        { $limit: limit },
        // Join with User
        { $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
        }},
        { $unwind: '$user' },
        // Get follower/following counts
        { $lookup: {
            from: 'follows',
            let: { userId: '$_id' },
            pipeline: [
              { $match: { $expr: { $and: [ { $eq: ['$followedId', '$$userId'] }, { $eq: ['$followType', 'user'] } ] } } }
            ],
            as: 'followersArr'
        }},
        { $lookup: {
            from: 'follows',
            let: { userId: '$_id' },
            pipeline: [
              { $match: { $expr: { $and: [ { $eq: ['$followerUserId', '$$userId'] }, { $eq: ['$followType', 'user'] } ] } } }
            ],
            as: 'followingArr'
        }},
        { $project: {
            _id: 1,
            username: '$user.username',
            name: '$user.name',
            avatar: '$user.avatar',
            description: '$user.description',
            mutualCount: 1,
            followersCount: { $size: '$followersArr' },
            followingCount: { $size: '$followingArr' }
        }}
      ]);
    }

    // If not enough, fill with random users
    if (recommendations.length < limit) {
      const alreadyRecommendedIds = recommendations.map(u => u._id);
      const fillLimit = limit - recommendations.length;
      const randomUsers = await User.aggregate([
        { $match: { _id: { $nin: excludeIds.concat(alreadyRecommendedIds) } } },
        { $sample: { size: fillLimit } },
        {
          $lookup: {
            from: 'follows',
            let: { userId: '$_id' },
            pipeline: [
              { $match: { $expr: { $and: [ { $eq: ['$followedId', '$$userId'] }, { $eq: ['$followType', 'user'] } ] } } }
            ],
            as: 'followersArr'
          }
        },
        {
          $lookup: {
            from: 'follows',
            let: { userId: '$_id' },
            pipeline: [
              { $match: { $expr: { $and: [ { $eq: ['$followerUserId', '$$userId'] }, { $eq: ['$followType', 'user'] } ] } } }
            ],
            as: 'followingArr'
          }
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
            followingCount: { $size: '$followingArr' }
          }
        }
      ]);
      recommendations = recommendations.concat(randomUsers);
    }

    logger.info(`Returning ${recommendations.length} improved recommendations`);
    res.json(recommendations.map(u => ({
      id: u._id,
      username: u.username,
      name: u.name,
      avatar: u.avatar,
      description: u.description,
      mutualCount: u.mutualCount,
      _count: {
        followers: u.followersCount,
        following: u.followingCount
      }
    })));
  } catch (error) {
    logger.error('Error getting profile recommendations:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router; 