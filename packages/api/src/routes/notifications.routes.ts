/**
 * Notification Routes
 * 
 * RESTful API routes for notification operations.
 * Uses asyncHandler for consistent error handling.
 */

import express from 'express';
import {
  getNotifications,
  createNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount
} from '../controllers/notification.controller';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { validate } from '../middleware/validate';
import { createNotificationSchema, notificationIdParams } from '../schemas/notifications.schemas';
import { PushToken } from '../models/PushToken';
import { logger } from '../utils/logger';
import type { Response } from 'express';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Get all notifications for the authenticated user
router.get('/', asyncHandler(getNotifications));

// Get unread notification count
router.get('/unread-count', asyncHandler(getUnreadCount));

// Create a new notification
router.post('/', validate({ body: createNotificationSchema }), asyncHandler(createNotification));

// ─── Push Token Management ──────────────────────────────────────────

// Register a push token
router.post('/push-token', asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  const { token, platform } = req.body;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'token is required' });
  }

  if (!platform || !['ios', 'android', 'web'].includes(platform)) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'platform must be ios, android, or web' });
  }

  try {
    await PushToken.findOneAndUpdate(
      { userId, token },
      { userId, token, platform },
      { upsert: true, new: true },
    );

    return res.status(200).json({ data: { registered: true } });
  } catch (err: unknown) {
    const errObj = err as { code?: number; message?: string };
    // Ignore duplicate key errors (race condition safe)
    if (errObj.code === 11000 || errObj.message?.includes('E11000')) {
      return res.status(200).json({ data: { registered: true } });
    }
    logger.error('Failed to register push token', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to register push token' });
  }
}));

// Unregister a push token
router.delete('/push-token', asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'token is required' });
  }

  await PushToken.deleteOne({ userId, token });

  return res.status(200).json({ data: { unregistered: true } });
}));

// Mark a notification as read
router.put('/:id/read', validate({ params: notificationIdParams }), asyncHandler(markAsRead));

// Mark all notifications as read
router.put('/read-all', asyncHandler(markAllAsRead));

// Delete a notification
router.delete('/:id', validate({ params: notificationIdParams }), asyncHandler(deleteNotification));

export default router;