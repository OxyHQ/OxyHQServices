/**
 * Managed Account Service
 *
 * Business logic for creating and managing sub-accounts (managed identities).
 * Sub-accounts are full User documents without passwords, accessible only
 * by their owners/managers via the X-Acting-As header mechanism.
 */

import mongoose from 'mongoose';
import User, { IUser } from '../models/User';
import ManagedAccount, { IManagedAccount } from '../models/ManagedAccount';
import { getUserKeyPair } from './federation.service';
import { logger } from '../utils/logger';

type ManagerRole = 'owner' | 'admin' | 'editor';

interface CreateManagedAccountInput {
  username: string;
  name?: { first?: string; last?: string };
  bio?: string;
  avatar?: string;
}

interface UpdateManagedAccountInput {
  username?: string;
  name?: { first?: string; last?: string };
  bio?: string;
  avatar?: string;
  color?: string;
  description?: string;
  links?: string[];
}

interface ManagedAccountResponse {
  account: IManagedAccount;
  user: IUser;
}

export class ManagedAccountService {
  /**
   * Create a new managed account (sub-account) for the given owner.
   *
   * Creates a User document (no password, isManagedAccount: true, verified: true)
   * and a ManagedAccount document linking it to the owner.
   * Also generates an ActivityPub keypair so the sub-account can federate.
   */
  async createManagedAccount(
    ownerId: string,
    data: CreateManagedAccountInput
  ): Promise<ManagedAccountResponse> {
    if (!data.username || typeof data.username !== 'string') {
      throw new Error('Username is required');
    }

    const username = data.username.trim().toLowerCase();
    if (!username) {
      throw new Error('Username is required');
    }

    // Validate username format (alphanumeric, underscores, hyphens, dots)
    if (!/^[\w.-]+$/.test(username)) {
      throw new Error('Username may only contain letters, numbers, underscores, hyphens, and dots');
    }

    // Check uniqueness against all users
    const existing = await User.findOne({ username }).lean();
    if (existing) {
      throw new Error('Username already exists');
    }

    // Verify owner exists
    const owner = await User.findById(ownerId).lean();
    if (!owner) {
      throw new Error('Owner user not found');
    }

    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);

    // Create the User document -- no password, no email, no auth methods
    const user = new User({
      username,
      name: data.name || {},
      bio: data.bio || '',
      avatar: data.avatar || undefined,
      authMethods: [],
      verified: true,
      isManagedAccount: true,
      managedBy: ownerObjectId,
      type: 'local',
    });

    await user.save();

    // Create the ManagedAccount relationship document
    const managedAccount = new ManagedAccount({
      accountId: user._id,
      ownerId: ownerObjectId,
      managers: [
        {
          userId: ownerObjectId,
          role: 'owner' as ManagerRole,
          addedAt: new Date(),
          addedBy: ownerObjectId,
        },
      ],
    });

    await managedAccount.save();

