import { Response, Request } from 'express';
import { z } from 'zod';

import { AuthRequest } from '../middleware/auth';
import Notification from '../models/Notification';
import { logger } from '../utils/logger';
import { sendSuccess } from '../utils/asyncHandler';
import { UnauthorizedError, BadRequestError, NotFoundError, ConflictError, InternalServerError } from '../utils/error';
import { PAGINATION } from '../utils/constants';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const CREATE_NOTIFICATION_SCHEMA = z.object({
  recipientId: z.string().min(1, 'Recipient ID is required'),
  actorId: z.string().min(1, 'Actor ID is required'),
  type: z.string().min(1, 'Type is required'),
  entityId: z.string().min(1, 'Entity ID is required'),
  entityType: z.string().min(1, 'Entity type is required'),
  title: z.string().optional(),
  message: z.string().optional(),
  data: z.record(z.any()).optional(),
});

// =============================================================================
// CONSTANTS
// =============================================================================

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Validates pagination parameters
 */
function validatePaginationParams(page: number, limit: number): boolean {
  return page >= 1 && limit >= 1 && limit <= PAGINATION.MAX_PAGE_SIZE;
}

/**
 * Emits a real-time notification
 */
async function emitNotification(req: Request, notification: any): Promise<void> {
  try {
    // TODO: Implement real-time notification emission
    // This could use WebSockets, Server-Sent Events, or a message queue
    logger.info(`Notification emitted: ${notification.type} to ${notification.recipientId}`);
  } catch (error) {
    logger.error('Error emitting notification:', error);
  }
}

// =============================================================================
// CONTROLLER FUNCTIONS
// =============================================================================

/**
 * Retrieves notifications for a user
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedError('Unauthorized: User ID not found');
    }

    const page = parseInt(req.query.page as string) || PAGINATION.DEFAULT_PAGE;
    const limit = parseInt(req.query.limit as string) || PAGINATION.DEFAULT_PAGE_SIZE;

    if (!validatePaginationParams(page, limit)) {
      throw new BadRequestError('Invalid pagination parameters');
    }

    // Fetch notifications and unread count in parallel
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ recipientId: userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('actorId', 'username name avatar _id')
        .lean(),
      Notification.countDocuments({
        recipientId: userId,
        read: false,
      }),
    ]);

    sendSuccess(res, {
      notifications,
      unreadCount,
      hasMore: notifications.length === limit,
      page,
      limit,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof BadRequestError) {
      throw error;
    }
    logger.error('Error fetching notifications', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Error fetching notifications');
  }
};

/**
 * Creates a new notification
 * @param req - Express request
 * @param res - Express response
 */
export const createNotification = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = CREATE_NOTIFICATION_SCHEMA.parse(req.body);
    const { recipientId, actorId, type, entityId, entityType, title, message, data } = validatedData;

    // Check for duplicate notifications
    const existingNotification = await Notification.findOne({
      recipientId,
      actorId,
      type,
      entityId,
    });

    if (existingNotification) {
      throw new ConflictError('Duplicate notification');
    }

    const notification = new Notification({
      recipientId,
      actorId,
      type,
      entityId,
      entityType,
      title,
      message,
      data,
    });

    await notification.save();

    // Emit real-time notification
    await emitNotification(req, notification);

    sendSuccess(res, { notification }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError('Invalid notification data', { errors: error.errors });
    }
    if (error instanceof ConflictError || error instanceof BadRequestError) {
      throw error;
    }

    logger.error('Error creating notification', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Error creating notification');
  }
};

/**
 * Marks a notification as read
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { notificationId } = req.params;

    if (!userId) {
      throw new UnauthorizedError('Unauthorized: User ID not found');
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipientId: userId },
      { read: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    sendSuccess(res, { notification });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof NotFoundError) {
      throw error;
    }
    logger.error('Error marking notification as read', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Error marking notification as read');
  }
};

/**
 * Marks all notifications as read for a user
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const markAllAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      throw new UnauthorizedError('Unauthorized: User ID not found');
    }

    const result = await Notification.updateMany(
      { recipientId: userId, read: false },
      { read: true, readAt: new Date() }
    );

    sendSuccess(res, {
      message: `Marked ${result.modifiedCount} notifications as read`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    logger.error('Error marking all notifications as read', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Error marking all notifications as read');
  }
};

/**
 * Deletes a notification
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const deleteNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { notificationId } = req.params;

    if (!userId) {
      throw new UnauthorizedError('Unauthorized: User ID not found');
    }

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      recipientId: userId,
    });

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    sendSuccess(res, {
      message: 'Notification deleted successfully',
    });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof NotFoundError) {
      throw error;
    }
    logger.error('Error deleting notification', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Error deleting notification');
  }
};

/**
 * Gets unread notification count for a user
 * @param req - Express request with authentication
 * @param res - Express response
 */
export const getUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      throw new UnauthorizedError('Unauthorized: User ID not found');
    }

    const unreadCount = await Notification.countDocuments({
      recipientId: userId,
      read: false,
    });

    sendSuccess(res, { unreadCount });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    logger.error('Error fetching unread count', error instanceof Error ? error : new Error(String(error)));
    throw new InternalServerError('Error fetching unread count');
  }
};