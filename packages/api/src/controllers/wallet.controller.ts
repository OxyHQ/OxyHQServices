import { Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import { AuthRequest } from '../middleware/auth';
import Transaction from '../models/Transaction';
import User from '../models/User';
import Wallet from '../models/Wallet';
import { logger } from '../utils/logger';
import { isValidObjectId, validatePagination } from '../utils/validation';
import { sendSuccess, sendPaginated } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError, ForbiddenError, UnauthorizedError, InternalServerError } from '../utils/error';
import { TRANSACTION, PAGINATION } from '../utils/constants';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const TRANSFER_SCHEMA = z.object({
  fromUserId: z.string().min(1, 'From user ID is required'),
  toUserId: z.string().min(1, 'To user ID is required'),
  amount: z.number().positive('Amount must be positive'),
  description: z.string().optional(),
});

const WITHDRAWAL_SCHEMA = z.object({
  userId: z.string().min(1, 'User ID is required'),
  amount: z.number().positive('Amount must be positive'),
  address: z.string().min(1, 'Address is required'),
});

const PURCHASE_SCHEMA = z.object({
  userId: z.string().min(1, 'User ID is required'),
  amount: z.number().positive('Amount must be positive'),
  itemId: z.string().min(1, 'Item ID is required'),
  itemType: z.string().min(1, 'Item type is required'),
  description: z.string().optional(),
});

// =============================================================================
// CONSTANTS
// =============================================================================

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Checks if the requesting user has permission to access a resource.
 * Currently only allows self-access. Extend with proper RBAC when admin roles are implemented.
 */
function hasPermission(requestingUserId: string, resourceUserId: string): boolean {
  return requestingUserId === resourceUserId;
}

// =============================================================================
// CONTROLLER FUNCTIONS
// =============================================================================

