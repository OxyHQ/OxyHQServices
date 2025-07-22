import { Response, Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import { AuthRequest } from '../middleware/auth';
import Karma from '../models/Karma';
import KarmaRule from '../models/KarmaRule';
import User from '../models/User';
import { logger } from '../utils/logger';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const AWARD_KARMA_SCHEMA = z.object({
  userId: z.string().min(1, 'User ID is required'),
  action: z.string().min(1, 'Action is required'),
  description: z.string().optional(),
  targetContentId: z.string().optional(),
});

const DEDUCT_KARMA_SCHEMA = z.object({
  userId: z.string().min(1, 'User ID is required'),
  action: z.string().min(1, 'Action is required'),
  points: z.number().positive('Points must be positive'),
  description: z.string().optional(),
  targetContentId: z.string().optional(),
});

const KARMA_RULE_SCHEMA = z.object({
  action: z.string().min(1, 'Action is required'),
  points: z.number(),
  description: z.string().optional(),
  cooldownInMinutes: z.number().min(0).default(0),
  isEnabled: z.boolean().default(true),
  category: z.string().default('other'),
});

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_HISTORY_LIMIT = 50;
const DEFAULT_LEADERBOARD_LIMIT = 10;
const DEFAULT_OFFSET = 0;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Validates if a string is a valid MongoDB ObjectId
 */
function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Creates a standardized error response
 */
function createErrorResponse(message: string, errorCode?: string) {
  return {
    success: false,
    message,
    error: errorCode || 'UNKNOWN_ERROR',
  };
}

/**
 * Creates a standardized success response
 */
function createSuccessResponse<T>(data: T) {
  return {
    success: true,
    ...data,
  };
}

/**
 * Validates pagination parameters
 */
function validatePaginationParams(limit: number, offset: number): boolean {
  return limit > 0 && limit <= 100 && offset >= 0;
}

// =============================================================================
// CONTROLLER FUNCTIONS
// =============================================================================

/**
 * Retrieves a user's total karma
 * @param req - Express request
 * @param res - Express response
 */
export const getUserKarmaTotal = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
      res.status(400).json(createErrorResponse('Invalid user ID format', 'INVALID_USER_ID'));
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json(createErrorResponse('User not found', 'USER_NOT_FOUND'));
      return;
    }

    const karmaRecord = await Karma.findOne({ userId });
    const totalKarma = karmaRecord?.totalKarma || 0;

    res.json(createSuccessResponse({
      userId,
      totalKarma,
      username: user.username,
    }));
  } catch (error) {
    logger.error('Error fetching user karma total:', error);
    res.status(500).json(createErrorResponse('Error fetching karma total'));
  }
};

/**
 * Retrieves a user's karma history
 * @param req - Express request
 * @param res - Express response
 */
export const getUserKarmaHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || DEFAULT_HISTORY_LIMIT;
    const offset = parseInt(req.query.offset as string) || DEFAULT_OFFSET;

    if (!isValidObjectId(userId)) {
      res.status(400).json(createErrorResponse('Invalid user ID format', 'INVALID_USER_ID'));
      return;
    }

    if (!validatePaginationParams(limit, offset)) {
      res.status(400).json(createErrorResponse('Invalid pagination parameters', 'INVALID_PAGINATION'));
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json(createErrorResponse('User not found', 'USER_NOT_FOUND'));
      return;
    }

    const karmaRecord = await Karma.findOne({ userId });
    if (!karmaRecord) {
      res.json(createSuccessResponse({
        userId,
        totalKarma: 0,
        history: [],
        hasMore: false,
      }));
      return;
    }

    const history = karmaRecord.history
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(offset, offset + limit);

    res.json(createSuccessResponse({
      userId,
      totalKarma: karmaRecord.totalKarma,
      history,
      hasMore: offset + limit < karmaRecord.history.length,
    }));
  } catch (error) {
    logger.error('Error fetching user karma history:', error);
    res.status(500).json(createErrorResponse('Error fetching karma history'));
  }
};

