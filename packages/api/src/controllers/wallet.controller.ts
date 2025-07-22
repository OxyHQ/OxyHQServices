import { Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import { AuthRequest } from '../middleware/auth';
import Transaction from '../models/Transaction';
import User from '../models/User';
import Wallet from '../models/Wallet';
import { logger } from '../utils/logger';

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

const DEFAULT_TRANSACTION_LIMIT = 10;
const MAX_TRANSACTION_LIMIT = 100;
const DEFAULT_TRANSACTION_OFFSET = 0;

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
 * Checks if the requesting user has permission to access a resource
 * @param requestingUserId - The ID of the user making the request
 * @param resourceUserId - The ID of the user who owns the resource
 * @returns Promise<boolean> - True if user has permission
 */
async function hasPermission(requestingUserId: string, resourceUserId: string): Promise<boolean> {
  if (requestingUserId === resourceUserId) {
    return true;
  }

  const requestingUser = await User.findById(requestingUserId);
  return requestingUser?.username.includes('admin') ?? false;
}

/**
 * Creates a standardized error response
 */
function createErrorResponse(statusCode: number, message: string) {
  return {
    success: false,
    message,
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
      res.status(401).json(createErrorResponse(401, 'Authentication required'));
      return;
    }

    // Validate ObjectId format
    if (!isValidObjectId(userId)) {
      res.status(400).json(createErrorResponse(400, 'Invalid user ID format'));
      return;
    }

    // Check permissions
    const hasAccess = await hasPermission(req.user._id.toString(), userId);
    if (!hasAccess) {
      res.status(403).json(createErrorResponse(403, 'You do not have permission to view this wallet'));
      return;
    }

    // Find or create wallet
    let wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0 });
      await wallet.save();
    }

    res.json(createSuccessResponse({
      userId,
      balance: wallet.balance,
      address: wallet.address || null,
    }));
  } catch (error) {
    logger.error('Error fetching wallet:', error);
    res.status(500).json(createErrorResponse(500, 'Server error when fetching wallet'));
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
    const limit = Math.min(
      parseInt(req.query.limit as string) || DEFAULT_TRANSACTION_LIMIT,
      MAX_TRANSACTION_LIMIT
    );
    const offset = parseInt(req.query.offset as string) || DEFAULT_TRANSACTION_OFFSET;

    // Validate user authentication
    if (!req.user) {
      res.status(401).json(createErrorResponse(401, 'Authentication required'));
      return;
    }

    // Validate ObjectId format
    if (!isValidObjectId(userId)) {
      res.status(400).json(createErrorResponse(400, 'Invalid user ID format'));
      return;
    }

    // Check permissions
    const hasAccess = await hasPermission(req.user._id.toString(), userId);
    if (!hasAccess) {
      res.status(403).json(createErrorResponse(403, 'You do not have permission to view these transactions'));
      return;
    }

    // Fetch transactions
    const transactions = await Transaction.find({
      $or: [{ userId }, { recipientId: userId }],
    })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
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

    res.json(createSuccessResponse({ transactions: formattedTransactions }));
  } catch (error) {
    logger.error('Error fetching transaction history:', error);
    res.status(500).json(createErrorResponse(500, 'Server error when fetching transaction history'));
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
      res.status(401).json(createErrorResponse(401, 'Authentication required'));
      return;
    }

    // Prevent self-transfer
    if (fromUserId === toUserId) {
      res.status(400).json(createErrorResponse(400, 'Cannot transfer funds to the same user'));
      return;
    }

    // Check permissions
    const hasAccess = await hasPermission(req.user._id.toString(), fromUserId);
    if (!hasAccess) {
      res.status(403).json(createErrorResponse(403, 'You do not have permission to transfer from this account'));
      return;
    }

    // Validate ObjectId formats
    if (!isValidObjectId(fromUserId) || !isValidObjectId(toUserId)) {
      res.status(400).json(createErrorResponse(400, 'Invalid user ID format'));
      return;
    }

    // Verify both users exist
    const [fromUser, toUser] = await Promise.all([
      User.findById(fromUserId).session(session),
      User.findById(toUserId).session(session),
    ]);

    if (!fromUser || !toUser) {
      res.status(404).json(createErrorResponse(404, 
        !fromUser ? 'Sender user not found' : 'Recipient user not found'
      ));
      return;
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
      res.status(400).json(createErrorResponse(400, 'Insufficient funds'));
      return;
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

    res.json(createSuccessResponse({
      message: 'Transfer completed successfully',
      transaction: {
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        timestamp: transaction.createdAt,
      },
    }));
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Invalid transfer data',
        errors: error.errors,
      });
      return;
    }

    logger.error('Error processing transfer:', error);
    res.status(500).json(createErrorResponse(500, 'Server error when processing transfer'));
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
      res.status(401).json(createErrorResponse(401, 'Authentication required'));
      return;
    }

    // Check permissions
    const hasAccess = await hasPermission(req.user._id.toString(), userId);
    if (!hasAccess) {
      res.status(403).json(createErrorResponse(403, 'You do not have permission to make purchases from this account'));
      return;
    }

    // Validate ObjectId format
    if (!isValidObjectId(userId)) {
      res.status(400).json(createErrorResponse(400, 'Invalid user ID format'));
      return;
    }

    // Verify user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      res.status(404).json(createErrorResponse(404, 'User not found'));
      return;
    }

    // Find or create wallet
    let wallet = await Wallet.findOne({ userId }).session(session);
    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0 });
    }

    // Check sufficient funds
    if (wallet.balance < amount) {
      res.status(400).json(createErrorResponse(400, 'Insufficient funds'));
      return;
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

    res.json(createSuccessResponse({
      message: 'Purchase completed successfully',
      transaction: {
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        timestamp: transaction.createdAt,
      },
    }));
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Invalid purchase data',
        errors: error.errors,
      });
      return;
    }

    logger.error('Error processing purchase:', error);
    res.status(500).json(createErrorResponse(500, 'Server error when processing purchase'));
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
      res.status(401).json(createErrorResponse(401, 'Authentication required'));
      return;
    }

    // Check permissions
    const hasAccess = await hasPermission(req.user._id.toString(), userId);
    if (!hasAccess) {
      res.status(403).json(createErrorResponse(403, 'You do not have permission to withdraw from this account'));
      return;
    }

    // Validate ObjectId format
    if (!isValidObjectId(userId)) {
      res.status(400).json(createErrorResponse(400, 'Invalid user ID format'));
      return;
    }

    // Verify user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      res.status(404).json(createErrorResponse(404, 'User not found'));
      return;
    }

    // Find or create wallet
    let wallet = await Wallet.findOne({ userId }).session(session);
    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0 });
    }

    // Check sufficient funds
    if (wallet.balance < amount) {
      res.status(400).json(createErrorResponse(400, 'Insufficient funds'));
      return;
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

    res.json(createSuccessResponse({
      message: 'Withdrawal request submitted and pending approval',
      transaction: {
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        timestamp: transaction.createdAt,
      },
    }));
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Invalid withdrawal data',
        errors: error.errors,
      });
      return;
    }

    logger.error('Error requesting withdrawal:', error);
    res.status(500).json(createErrorResponse(500, 'Server error when requesting withdrawal'));
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
      res.status(401).json(createErrorResponse(401, 'Authentication required'));
      return;
    }

    // Validate ObjectId format
    if (!isValidObjectId(transactionId)) {
      res.status(400).json(createErrorResponse(400, 'Invalid transaction ID format'));
      return;
    }

    // Fetch transaction with populated user data
    const transaction = await Transaction.findById(transactionId)
      .populate('userId', 'username')
      .populate('recipientId', 'username');

    if (!transaction) {
      res.status(404).json(createErrorResponse(404, 'Transaction not found'));
      return;
    }

    // Check permissions - user can view if they're the sender, recipient, or admin
    const isSender = req.user._id.toString() === transaction.userId.toString();
    const isRecipient = req.user._id.toString() === (transaction.recipientId?.toString() || '');
    
    if (!isSender && !isRecipient) {
      const hasAccess = await hasPermission(req.user._id.toString(), transaction.userId.toString());
      if (!hasAccess) {
        res.status(403).json(createErrorResponse(403, 'You do not have permission to view this transaction'));
        return;
      }
    }

    res.json(createSuccessResponse({
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
    }));
  } catch (error) {
    logger.error('Error fetching transaction:', error);
    res.status(500).json(createErrorResponse(500, 'Server error when fetching transaction'));
  }
}; 