/**
 * Retrieves wallet information for a user
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const getWallet = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    // Validate user authentication
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Validate ObjectId format
    if (!isValidObjectId(userId)) {
      throw new BadRequestError('Invalid user ID format');
    }

    // Check permissions
    const hasAccess = hasPermission(req.user._id.toString(), userId);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to view this wallet');
    }

    // Find or create wallet
    let wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0 });
      await wallet.save();
    }

    sendSuccess(res, {
      userId,
      balance: wallet.balance,
      address: wallet.address || null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof BadRequestError || error instanceof ForbiddenError) {
      throw error;
    }
    logger.error('Error fetching wallet', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Server error when fetching wallet');
  }
};

/**
 * Retrieves transaction history for a user
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const getTransactionHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { limit: parsedLimit, offset: parsedOffset } = validatePagination(
      req.query.limit,
      req.query.offset,
      TRANSACTION.MAX_LIMIT,
      TRANSACTION.DEFAULT_LIMIT
    );

    // Validate user authentication
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Validate ObjectId format
    if (!isValidObjectId(userId)) {
      throw new BadRequestError('Invalid user ID format');
    }

    // Check permissions
    const hasAccess = hasPermission(req.user._id.toString(), userId);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to view these transactions');
    }

    // Fetch transactions
    const total = await Transaction.countDocuments({
      $or: [{ userId }, { recipientId: userId }],
    });
    const transactions = await Transaction.find({
      $or: [{ userId }, { recipientId: userId }],
    })
      .sort({ createdAt: -1 })
      .skip(parsedOffset)
      .limit(parsedLimit)
      .populate('userId', 'username')
      .populate('recipientId', 'username');

    const formattedTransactions = transactions.map((transaction) => ({
      id: transaction._id,
      userId: transaction.userId,
      type: transaction.type,
      amount: transaction.amount,
      status: transaction.status,
      description: transaction.description,
      recipientId: transaction.recipientId,
      itemId: transaction.itemId,
      itemType: transaction.itemType,
      timestamp: transaction.createdAt,
      completedAt: transaction.completedAt,
    }));

    sendPaginated(res, formattedTransactions, total, parsedLimit, parsedOffset);
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof BadRequestError || error instanceof ForbiddenError) {
      throw error;
    }
    logger.error('Error fetching transaction history', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Server error when fetching transaction history');
  }
};

/**
 * Transfers funds between users
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const transferFunds = async (req: AuthRequest, res: Response): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = TRANSFER_SCHEMA.parse(req.body);
    const { fromUserId, toUserId, amount, description } = validatedData;

    // Validate user authentication
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Prevent self-transfer
    if (fromUserId === toUserId) {
      throw new BadRequestError('Cannot transfer funds to the same user');
    }

    // Check permissions
    const hasAccess = hasPermission(req.user._id.toString(), fromUserId);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to transfer from this account');
    }

    // Validate ObjectId formats
    if (!isValidObjectId(fromUserId) || !isValidObjectId(toUserId)) {
      throw new BadRequestError('Invalid user ID format');
    }

    // Verify both users exist
    const [fromUser, toUser] = await Promise.all([
      User.findById(fromUserId).session(session),
      User.findById(toUserId).session(session),
    ]);

    if (!fromUser || !toUser) {
      throw new NotFoundError(!fromUser ? 'Sender user not found' : 'Recipient user not found');
    }

    // Find or create wallets
    let [senderWallet, recipientWallet] = await Promise.all([
      Wallet.findOne({ userId: fromUserId }).session(session),
      Wallet.findOne({ userId: toUserId }).session(session),
    ]);

    if (!senderWallet) {
      senderWallet = new Wallet({ userId: fromUserId, balance: 0 });
    }
    if (!recipientWallet) {
      recipientWallet = new Wallet({ userId: toUserId, balance: 0 });
    }

    // Check sufficient funds
    if (senderWallet.balance < amount) {
      throw new BadRequestError('Insufficient funds');
    }

    // Create transaction record
    const transaction = new Transaction({
      userId: fromUserId,
      recipientId: toUserId,
      type: 'transfer',
      amount,
      status: 'completed',
      description: description || `Transfer to ${toUser.username}`,
      completedAt: new Date(),
    });

    // Update wallet balances
    senderWallet.balance -= amount;
    recipientWallet.balance += amount;

    // Save all changes atomically
    await Promise.all([
      senderWallet.save({ session }),
      recipientWallet.save({ session }),
      transaction.save({ session }),
    ]);

    await session.commitTransaction();

    sendSuccess(res, {
      message: 'Transfer completed successfully',
      transaction: {
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        timestamp: transaction.createdAt,
      },
    });
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      throw new BadRequestError('Invalid transfer data', { errors: error.errors });
    }
    if (error instanceof UnauthorizedError || error instanceof BadRequestError || 
        error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw error;
    }

    logger.error('Error processing transfer', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Server error when processing transfer');
  } finally {
    session.endSession();
  }
};

/**
 * Processes a purchase using FairCoin
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const processPurchase = async (req: AuthRequest, res: Response): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = PURCHASE_SCHEMA.parse(req.body);
    const { userId, amount, itemId, itemType, description } = validatedData;

    // Validate user authentication
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Check permissions
    const hasAccess = hasPermission(req.user._id.toString(), userId);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to make purchases from this account');
    }

    // Validate ObjectId format
    if (!isValidObjectId(userId)) {
      throw new BadRequestError('Invalid user ID format');
    }

    // Verify user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Find or create wallet
    let wallet = await Wallet.findOne({ userId }).session(session);
    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0 });
    }

    // Check sufficient funds
    if (wallet.balance < amount) {
      throw new BadRequestError('Insufficient funds');
    }

    // Create transaction record
    const transaction = new Transaction({
      userId,
      type: 'purchase',
      amount,
      status: 'completed',
      description: description || `Purchase of ${itemType}`,
      itemId,
      itemType,
      completedAt: new Date(),
    });

    // Update wallet balance
    wallet.balance -= amount;

    // Save changes atomically
    await Promise.all([
      wallet.save({ session }),
      transaction.save({ session }),
    ]);

    await session.commitTransaction();

    sendSuccess(res, {
      message: 'Purchase completed successfully',
      transaction: {
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        timestamp: transaction.createdAt,
      },
    });
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      throw new BadRequestError('Invalid purchase data', { errors: error.errors });
    }
    if (error instanceof UnauthorizedError || error instanceof BadRequestError || 
        error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw error;
    }

    logger.error('Error processing purchase', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Server error when processing purchase');
  } finally {
    session.endSession();
  }
};

/**
 * Requests a withdrawal
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const requestWithdrawal = async (req: AuthRequest, res: Response): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = WITHDRAWAL_SCHEMA.parse(req.body);
    const { userId, amount, address } = validatedData;

    // Validate user authentication
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Check permissions
    const hasAccess = hasPermission(req.user._id.toString(), userId);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to withdraw from this account');
    }

    // Validate ObjectId format
    if (!isValidObjectId(userId)) {
      throw new BadRequestError('Invalid user ID format');
    }

    // Verify user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Find or create wallet
    let wallet = await Wallet.findOne({ userId }).session(session);
    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0 });
    }

    // Check sufficient funds
    if (wallet.balance < amount) {
      throw new BadRequestError('Insufficient funds');
    }

    // Create withdrawal transaction
    const transaction = new Transaction({
      userId,
      type: 'withdrawal',
      amount,
      status: 'pending', // Withdrawals start as pending until manually approved
      description: `Withdrawal to ${address.substring(0, 8)}...`,
    });

    // Store the withdrawal address in the wallet
    wallet.address = address;

    // Save changes (but don't deduct balance yet since it's pending)
    await Promise.all([
      wallet.save({ session }),
      transaction.save({ session }),
    ]);

    await session.commitTransaction();

    sendSuccess(res, {
      message: 'Withdrawal request submitted and pending approval',
      transaction: {
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        timestamp: transaction.createdAt,
      },
    });
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      throw new BadRequestError('Invalid withdrawal data', { errors: error.errors });
    }
    if (error instanceof UnauthorizedError || error instanceof BadRequestError || 
        error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw error;
    }

    logger.error('Error requesting withdrawal', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Server error when requesting withdrawal');
  } finally {
    session.endSession();
  }
};

/**
 * Retrieves a specific transaction
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const getTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { transactionId } = req.params;

    // Validate user authentication
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Validate ObjectId format
    if (!isValidObjectId(transactionId)) {
      throw new BadRequestError('Invalid transaction ID format');
    }

    // Fetch transaction with populated user data
    const transaction = await Transaction.findById(transactionId)
      .populate('userId', 'username')
      .populate('recipientId', 'username');

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    // Check permissions - user can view if they're the sender, recipient, or admin
    const isSender = req.user._id.toString() === transaction.userId.toString();
    const isRecipient = req.user._id.toString() === (transaction.recipientId?.toString() || '');
    
    if (!isSender && !isRecipient) {
      const hasAccess = hasPermission(req.user._id.toString(), transaction.userId.toString());
      if (!hasAccess) {
        throw new ForbiddenError('You do not have permission to view this transaction');
      }
    }

    sendSuccess(res, {
      transaction: {
        id: transaction._id,
        userId: transaction.userId,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        description: transaction.description,
        recipientId: transaction.recipientId,
        itemId: transaction.itemId,
        itemType: transaction.itemType,
        timestamp: transaction.createdAt,
        completedAt: transaction.completedAt,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof BadRequestError || 
        error instanceof ForbiddenError || error instanceof NotFoundError) {
      throw error;
    }
    logger.error('Error fetching transaction', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Server error when fetching transaction');
  }
}; 