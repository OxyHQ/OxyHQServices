import { Response, Request } from 'express';
import { z } from 'zod';

import { AuthRequest } from '../middleware/auth';
import Notification from '../models/Notification';
import { logger } from '../utils/logger';

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

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE = 1;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Creates a standardized error response
 */
function createErrorResponse(message: string, errorCode?: string) {
  return {
    success: false,
    message,
    error: errorCode || 'UNKNOWN_ERROR',
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

/**
 * Validates pagination parameters
 */
function validatePaginationParams(page: number, limit: number): boolean {
  return page >= 1 && limit >= 1 && limit <= MAX_PAGE_SIZE;
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
      res.status(401).json(createErrorResponse('Unauthorized: User ID not found', 'AUTH_ERROR'));
      return;
    }

    const page = parseInt(req.query.page as string) || DEFAULT_PAGE;
    const limit = parseInt(req.query.limit as string) || DEFAULT_PAGE_SIZE;

    if (!validatePaginationParams(page, limit)) {
      res.status(400).json(createErrorResponse('Invalid pagination parameters', 'INVALID_PAGINATION'));
      return;
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

    res.json(createSuccessResponse({
      notifications,
      unreadCount,
      hasMore: notifications.length === limit,
      page,
      limit,
    }));
  } catch (error) {
    logger.error('Error fetching notifications:', error);
    res.status(500).json(createErrorResponse('Error fetching notifications'));
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
      res.status(409).json(createErrorResponse('Duplicate notification', 'DUPLICATE_ERROR'));
      return;
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

    res.status(201).json(createSuccessResponse({ notification }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: 'Invalid notification data',
        errors: error.errors,
      });
      return;
    }

    logger.error('Error creating notification:', error);
    res.status(500).json(createErrorResponse('Error creating notification'));
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
      res.status(401).json(createErrorResponse('Unauthorized: User ID not found', 'AUTH_ERROR'));
      return;
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipientId: userId },
      { read: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      res.status(404).json(createErrorResponse('Notification not found', 'NOT_FOUND'));
      return;
    }

    res.json(createSuccessResponse({ notification }));
  } catch (error) {
    logger.error('Error marking notification as read:', error);
    res.status(500).json(createErrorResponse('Error marking notification as read'));
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
      res.status(401).json(createErrorResponse('Unauthorized: User ID not found', 'AUTH_ERROR'));
      return;
    }

    const result = await Notification.updateMany(
      { recipientId: userId, read: false },
      { read: true, readAt: new Date() }
    );

    res.json(createSuccessResponse({
      message: `Marked ${result.modifiedCount} notifications as read`,
      modifiedCount: result.modifiedCount,
    }));
  } catch (error) {
    logger.error('Error marking all notifications as read:', error);
    res.status(500).json(createErrorResponse('Error marking all notifications as read'));
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
      res.status(401).json(createErrorResponse('Unauthorized: User ID not found', 'AUTH_ERROR'));
      return;
    }

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      recipientId: userId,
    });

    if (!notification) {
      res.status(404).json(createErrorResponse('Notification not found', 'NOT_FOUND'));
      return;
    }

    res.json(createSuccessResponse({
      message: 'Notification deleted successfully',
    }));
  } catch (error) {
    logger.error('Error deleting notification:', error);
    res.status(500).json(createErrorResponse('Error deleting notification'));
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
      res.status(401).json(createErrorResponse('Unauthorized: User ID not found', 'AUTH_ERROR'));
      return;
    }

    const unreadCount = await Notification.countDocuments({
      recipientId: userId,
      read: false,
    });

    res.json(createSuccessResponse({ unreadCount }));
  } catch (error) {
    logger.error('Error fetching unread count:', error);
    res.status(500).json(createErrorResponse('Error fetching unread count'));
  }
};