    // Generate ActivityPub keypair in the background (non-blocking)
    getUserKeyPair(username).catch((err) => {
      logger.warn('Failed to generate keypair for managed account', {
        username,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info('Managed account created', {
      accountId: user._id.toString(),
      ownerId,
      username,
    });

    return { account: managedAccount, user };
  }

  /**
   * Get all managed accounts where the given user is in the managers array.
   */
  async getManagedAccounts(userId: string): Promise<ManagedAccountResponse[]> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const managedAccounts = await ManagedAccount.find({
      'managers.userId': userObjectId,
    }).lean();

    if (managedAccounts.length === 0) {
      return [];
    }

    // Fetch all associated User documents in one query
    const accountIds = managedAccounts.map((ma) => ma.accountId);
    const users = await User.find({ _id: { $in: accountIds } })
      .select('-password -refreshToken')
      .lean({ virtuals: true });

    const userMap = new Map(
      users.map((u) => [(u as unknown as IUser)._id.toString(), u as unknown as IUser])
    );

    return managedAccounts
      .map((account) => {
        const user = userMap.get(account.accountId.toString());
        if (!user) return null;
        return { account: account as unknown as IManagedAccount, user };
      })
      .filter((item): item is ManagedAccountResponse => item !== null);
  }

  /**
   * Get details for a specific managed account.
   */
  async getManagedAccountDetails(
    accountId: string
  ): Promise<ManagedAccountResponse | null> {
    const managedAccount = await ManagedAccount.findOne({
      accountId: new mongoose.Types.ObjectId(accountId),
    }).lean();

    if (!managedAccount) return null;

    const user = (await User.findById(accountId)
      .select('-password -refreshToken')
      .lean({ virtuals: true })) as IUser | null;

    if (!user) return null;

    return {
      account: managedAccount as unknown as IManagedAccount,
      user,
    };
  }

  /**
   * Update a managed account's User document.
   * Requester must be owner or admin.
   */
  async updateManagedAccount(
    accountId: string,
    requesterId: string,
    data: UpdateManagedAccountInput
  ): Promise<ManagedAccountResponse> {
    const role = await this.getManagerRole(accountId, requesterId);
    if (!role || role === 'editor') {
      throw new Error('Forbidden: insufficient permissions to update this account');
    }

    // If username is being changed, validate uniqueness
    if (data.username) {
      const username = data.username.trim().toLowerCase();
      if (!/^[\w.-]+$/.test(username)) {
        throw new Error('Username may only contain letters, numbers, underscores, hyphens, and dots');
      }
      const existing = await User.findOne({
        username,
        _id: { $ne: new mongoose.Types.ObjectId(accountId) },
      }).lean();
      if (existing) {
        throw new Error('Username already exists');
      }
      data.username = username;
    }

    const user = await User.findById(accountId).select('-password -refreshToken');
    if (!user) {
      throw new Error('Managed account user not found');
    }

    // Apply allowed updates
    const allowedFields = ['username', 'name', 'bio', 'avatar', 'color', 'description', 'links'] as const;
    for (const key of allowedFields) {
      if (data[key] !== undefined) {
        user.set(key, data[key]);
      }
    }

    await user.save();

    const managedAccount = await ManagedAccount.findOne({
      accountId: new mongoose.Types.ObjectId(accountId),
    }).lean();

    if (!managedAccount) {
      throw new Error('ManagedAccount relationship not found');
    }

    const userObj = user.toObject({ virtuals: true }) as IUser;

    return {
      account: managedAccount as unknown as IManagedAccount,
      user: userObj,
    };
  }

  /**
   * Delete a managed account. Only the owner can delete.
   * Removes both the ManagedAccount document and the User document.
   */
  async deleteManagedAccount(
    accountId: string,
    requesterId: string
  ): Promise<void> {
    const role = await this.getManagerRole(accountId, requesterId);
    if (role !== 'owner') {
      throw new Error('Forbidden: only the owner can delete a managed account');
    }

    const accountObjectId = new mongoose.Types.ObjectId(accountId);

    const [deletedMA, deletedUser] = await Promise.all([
      ManagedAccount.findOneAndDelete({ accountId: accountObjectId }),
      User.findByIdAndDelete(accountId),
    ]);

    if (!deletedMA) {
      throw new Error('Managed account not found');
    }

    logger.info('Managed account deleted', {
      accountId,
      requesterId,
      username: deletedUser?.username,
    });
  }

  /**
   * Add a manager to a managed account.
   * Requester must be owner or admin.
   */
  async addManager(
    accountId: string,
    requesterId: string,
    targetUserId: string,
    role: ManagerRole
  ): Promise<IManagedAccount> {
    const requesterRole = await this.getManagerRole(accountId, requesterId);
    if (!requesterRole || requesterRole === 'editor') {
      throw new Error('Forbidden: insufficient permissions to manage managers');
    }

    // Only owners can add other owners/admins
    if (role === 'owner' && requesterRole !== 'owner') {
      throw new Error('Forbidden: only the owner can assign the owner role');
    }

    // Verify target user exists
    const targetUser = await User.findById(targetUserId).lean();
    if (!targetUser) {
      throw new Error('Target user not found');
    }

    const accountObjectId = new mongoose.Types.ObjectId(accountId);
    const targetObjectId = new mongoose.Types.ObjectId(targetUserId);

    // Check if already a manager
    const managedAccount = await ManagedAccount.findOne({
      accountId: accountObjectId,
    });
    if (!managedAccount) {
      throw new Error('Managed account not found');
    }

    const existingManager = managedAccount.managers.find(
      (m) => m.userId.toString() === targetUserId
    );
    if (existingManager) {
      throw new Error('User is already a manager of this account');
    }

    managedAccount.managers.push({
      userId: targetObjectId,
      role,
      addedAt: new Date(),
      addedBy: new mongoose.Types.ObjectId(requesterId),
    });

    await managedAccount.save();

    logger.info('Manager added to managed account', {
      accountId,
      targetUserId,
      role,
      addedBy: requesterId,
    });

    return managedAccount;
  }

  /**
   * Remove a manager from a managed account.
   * Only the owner can remove managers. The owner themselves cannot be removed.
   */
  async removeManager(
    accountId: string,
    requesterId: string,
    targetUserId: string
  ): Promise<IManagedAccount> {
    const requesterRole = await this.getManagerRole(accountId, requesterId);
    if (requesterRole !== 'owner') {
      throw new Error('Forbidden: only the owner can remove managers');
    }

    const accountObjectId = new mongoose.Types.ObjectId(accountId);

    const managedAccount = await ManagedAccount.findOne({
      accountId: accountObjectId,
    });
    if (!managedAccount) {
      throw new Error('Managed account not found');
    }

    // Cannot remove the owner
    if (managedAccount.ownerId.toString() === targetUserId) {
      throw new Error('Cannot remove the primary owner from managers');
    }

    const managerIndex = managedAccount.managers.findIndex(
      (m) => m.userId.toString() === targetUserId
    );
    if (managerIndex === -1) {
      throw new Error('User is not a manager of this account');
    }

    managedAccount.managers.splice(managerIndex, 1);
    await managedAccount.save();

    logger.info('Manager removed from managed account', {
      accountId,
      targetUserId,
      removedBy: requesterId,
    });

    return managedAccount;
  }

  /**
   * Verify whether a user can act as a given managed account.
   * Returns the manager's role if authorized, null otherwise.
   * This is the lightweight check used by the acting-as middleware.
   */
  async verifyActingAs(
    userId: string,
    accountId: string
  ): Promise<ManagerRole | null> {
    return this.getManagerRole(accountId, userId);
  }

  /**
   * Get the role of a user for a specific managed account.
   * Returns null if the user is not a manager.
   */
  private async getManagerRole(
    accountId: string,
    userId: string
  ): Promise<ManagerRole | null> {
    const managedAccount = await ManagedAccount.findOne({
      accountId: new mongoose.Types.ObjectId(accountId),
      'managers.userId': new mongoose.Types.ObjectId(userId),
    }).lean();

    if (!managedAccount) return null;

    const manager = managedAccount.managers.find(
      (m) => m.userId.toString() === userId
    );

    return (manager?.role as ManagerRole) ?? null;
  }
}

// Export singleton instance
export const managedAccountService = new ManagedAccountService();
export default managedAccountService;
