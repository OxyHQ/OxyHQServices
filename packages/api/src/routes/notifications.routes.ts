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
import {
  authMiddleware,
  serviceAuthMiddleware,
  type AuthRequest,
  type ServiceAuthRequest,
} from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { validate } from '../middleware/validate';
import {
  createNotificationSchema,
  notificationIdParams,
  registerPushTokenSchema,
  unregisterPushTokenSchema,
  type RegisterPushTokenBody,
  type UnregisterPushTokenBody,
} from '../schemas/notifications.schemas';
import { PushToken } from '../models/PushToken';
import { Application } from '../models/Application';
import { ApplicationCredential } from '../models/ApplicationCredential';
import { isCredentialUsable } from '../utils/credentialUsability';
import { logger } from '../utils/logger';
import type mongoose from 'mongoose';
import type { NextFunction, Response } from 'express';

const router = express.Router();

const NOTIFICATIONS_WRITE_SCOPE = 'notifications:write';

/**
 * Gate notification creation behind the privileged `notifications:write` scope.
 * Creating a notification lets the caller deliver realtime activity to ANY
 * recipient and choose the actor/entity metadata, so it must be restricted to
 * trusted services that staff explicitly granted the scope — never any
 * session-authenticated end user.
 */
const requireNotificationsWriteScope = (req: ServiceAuthRequest, res: Response, next: NextFunction) => {
  const scopes = req.serviceApp?.scopes ?? [];
  if (!scopes.includes(NOTIFICATIONS_WRITE_SCOPE)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: `Missing required scope: ${NOTIFICATIONS_WRITE_SCOPE}`,
    });
  }

  return next();
};

// Create a new notification — service-token + privileged scope only. Registered
// BEFORE the user `authMiddleware` so a session token never reaches this route.
router.post(
  '/',
  serviceAuthMiddleware,
  requireNotificationsWriteScope,
  validate({ body: createNotificationSchema }),
  asyncHandler(createNotification)
);

// Apply user authentication middleware to all remaining routes
router.use(authMiddleware);

// Get all notifications for the authenticated user
router.get('/', asyncHandler(getNotifications));

// Get unread notification count
router.get('/unread-count', asyncHandler(getUnreadCount));

// ─── Push Token Management ──────────────────────────────────────────

/** Explicit write whitelist for a push-token upsert — never `req.body`. */
interface PushTokenWrite {
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceId?: string;
  applicationId?: mongoose.Types.ObjectId;
}

/**
 * Resolve a caller-supplied `clientId` (an `ApplicationCredential.publicKey`) to
 * the active `Application` it belongs to, through the SAME usable-credential
 * predicate every other credential-resolution site uses. Returns null when the
 * credential is unknown, revoked / out of its rotation grace, or its application
 * is not active — the caller REJECTS in that case rather than silently storing
 * an unscoped token.
 */
async function resolveApplicationIdFromClientId(
  clientId: string,
): Promise<mongoose.Types.ObjectId | null> {
  const credential = await ApplicationCredential.findOne({ publicKey: clientId });
  if (!credential || !isCredentialUsable(credential)) {
    return null;
  }

  const application = await Application.findById(credential.applicationId);
  if (!application || application.status !== 'active') {
    return null;
  }

  return application._id;
}

// Register a push token
router.post(
  '/push-token',
  validate({ body: registerPushTokenSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const { token, platform, deviceId, clientId } = req.body as RegisterPushTokenBody;

    const write: PushTokenWrite = { userId, token, platform };

    if (deviceId !== undefined) {
      write.deviceId = deviceId;
    }

    if (clientId !== undefined) {
      const applicationId = await resolveApplicationIdFromClientId(clientId);
      if (!applicationId) {
        // One generic message for every rejection path so the response never
        // enumerates which credentials exist or what state they are in.
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'clientId does not resolve to an active application',
        });
      }
      write.applicationId = applicationId;
    }

    try {
      // Explicit `$set` of the whitelist above. Fields the caller did not send
      // are left untouched, so re-registering an existing install never silently
      // drops a scope it already carries.
      await PushToken.findOneAndUpdate(
        { userId, token },
        { $set: write },
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
  }),
);

// Unregister a push token
router.delete(
  '/push-token',
  validate({ body: unregisterPushTokenSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const { token } = req.body as UnregisterPushTokenBody;

    await PushToken.deleteOne({ userId, token });

    return res.status(200).json({ data: { unregistered: true } });
  }),
);

// Mark a notification as read
router.put('/:id/read', validate({ params: notificationIdParams }), asyncHandler(markAsRead));

// Mark all notifications as read
router.put('/read-all', asyncHandler(markAllAsRead));

// Delete a notification
router.delete('/:id', validate({ params: notificationIdParams }), asyncHandler(deleteNotification));

export default router;