/**
 * Awards karma to a user
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const awardKarma = async (req: AuthRequest, res: Response): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = AWARD_KARMA_SCHEMA.parse(req.body);
    const { userId, action, description, targetContentId } = validatedData;

    // Get source user ID (who triggered the action)
    const sourceUserId = req.user?._id;

    if (!isValidObjectId(userId)) {
      res.status(400).json(createErrorResponse('Invalid user ID', 'INVALID_USER_ID'));
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json(createErrorResponse('User not found', 'USER_NOT_FOUND'));
      return;
    }

    // Check if karma rule exists and is enabled
    const karmaRule = await KarmaRule.findOne({ action, isEnabled: true });
    if (!karmaRule) {
      res.status(400).json(createErrorResponse('Invalid or disabled karma action', 'INVALID_ACTION'));
      return;
    }

    // Points should be positive for awards
    if (karmaRule.points <= 0) {
      res.status(400).json(createErrorResponse('Karma rule does not award positive points', 'INVALID_RULE'));
      return;
    }

    // Find or create karma record
    let karmaRecord = await Karma.findOne({ userId }).session(session);
    if (!karmaRecord) {
      karmaRecord = new Karma({
        userId,
        totalKarma: 0,
        history: [],
      });
    }

    // Check for cooldown if applicable
    if (karmaRule.cooldownInMinutes > 0) {
      const cooldownThreshold = new Date();
      cooldownThreshold.setMinutes(cooldownThreshold.getMinutes() - karmaRule.cooldownInMinutes);

      const recentSameAction = karmaRecord.history.find(
        (item) =>
          item.action === action && item.timestamp > cooldownThreshold
      );

      if (recentSameAction) {
        res.status(429).json(createErrorResponse(
          'This action is on cooldown. Please try again later.',
          'COOLDOWN_ACTIVE'
        ));
        return;
      }
    }

    // Add karma
    karmaRecord.totalKarma += karmaRule.points;
    karmaRecord.history.push({
      action,
      points: karmaRule.points,
      timestamp: new Date(),
      description: description || karmaRule.description,
      sourceUserId,
      targetContentId,
    });

    await karmaRecord.save({ session });

    // Update user's karma count in the User model
    await User.findByIdAndUpdate(
      userId,
      { $set: { '_count.karma': karmaRecord.totalKarma } },
      { session }
    );

    await session.commitTransaction();

    res.json(createSuccessResponse({
      message: `Awarded ${karmaRule.points} karma for ${action}`,
      newTotal: karmaRecord.totalKarma,
    }));
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Invalid karma award data',
        errors: error.errors,
      });
      return;
    }

    logger.error('Error awarding karma:', error);
    res.status(500).json(createErrorResponse('Error awarding karma'));
  } finally {
    session.endSession();
  }
};

/**
 * Deducts karma from a user
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const deductKarma = async (req: AuthRequest, res: Response): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = DEDUCT_KARMA_SCHEMA.parse(req.body);
    const { userId, action, points, description, targetContentId } = validatedData;

    // Get source user ID (who triggered the action)
    const sourceUserId = req.user?._id;

    if (!isValidObjectId(userId)) {
      res.status(400).json(createErrorResponse('Invalid user ID', 'INVALID_USER_ID'));
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json(createErrorResponse('User not found', 'USER_NOT_FOUND'));
      return;
    }

    // Find or create karma record
    let karmaRecord = await Karma.findOne({ userId }).session(session);
    if (!karmaRecord) {
      karmaRecord = new Karma({
        userId,
        totalKarma: 0,
        history: [],
      });
    }

    // Check for cooldown if applicable (using a default 5-minute cooldown for deductions)
    const cooldownThreshold = new Date();
    cooldownThreshold.setMinutes(cooldownThreshold.getMinutes() - 5);

    const recentSameAction = karmaRecord.history.find(
      (item) =>
        item.action === action && item.timestamp > cooldownThreshold
    );

    if (recentSameAction) {
      res.status(429).json(createErrorResponse(
        'This action is on cooldown. Please try again later.',
        'COOLDOWN_ACTIVE'
      ));
      return;
    }

    // Deduct karma (ensure it doesn't go below 0)
    const newTotal = Math.max(0, karmaRecord.totalKarma - points);
    const actualDeduction = karmaRecord.totalKarma - newTotal;
    karmaRecord.totalKarma = newTotal;

    karmaRecord.history.push({
      action,
      points: -actualDeduction, // Negative points for deductions
      timestamp: new Date(),
      description: description || `Deduction for ${action}`,
      sourceUserId,
      targetContentId,
    });

    await karmaRecord.save({ session });

    // Update user's karma count in the User model
    await User.findByIdAndUpdate(
      userId,
      { $set: { '_count.karma': karmaRecord.totalKarma } },
      { session }
    );

    await session.commitTransaction();

    res.json(createSuccessResponse({
      message: `Deducted ${actualDeduction} karma for ${action}`,
      newTotal: karmaRecord.totalKarma,
    }));
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Invalid karma deduction data',
        errors: error.errors,
      });
      return;
    }

    logger.error('Error deducting karma:', error);
    res.status(500).json(createErrorResponse('Error deducting karma'));
  } finally {
    session.endSession();
  }
};

/**
 * Retrieves karma leaderboard
 * @param req - Express request
 * @param res - Express response
 */
