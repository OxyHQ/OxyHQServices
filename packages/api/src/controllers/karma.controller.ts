import { Request, Response } from 'express';
import { z } from 'zod';
import Karma from '../models/Karma';
import KarmaRule from '../models/KarmaRule';
import User from '../models/User';
import mongoose from 'mongoose';
import { logger } from '../utils/logger';

// Validation schemas
const karmaActionSchema = z.object({
  userId: z.string(),
  action: z.string(),
  description: z.string().optional(),
  targetContentId: z.string().optional(),
});

/**
 * Get a user's total karma
 */
export const getUserKarmaTotal = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID' 
      });
    }

    // Find or create karma record
    let karmaRecord = await Karma.findOne({ userId });
    
    if (!karmaRecord) {
      // No karma record yet, create a new one with 0 karma
      return res.json({ 
        success: true,
        karma: 0 
      });
    }

    return res.json({ 
      success: true,
      karma: karmaRecord.totalKarma 
    });
  } catch (error) {
    logger.error('Error fetching karma total:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Server error when fetching karma total'
    });
  }
};

/**
 * Get a user's karma history
 */
export const getUserKarmaHistory = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID' 
      });
    }

    // Find karma record
    const karmaRecord = await Karma.findOne({ userId })
      .populate({
        path: 'history.sourceUserId',
        select: 'username'
      });
    
    if (!karmaRecord) {
      return res.json({
        success: true,
        userId,
        actions: [],
        totalKarma: 0
      });
    }

    // Get paginated history
    const history = karmaRecord.history
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(offset, offset + limit)
      .map(item => ({
        action: item.action,
        points: item.points,
        timestamp: item.timestamp,
        description: item.description,
        sourceUserId: item.sourceUserId,
        targetContentId: item.targetContentId
      }));

    return res.json({
      success: true,
      userId,
      actions: history,
      totalKarma: karmaRecord.totalKarma
    });
  } catch (error) {
    logger.error('Error fetching karma history:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Server error when fetching karma history'
    });
  }
};

/**
 * Award karma to a user for an action
 */
export const awardKarma = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = karmaActionSchema.parse(req.body);
    const { userId, action, description, targetContentId } = validatedData;
    
    // Get source user ID (who triggered the action)
    const sourceUserId = req.user?._id;

    // Validate user exists
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Check if karma rule exists and is enabled
    const karmaRule = await KarmaRule.findOne({ action, isEnabled: true });
    if (!karmaRule) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid or disabled karma action' 
      });
    }

    // Points should be positive for awards
    if (karmaRule.points <= 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Karma rule does not award positive points' 
      });
    }

    // Find or create karma record
    let karmaRecord = await Karma.findOne({ userId }).session(session);
    if (!karmaRecord) {
      karmaRecord = new Karma({
        userId,
        totalKarma: 0,
        history: []
      });
    }

    // Check for cooldown if applicable
    if (karmaRule.cooldownInMinutes > 0) {
      const cooldownThreshold = new Date();
      cooldownThreshold.setMinutes(cooldownThreshold.getMinutes() - karmaRule.cooldownInMinutes);
      
      const recentSameAction = karmaRecord.history.find(item => 
        item.action === action && 
        item.timestamp > cooldownThreshold
      );
      
      if (recentSameAction) {
        return res.status(429).json({ 
          success: false,
          message: `This action is on cooldown. Please try again later.`,
          newTotal: karmaRecord.totalKarma
        });
      }
    }

    // Add karma
    karmaRecord.totalKarma += karmaRule.points;
    karmaRecord.history.push({
      action,
      points: karmaRule.points,
      timestamp: new Date(),
      description: description || karmaRule.description,
      sourceUserId: sourceUserId,
      targetContentId
    });

    await karmaRecord.save({ session });

    // Update user's karma count in the User model
    await User.findByIdAndUpdate(
      userId,
      { '$set': { '_count.karma': karmaRecord.totalKarma } },
      { session }
    );

    await session.commitTransaction();
    
    return res.json({
      success: true,
      message: `Awarded ${karmaRule.points} karma for ${action}`,
      newTotal: karmaRecord.totalKarma
    });
  } catch (error) {
    await session.abortTransaction();
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid karma action data',
        errors: error.errors
      });
    }
    
    logger.error('Error awarding karma:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Server error when awarding karma'
    });
  } finally {
    session.endSession();
  }
};

/**
 * Deduct karma from a user for an action
 */
