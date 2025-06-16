import { Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import Wallet from '../models/Wallet';
import Transaction, { TransactionType } from '../models/Transaction';
import User from '../models/User';
import { logger } from '../utils/logger';

// Validation schemas
const transferSchema = z.object({
  fromUserId: z.string(),
  toUserId: z.string(),
  amount: z.number().positive(),
  description: z.string().optional(),
});

const withdrawalSchema = z.object({
  userId: z.string(),
  amount: z.number().positive(),
  address: z.string(),
});

const purchaseSchema = z.object({
  userId: z.string(),
  amount: z.number().positive(),
  itemId: z.string(),
  itemType: z.string(),
  description: z.string().optional(),
});

/**
 * Get wallet information for a user
 */
export const getWallet = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Check if the requester has permission to view this wallet
    // (either it's their own or they have admin privileges)
    if (req.user._id.toString() !== userId) {
      const requestingUser = await User.findById(req.user._id);
      // Simple admin check - in a real app you'd have a proper roles system
      if (!requestingUser || !requestingUser.username.includes('admin')) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this wallet'
        });
      }
    }

    // Find or create wallet
    let wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      // Create a new wallet with zero balance
      wallet = new Wallet({
        userId,
        balance: 0
      });
      await wallet.save();
    }

    return res.json({
      success: true,
      userId: userId,
      balance: wallet.balance,
      address: wallet.address || null
    });
  } catch (error) {
    logger.error('Error fetching wallet:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error when fetching wallet'
    });
  }
};

/**
 * Get transaction history for a user
 */
export const getTransactionHistory = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Check if the requester has permission
    if (req.user._id.toString() !== userId) {
      const requestingUser = await User.findById(req.user._id);
      if (!requestingUser || !requestingUser.username.includes('admin')) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view these transactions'
        });
      }
    }

    // Get transactions where the user is either sender or recipient
    const transactions = await Transaction.find({
      $or: [{ userId }, { recipientId: userId }]
    })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .populate('userId', 'username')
      .populate('recipientId', 'username');

    return res.json({
      success: true,
      transactions: transactions.map(t => ({
        id: t._id,
        userId: t.userId,
        type: t.type,
        amount: t.amount,
        status: t.status,
        description: t.description,
        recipientId: t.recipientId,
        itemId: t.itemId,
        itemType: t.itemType,
        timestamp: t.createdAt,
        completedAt: t.completedAt
      }))
    });
  } catch (error) {
    logger.error('Error fetching transaction history:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error when fetching transaction history'
    });
  }
};

/**
 * Transfer funds between users
 */
export const transferFunds = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = transferSchema.parse(req.body);
    const { fromUserId, toUserId, amount, description } = validatedData;

    if (fromUserId === toUserId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer funds to the same user'
      });
    }

    // Check if the requester has permission
    if (req.user._id.toString() !== fromUserId) {
      const requestingUser = await User.findById(req.user._id);
      if (!requestingUser || !requestingUser.username.includes('admin')) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to transfer from this account'
        });
      }
    }

    // Validate user IDs
    if (!mongoose.Types.ObjectId.isValid(fromUserId) || !mongoose.Types.ObjectId.isValid(toUserId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Verify both users exist
    const [fromUser, toUser] = await Promise.all([
      User.findById(fromUserId).session(session),
      User.findById(toUserId).session(session)
    ]);

    if (!fromUser || !toUser) {
      return res.status(404).json({
        success: false,
        message: !fromUser ? 'Sender user not found' : 'Recipient user not found'
      });
    }

    // Find or create wallets
    let [senderWallet, recipientWallet] = await Promise.all([
      Wallet.findOne({ userId: fromUserId }).session(session),
      Wallet.findOne({ userId: toUserId }).session(session)
    ]);

    if (!senderWallet) {
      senderWallet = new Wallet({ userId: fromUserId, balance: 0 });
    }

    if (!recipientWallet) {
      recipientWallet = new Wallet({ userId: toUserId, balance: 0 });
    }

    // Check if sender has enough funds
    if (senderWallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient funds'
      });
    }

    // Create transaction record
    const transaction = new Transaction({
      userId: fromUserId,
      recipientId: toUserId,
      type: 'transfer',
      amount,
      status: 'completed',
      description: description || `Transfer to ${toUser.username}`,
      completedAt: new Date()
    });

    // Update wallet balances
    senderWallet.balance -= amount;
    recipientWallet.balance += amount;

    // Save everything
    await Promise.all([
      senderWallet.save({ session }),
      recipientWallet.save({ session }),
      transaction.save({ session })
    ]);

    await session.commitTransaction();

    return res.json({
      success: true,
      message: 'Transfer completed successfully',
      transaction: {
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        timestamp: transaction.createdAt
      }
    });
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transfer data',
        errors: error.errors
      });
    }

    logger.error('Error transferring funds:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error when transferring funds'
    });
  } finally {
    session.endSession();
  }
};