export const getKarmaLeaderboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string) || DEFAULT_LEADERBOARD_LIMIT;
    const offset = parseInt(req.query.offset as string) || DEFAULT_OFFSET;

    if (!validatePaginationParams(limit, offset)) {
      res.status(400).json(createErrorResponse('Invalid pagination parameters', 'INVALID_PAGINATION'));
      return;
    }

    const leaderboard = await Karma.find({})
      .sort({ totalKarma: -1 })
      .skip(offset)
      .limit(limit)
      .populate('userId', 'username name avatar _id');

    const formattedLeaderboard = leaderboard.map((karma) => ({
      userId: karma.userId,
      totalKarma: karma.totalKarma,
      rank: offset + leaderboard.indexOf(karma) + 1,
    }));

    res.json(createSuccessResponse({
      leaderboard: formattedLeaderboard,
      hasMore: formattedLeaderboard.length === limit,
    }));
  } catch (error) {
    logger.error('Error fetching karma leaderboard:', error);
    res.status(500).json(createErrorResponse('Error fetching leaderboard'));
  }
};

/**
 * Retrieves karma rules
 * @param req - Express request
 * @param res - Express response
 */
export const getKarmaRules = async (req: Request, res: Response): Promise<void> => {
  try {
    // Only return enabled rules with positive points (for client display)
    const rules = await KarmaRule.find({ isEnabled: true, points: { $gt: 0 } })
      .sort({ category: 1, action: 1 });

    const formattedRules = rules.map((rule) => ({
      id: rule._id,
      action: rule.action,
      points: rule.points,
      description: rule.description,
      cooldownInMinutes: rule.cooldownInMinutes,
      category: rule.category,
    }));

    res.json(createSuccessResponse({ rules: formattedRules }));
  } catch (error) {
    logger.error('Error fetching karma rules:', error);
    res.status(500).json(createErrorResponse('Error fetching karma rules'));
  }
};

/**
 * Creates or updates a karma rule (admin only)
 * @param req - Express request
 * @param res - Express response
 */
export const createOrUpdateKarmaRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = KARMA_RULE_SCHEMA.parse(req.body);
    const {
      action,
      points,
      description,
      cooldownInMinutes = 0,
      isEnabled = true,
      category = 'other',
    } = validatedData;

    // Check if rule already exists
    const existingRule = await KarmaRule.findOne({ action });
    let rule;

    if (existingRule) {
      // Update existing rule
      existingRule.points = points;
      existingRule.description = description || existingRule.description;
      existingRule.cooldownInMinutes = cooldownInMinutes;
      existingRule.isEnabled = isEnabled;
      existingRule.category = category;
      rule = await existingRule.save();
    } else {
      // Create new rule
      rule = new KarmaRule({
        action,
        points,
        description,
        cooldownInMinutes,
        isEnabled,
        category,
      });
      await rule.save();
    }

    res.json(createSuccessResponse({
      message: existingRule ? 'Karma rule updated successfully' : 'Karma rule created successfully',
      rule: {
        id: rule._id,
        action: rule.action,
        points: rule.points,
        description: rule.description,
        cooldownInMinutes: rule.cooldownInMinutes,
        isEnabled: rule.isEnabled,
        category: rule.category,
      },
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Invalid karma rule data',
        errors: error.errors,
      });
      return;
    }

    logger.error('Error creating/updating karma rule:', error);
    res.status(500).json(createErrorResponse('Error creating/updating karma rule'));
  }
}; 