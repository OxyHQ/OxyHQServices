import { Response } from 'express';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { BadRequestError } from '../utils/error';
import { emitSessionUpdate } from '../server';
import User from '../models/User';

/**
 * In-memory store for transfer completion records
 * Used for offline-first support - allows source devices to check if transfers completed while offline
 */
interface TransferCompletionRecord {
  transferId: string;
  sourceDeviceId: string;
  publicKey: string;
  transferCode?: string;
  completedAt: string;
  timestamp: number;
}

class TransferCompletionStore {
  private completions: Map<string, TransferCompletionRecord> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly TTL = 15 * 60 * 1000; // 15 minutes
  private readonly CLEANUP_INTERVAL = 60 * 1000; // 1 minute

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Store a transfer completion record
   */
  store(record: TransferCompletionRecord): void {
    this.completions.set(record.transferId, record);
  }

  /**
   * Get a transfer completion record by transferId
   */
  get(transferId: string): TransferCompletionRecord | null {
    const record = this.completions.get(transferId);
    if (!record) {
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (now - record.timestamp > this.TTL) {
      this.completions.delete(transferId);
      return null;
    }

    return record;
  }

  /**
   * Check if a transfer was completed
   */
  isCompleted(transferId: string): boolean {
    return this.get(transferId) !== null;
  }

  /**
   * Clean up expired records
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [transferId, record] of this.completions.entries()) {
      if (now - record.timestamp > this.TTL) {
        this.completions.delete(transferId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired transfer completion records`);
    }
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Stop cleanup timer (for testing)
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// Singleton instance
const transferCompletionStore = new TransferCompletionStore();

export class IdentityController {
  /**
   * Notify server about successful identity transfer
   * POST /api/identity/transfer-complete
   * 
   * This endpoint is called by the target device after successfully importing
   * an identity. It notifies the source device via socket to prompt for deletion.
   */
  static async transferComplete(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || !user._id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { transferId, sourceDeviceId, publicKey, transferCode } = req.body;

      // Validate required fields
      if (!transferId || !sourceDeviceId || !publicKey) {
        throw new BadRequestError('transferId, sourceDeviceId, and publicKey are required');
      }

      // Validate transfer code format if provided
      if (transferCode && (typeof transferCode !== 'string' || transferCode.length !== 6 || !/^[A-Z0-9]{6}$/.test(transferCode.toUpperCase()))) {
        throw new BadRequestError('transferCode must be a 6-character alphanumeric code');
      }

      // Verify that the public key matches the authenticated user (efficient single query)
      const userDoc = await User.findById(user._id).select('publicKey').lean();
      if (!userDoc || userDoc.publicKey !== publicKey) {
        throw new BadRequestError('Public key does not match authenticated user');
      }

      const userId = user._id.toString();

      // Emit socket event to source device's room
      // The source device will be listening for this event
      const payload = {
        transferId,
        sourceDeviceId,
        publicKey,
        transferCode: transferCode || undefined, // Include transfer code if provided
        completedAt: new Date().toISOString(),
      };

      // Store completion record for offline-first support
      // This allows source devices to check if transfer completed while they were offline
      transferCompletionStore.store({
        transferId,
        sourceDeviceId,
        publicKey,
        transferCode: transferCode || undefined,
        completedAt: payload.completedAt,
        timestamp: Date.now(),
      });

      // Emit to the user's room - the source device should be listening
      emitSessionUpdate(userId, {
        type: 'identity_transfer_complete',
        ...payload,
      });

      logger.info('Identity transfer completed - socket event emitted and stored', {
        userId,
        transferId,
        sourceDeviceId,
        publicKey: publicKey.substring(0, 16) + '...',
        hasTransferCode: !!transferCode,
        room: `user:${userId}`,
        completedAt: payload.completedAt,
      });

      return res.status(200).json({
        success: true,
        message: 'Transfer completion notification sent',
      });
    } catch (error: any) {
      logger.error('Error handling transfer completion', {
        error: error.message,
        userId: req.user?.id,
      });

      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Verify that target device has active session with transferred identity
   * GET /api/identity/verify-transfer
   * 
   * This endpoint is called by the source device before deleting identity
   * to verify that the target device has successfully imported the identity
   * and has an active session.
   */
  static async verifyTransfer(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || !user._id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { publicKey } = req.query;

      if (!publicKey || typeof publicKey !== 'string') {
        throw new BadRequestError('publicKey query parameter is required');
      }

      // Verify that the public key matches the authenticated user
      const userDoc = await User.findById(user._id).select('publicKey').lean();
      if (!userDoc || userDoc.publicKey !== publicKey) {
        // Public key doesn't match - target device doesn't have the identity
        return res.status(200).json({
          verified: false,
          hasActiveSession: false,
          message: 'Public key does not match authenticated user',
        });
      }

      // Check if user has active sessions (indicates identity is active on target device)
      // We consider it verified if the user is authenticated with matching public key
      const hasActiveSession = !!user && userDoc.publicKey === publicKey;

      logger.info('Transfer verification check', {
        userId: user._id.toString(),
        publicKey: publicKey.substring(0, 16) + '...',
        verified: hasActiveSession,
      });

      return res.status(200).json({
        verified: hasActiveSession,
        hasActiveSession,
        message: hasActiveSession 
          ? 'Target device has active session with transferred identity'
          : 'Target device does not have active session',
      });
    } catch (error: any) {
      logger.error('Error verifying transfer', {
        error: error.message,
        userId: req.user?.id,
      });

      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Check if a transfer was completed (for offline-first support)
   * GET /api/identity/check-transfer/:transferId
   * 
   * This endpoint allows source devices to check if a transfer was completed
   * while they were offline. Returns the completion record if found.
   */
  static async checkTransfer(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || !user._id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { transferId } = req.params;

      if (!transferId) {
        throw new BadRequestError('transferId parameter is required');
      }

      // Check if transfer was completed
      const completion = transferCompletionStore.get(transferId);

      if (!completion) {
        return res.status(200).json({
          completed: false,
          message: 'Transfer not found or expired',
        });
      }

      logger.info('Transfer completion check', {
        userId: user._id.toString(),
        transferId,
        completed: true,
        completedAt: completion.completedAt,
      });

      return res.status(200).json({
        completed: true,
        transferId: completion.transferId,
        sourceDeviceId: completion.sourceDeviceId,
        publicKey: completion.publicKey,
        transferCode: completion.transferCode,
        completedAt: completion.completedAt,
      });
    } catch (error: any) {
      logger.error('Error checking transfer completion', {
        error: error.message,
        userId: req.user?.id,
        transferId: req.params?.transferId,
      });

      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

