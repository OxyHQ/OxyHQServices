import express from 'express';
import mongoose from 'mongoose';
import { managedAccountService } from '../services/managedAccount.service';
import { logger } from '../utils/logger';

interface AuthenticatedRequest extends express.Request {
  user?: {
    _id: mongoose.Types.ObjectId | string;
    [key: string]: any;
  };
}

const router = express.Router();

/**
 * Helper to extract authenticated user ID from the request.
 */
function getUserId(req: AuthenticatedRequest): string | null {
  return req.user?._id?.toString() || null;
}

/**
 * Helper to validate a string looks like a valid MongoDB ObjectId.
 */
function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}

// ============================================
// POST / — Create a new managed account
// ============================================
router.post('/', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { username, name, bio, avatar } = req.body;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' });
    }

    const result = await managedAccountService.createManagedAccount(userId, {
      username,
      name,
      bio,
      avatar,
    });

    res.status(201).json(result);
  } catch (error: any) {
    if (
      error.message === 'Username already exists' ||
      error.message === 'Username is required' ||
      error.message?.includes('Username may only contain')
    ) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message === 'Owner user not found') {
      return res.status(404).json({ error: error.message });
    }
    logger.error('Error creating managed account:', error);
    res.status(500).json({ error: 'Failed to create managed account' });
  }
});

// ============================================
// GET / — List all managed accounts for the current user
// ============================================
router.get('/', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const accounts = await managedAccountService.getManagedAccounts(userId);
    res.json({ accounts });
  } catch (error: any) {
    logger.error('Error listing managed accounts:', error);
    res.status(500).json({ error: 'Failed to list managed accounts' });
  }
});

// ============================================
// GET /verify — Lightweight verification for the acting-as middleware
// Query params: accountId, userId
// ============================================
router.get('/verify', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { accountId, userId } = req.query;

    if (
      !accountId ||
      !userId ||
      typeof accountId !== 'string' ||
      typeof userId !== 'string'
    ) {
      return res.status(400).json({ error: 'accountId and userId query parameters are required' });
    }

    if (!isValidObjectId(accountId) || !isValidObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid accountId or userId format' });
    }

    const role = await managedAccountService.verifyActingAs(userId, accountId);

    if (!role) {
      return res.json({ authorized: false, role: null });
    }

    res.json({ authorized: true, role });
  } catch (error: any) {
    logger.error('Error verifying acting-as:', error);
    res.status(500).json({ error: 'Failed to verify acting-as' });
  }
});

// ============================================
// GET /:accountId — Get managed account details
// ============================================
router.get('/:accountId', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { accountId } = req.params;
    if (!isValidObjectId(accountId)) {
      return res.status(400).json({ error: 'Invalid accountId format' });
    }

    const result = await managedAccountService.getManagedAccountDetails(accountId);
    if (!result) {
      return res.status(404).json({ error: 'Managed account not found' });
    }

    res.json(result);
  } catch (error: any) {
    logger.error('Error getting managed account details:', error);
    res.status(500).json({ error: 'Failed to get managed account details' });
  }
});

// ============================================
// PUT /:accountId — Update a managed account
// ============================================
router.put('/:accountId', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { accountId } = req.params;
    if (!isValidObjectId(accountId)) {
      return res.status(400).json({ error: 'Invalid accountId format' });
    }

    const result = await managedAccountService.updateManagedAccount(
      accountId,
      userId,
      req.body
    );

    res.json(result);
  } catch (error: any) {
    if (error.message?.startsWith('Forbidden:')) {
      return res.status(403).json({ error: error.message });
    }
    if (
      error.message === 'Username already exists' ||
      error.message?.includes('Username may only contain')
    ) {
      return res.status(400).json({ error: error.message });
    }
    if (
      error.message === 'Managed account user not found' ||
      error.message === 'ManagedAccount relationship not found'
    ) {
      return res.status(404).json({ error: error.message });
    }
    logger.error('Error updating managed account:', error);
    res.status(500).json({ error: 'Failed to update managed account' });
  }
});

// ============================================
// DELETE /:accountId — Delete a managed account (owner only)
// ============================================
router.delete('/:accountId', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { accountId } = req.params;
    if (!isValidObjectId(accountId)) {
      return res.status(400).json({ error: 'Invalid accountId format' });
    }

    await managedAccountService.deleteManagedAccount(accountId, userId);
    res.json({ message: 'Managed account deleted successfully' });
  } catch (error: any) {
    if (error.message?.startsWith('Forbidden:')) {
      return res.status(403).json({ error: error.message });
    }
    if (error.message === 'Managed account not found') {
      return res.status(404).json({ error: error.message });
    }
    logger.error('Error deleting managed account:', error);
    res.status(500).json({ error: 'Failed to delete managed account' });
  }
});

// ============================================
// POST /:accountId/managers — Add a manager
// ============================================
router.post('/:accountId/managers', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { accountId } = req.params;
    if (!isValidObjectId(accountId)) {
      return res.status(400).json({ error: 'Invalid accountId format' });
    }

    const { userId: targetUserId, role } = req.body;

    if (!targetUserId || typeof targetUserId !== 'string') {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!isValidObjectId(targetUserId)) {
      return res.status(400).json({ error: 'Invalid userId format' });
    }

    const validRoles = ['owner', 'admin', 'editor'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({
        error: `role must be one of: ${validRoles.join(', ')}`,
      });
    }

    const result = await managedAccountService.addManager(
      accountId,
      userId,
      targetUserId,
      role
    );

    res.json({ account: result });
  } catch (error: any) {
    if (error.message?.startsWith('Forbidden:')) {
      return res.status(403).json({ error: error.message });
    }
    if (
      error.message === 'Target user not found' ||
      error.message === 'Managed account not found'
    ) {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'User is already a manager of this account') {
      return res.status(409).json({ error: error.message });
    }
    logger.error('Error adding manager:', error);
    res.status(500).json({ error: 'Failed to add manager' });
  }
});

// ============================================
// DELETE /:accountId/managers/:userId — Remove a manager (owner only)
// ============================================
router.delete('/:accountId/managers/:userId', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const requesterId = getUserId(req);
    if (!requesterId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { accountId, userId: targetUserId } = req.params;
    if (!isValidObjectId(accountId) || !isValidObjectId(targetUserId)) {
      return res.status(400).json({ error: 'Invalid accountId or userId format' });
    }

    const result = await managedAccountService.removeManager(
      accountId,
      requesterId,
      targetUserId
    );

    res.json({ account: result });
  } catch (error: any) {
    if (error.message?.startsWith('Forbidden:')) {
      return res.status(403).json({ error: error.message });
    }
    if (error.message === 'Cannot remove the primary owner from managers') {
      return res.status(400).json({ error: error.message });
    }
    if (
      error.message === 'Managed account not found' ||
      error.message === 'User is not a manager of this account'
    ) {
      return res.status(404).json({ error: error.message });
    }
    logger.error('Error removing manager:', error);
    res.status(500).json({ error: 'Failed to remove manager' });
  }
});

export default router;
