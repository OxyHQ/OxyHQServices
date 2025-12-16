import { Response, Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import { AuthRequest } from '../middleware/auth';
import Karma from '../models/Karma';
import KarmaRule from '../models/KarmaRule';
import User from '../models/User';
import { logger } from '../utils/logger';
import { resolveUserIdToObjectId, validatePagination } from '../utils/validation';
import { sendSuccess, sendPaginated } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError, ConflictError, InternalServerError } from '../utils/error';
import { KARMA, PAGINATION } from '../utils/constants';

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

    if (!userId) {
      logger.warn('getUserKarmaTotal: Missing userId parameter', { params: req.params });
      throw new BadRequestError('User ID is required');
    }

    // Resolve userId (ObjectId or publicKey) to ObjectId
    const userObjectId = await resolveUserIdToObjectId(userId);

    const user = await User.findById(userObjectId);
    if (!user) {
      logger.warn('getUserKarmaTotal: User not found after resolution', { userId, userObjectId });
      throw new NotFoundError('User not found');
    }

    const karmaRecord = await Karma.findOne({ userId: userObjectId });
    const totalKarma = karmaRecord?.totalKarma || 0;

    sendSuccess(res, {
      userId: user.publicKey || userObjectId, // Return publicKey if available, otherwise ObjectId
      totalKarma,
      username: user.username,
    });
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof NotFoundError) {
      throw error;
    }
    logger.error('Error fetching user karma total', { 
      error: error instanceof Error ? error.message : String(error),
      userId: req.params.userId,
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new InternalServerError('Error fetching karma total');
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
    const { limit: parsedLimit, offset: parsedOffset } = validatePagination(
      req.query.limit,
      req.query.offset,
      PAGINATION.MAX_LIMIT,
      KARMA.DEFAULT_HISTORY_LIMIT
    );

    if (!userId) {
      logger.warn('getUserKarmaHistory: Missing userId parameter', { params: req.params });
      throw new BadRequestError('User ID is required');
    }

    // Resolve userId (ObjectId or publicKey) to ObjectId
    const userObjectId = await resolveUserIdToObjectId(userId);

    const user = await User.findById(userObjectId);
    if (!user) {
      logger.warn('getUserKarmaHistory: User not found after resolution', { userId, userObjectId });
      throw new NotFoundError('User not found');
    }

    const karmaRecord = await Karma.findOne({ userId: userObjectId });
    if (!karmaRecord) {
      sendSuccess(res, {
        userId: user.publicKey || userObjectId, // Return publicKey if available, otherwise ObjectId
        totalKarma: 0,
        history: [],
      });
      return;
    }

    const history = karmaRecord.history
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(parsedOffset, parsedOffset + parsedLimit);

    sendPaginated(res, history, karmaRecord.history.length, parsedLimit, parsedOffset);
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof NotFoundError) {
      throw error;
    }
    logger.error('Error fetching user karma history', { 
      error: error instanceof Error ? error.message : String(error),
      userId: req.params.userId,
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new InternalServerError('Error fetching karma history');
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

    if (!userId) {
      logger.warn('awardKarma: Missing userId in request body', { body: req.body });
      throw new BadRequestError('User ID is required');
    }

    // Resolve userId (ObjectId or publicKey) to ObjectId
    const userObjectId = await resolveUserIdToObjectId(userId);

    const user = await User.findById(userObjectId);
    if (!user) {
      logger.warn('awardKarma: User not found after resolution', { userId, userObjectId });
      throw new NotFoundError('User not found');
    }

    // Check if karma rule exists and is enabled
    const karmaRule = await KarmaRule.findOne({ action, isEnabled: true });
    if (!karmaRule) {
      throw new BadRequestError('Invalid or disabled karma action');
    }

    // Points should be positive for awards
    if (karmaRule.points <= 0) {
      throw new BadRequestError('Karma rule does not award positive points');
    }

    // Find or create karma record
    let karmaRecord = await Karma.findOne({ userId: userObjectId }).session(session);
    if (!karmaRecord) {
      karmaRecord = new Karma({
        userId: userObjectId,
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
        throw new ConflictError('This action is on cooldown. Please try again later.');
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
      userObjectId,
      { $set: { '_count.karma': karmaRecord.totalKarma } },
      { session }
    );

    await session.commitTransaction();

    sendSuccess(res, {
      message: `Awarded ${karmaRule.points} karma for ${action}`,
      newTotal: karmaRecord.totalKarma,
    });
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      throw new BadRequestError('Invalid karma award data', { errors: error.errors });
    }
    if (error instanceof BadRequestError || error instanceof NotFoundError || error instanceof ConflictError) {
      throw error;
    }

    logger.error('Error awarding karma', { 
      error: error instanceof Error ? error.message : String(error),
      userId: req.body?.userId,
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new InternalServerError('Error awarding karma');
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

    if (!userId) {
      logger.warn('deductKarma: Missing userId in request body', { body: req.body });
      throw new BadRequestError('User ID is required');
    }

    // Resolve userId (ObjectId or publicKey) to ObjectId
    const userObjectId = await resolveUserIdToObjectId(userId);

    const user = await User.findById(userObjectId);
    if (!user) {
      logger.warn('deductKarma: User not found after resolution', { userId, userObjectId });
      throw new NotFoundError('User not found');
    }

    // Find or create karma record
    let karmaRecord = await Karma.findOne({ userId: userObjectId }).session(session);
    if (!karmaRecord) {
      karmaRecord = new Karma({
        userId: userObjectId,
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
      throw new ConflictError('This action is on cooldown. Please try again later.');
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
      userObjectId,
      { $set: { '_count.karma': karmaRecord.totalKarma } },
      { session }
    );

    await session.commitTransaction();

    sendSuccess(res, {
      message: `Deducted ${actualDeduction} karma for ${action}`,
      newTotal: karmaRecord.totalKarma,
    });
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      throw new BadRequestError('Invalid karma deduction data', { errors: error.errors });
    }
    if (error instanceof BadRequestError || error instanceof NotFoundError || error instanceof ConflictError) {
      throw error;
    }

    logger.error('Error deducting karma', { 
      error: error instanceof Error ? error.message : String(error),
      userId: req.body?.userId,
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new InternalServerError('Error deducting karma');
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
    const { limit: parsedLimit, offset: parsedOffset } = validatePagination(
      req.query.limit,
      req.query.offset,
      PAGINATION.MAX_LIMIT,
      KARMA.DEFAULT_LEADERBOARD_LIMIT
    );

    const total = await Karma.countDocuments({});
    const leaderboard = await Karma.find({})
      .sort({ totalKarma: -1 })
      .skip(parsedOffset)
      .limit(parsedLimit)
      .populate('userId', 'username name avatar _id');

    const formattedLeaderboard = leaderboard.map((karma, index) => ({
      userId: karma.userId,
      totalKarma: karma.totalKarma,
      rank: parsedOffset + index + 1,
    }));

    sendPaginated(res, formattedLeaderboard, total, parsedLimit, parsedOffset);
  } catch (error) {
    logger.error('Error fetching karma leaderboard', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Error fetching leaderboard');
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

    sendSuccess(res, { rules: formattedRules });
  } catch (error) {
    logger.error('Error fetching karma rules', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Error fetching karma rules');
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

    sendSuccess(res, {
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
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError('Invalid karma rule data', { errors: error.errors });
    }
    if (error instanceof BadRequestError) {
      throw error;
    }

    logger.error('Error creating/updating karma rule', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Error creating/updating karma rule');
  }
}; 