/**
 * Process a purchase using FairCoin
 */
export const processPurchase = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = purchaseSchema.parse(req.body);
    const { userId, amount, itemId, itemType, description } = validatedData;

    // Check if the requester has permission
    if (req.user._id.toString() !== userId) {
      const requestingUser = await User.findById(req.user._id);
      if (!requestingUser || !requestingUser.username.includes('admin')) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to make purchases from this account'
        });
      }
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Verify user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find or create wallet
    let wallet = await Wallet.findOne({ userId }).session(session);
    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0 });
    }

    // Check if user has enough funds
    if (wallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient funds'
      });
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
      completedAt: new Date()
    });

    // Update wallet balance
    wallet.balance -= amount;

    // Save changes
    await Promise.all([
      wallet.save({ session }),
      transaction.save({ session })
    ]);

    await session.commitTransaction();

    return res.json({
      success: true,
      message: 'Purchase completed successfully',
      transaction: {
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        timestamp: transaction.createdAt
      }
    });
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid purchase data',
        errors: error.errors
      });
    }

    logger.error('Error processing purchase:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error when processing purchase'
    });
  } finally {
    session.endSession();
  }
};

/**
 * Request a withdrawal
 */
export const requestWithdrawal = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const validatedData = withdrawalSchema.parse(req.body);
    const { userId, amount, address } = validatedData;

    // Check if the requester has permission
    if (req.user._id.toString() !== userId) {
      const requestingUser = await User.findById(req.user._id);
      if (!requestingUser || !requestingUser.username.includes('admin')) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to withdraw from this account'
        });
      }
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Verify user exists
    const user = await User.findById(userId).session(session);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find or create wallet
    let wallet = await Wallet.findOne({ userId }).session(session);
    if (!wallet) {
      wallet = new Wallet({ userId, balance: 0 });
    }

    // Check if user has enough funds
    if (wallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient funds'
      });
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
      transaction.save({ session })
    ]);

    await session.commitTransaction();

    return res.json({
      success: true,
      message: 'Withdrawal request submitted and pending approval',
      transaction: {
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        timestamp: transaction.createdAt
      }
    });
  } catch (error) {
    await session.abortTransaction();

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid withdrawal data',
        errors: error.errors
      });
    }

    logger.error('Error requesting withdrawal:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error when requesting withdrawal'
    });
  } finally {
    session.endSession();
  }
};

/**
 * Get a specific transaction
 */
export const getTransaction = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(transactionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid transaction ID format'
      });
    }

    const transaction = await Transaction.findById(transactionId)
      .populate('userId', 'username')
      .populate('recipientId', 'username');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Check if the requester has permission
    if (
      req.user._id.toString() !== transaction.userId.toString() &&
      req.user._id.toString() !== (transaction.recipientId?.toString() || '')
    ) {
      const requestingUser = await User.findById(req.user._id);
      if (!requestingUser || !requestingUser.username.includes('admin')) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this transaction'
        });
      }
    }

    return res.json({
      success: true,
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
        completedAt: transaction.completedAt
      }
    });
  } catch (error) {
    logger.error('Error fetching transaction:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error when fetching transaction'
    });
  }
}; 