export const deductKarma = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = karmaActionSchema.parse(req.body);
    const { userId, action, description, targetContentId } = validatedData;
    
    // Get source user ID (who triggered the action)
    const sourceUserId = req.user?._id;

    // Validate user exists
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Check if karma rule exists and is enabled
    const karmaRule = await KarmaRule.findOne({ action, isEnabled: true });
    if (!karmaRule) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid or disabled karma action' 
      });
    }

    // For deduction, points should be negative
    // If the rule has positive points, negate it for deduction
    const deductionPoints = karmaRule.points > 0 ? -karmaRule.points : karmaRule.points;

    // Find or create karma record
    let karmaRecord = await Karma.findOne({ userId }).session(session);
    if (!karmaRecord) {
      karmaRecord = new Karma({
        userId,
        totalKarma: 0,
        history: []
      });
    }

    // Check for cooldown if applicable
    if (karmaRule.cooldownInMinutes > 0) {
      const cooldownThreshold = new Date();
      cooldownThreshold.setMinutes(cooldownThreshold.getMinutes() - karmaRule.cooldownInMinutes);
      
      const recentSameAction = karmaRecord.history.find(item => 
        item.action === action && 
        item.timestamp > cooldownThreshold
      );
      
      if (recentSameAction) {
        return res.status(429).json({ 
          success: false,
          message: `This action is on cooldown. Please try again later.`,
          newTotal: karmaRecord.totalKarma
        });
      }
    }

    // Deduct karma, but don't let it go below 0 optionally
    karmaRecord.totalKarma += deductionPoints;
    // Optional: Prevent negative karma
    // karmaRecord.totalKarma = Math.max(0, karmaRecord.totalKarma);
    
    karmaRecord.history.push({
      action,
      points: deductionPoints,
      timestamp: new Date(),
      description: description || karmaRule.description,
      sourceUserId: sourceUserId,
      targetContentId
    });

    await karmaRecord.save({ session });

    // Update user's karma count in the User model
    await User.findByIdAndUpdate(
      userId,
      { '$set': { '_count.karma': karmaRecord.totalKarma } },
      { session }
    );

    await session.commitTransaction();
    
    return res.json({
      success: true,
      message: `Deducted ${Math.abs(deductionPoints)} karma for ${action}`,
      newTotal: karmaRecord.totalKarma
    });
  } catch (error) {
    await session.abortTransaction();
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid karma action data',
        errors: error.errors
      });
    }
    
    logger.error('Error deducting karma:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Server error when deducting karma'
    });
  } finally {
    session.endSession();
  }
};

/**
 * Get karma leaderboard
 */
export const getKarmaLeaderboard = async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;

    // Aggregate to join with User model and get username
    const leaderboard = await Karma.aggregate([
      { $sort: { totalKarma: -1 } },
      { $skip: offset },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          _id: 0,
          userId: 1,
          karma: '$totalKarma',
          username: '$user.username'
        }
      }
    ]);

    return res.json({
      success: true,
      leaderboard
    });
  } catch (error) {
    logger.error('Error fetching karma leaderboard:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Server error when fetching karma leaderboard'
    });
  }
};

/**
 * Get karma rules
 */
export const getKarmaRules = async (req: Request, res: Response) => {
  try {
    // Only return enabled rules with positive points (for client display)
    const rules = await KarmaRule.find({ isEnabled: true })
      .select('action points description category cooldownInMinutes')
      .sort({ category: 1, points: -1 });

    return res.json({
      success: true,
      rules
    });
  } catch (error) {
    logger.error('Error fetching karma rules:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Server error when fetching karma rules'
    });
  }
};

/**
 * Create or update a karma rule (admin only)
 */
export const createOrUpdateKarmaRule = async (req: Request, res: Response) => {
  try {
    const { 
      action, 
      points, 
      description, 
      cooldownInMinutes = 0,
      isEnabled = true,
      category = 'other'
    } = req.body;

    if (!action || points === undefined || !description) {
      return res.status(400).json({ 
        success: false,
        message: 'Action, points, and description are required' 
      });
    }

    // Check if rule exists
    let rule = await KarmaRule.findOne({ action });

    if (rule) {
      // Update existing rule
      rule.points = points;
      rule.description = description;
      rule.cooldownInMinutes = cooldownInMinutes;
      rule.isEnabled = isEnabled;
      rule.category = category;
      await rule.save();
    } else {
      // Create new rule
      rule = new KarmaRule({
        action,
        points,
        description,
        cooldownInMinutes,
        isEnabled,
        category
      });
      await rule.save();
    }

    return res.json({
      success: true,
      rule
    });
  } catch (error) {
    logger.error('Error creating/updating karma rule:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Server error when creating/updating karma rule'
    });
  }
}; 