import { Request, Response } from 'express';
import Notification from '../models/Notification';
import { Server } from 'socket.io';

// Interface for authenticated requests
interface AuthRequest extends Request {
  user?: {
    id: string;
    [key: string]: any;
  };
}

// Helper function to emit notification through socket.io
export const emitNotification = async (req: Request, notification: any) => {
  try {
    const io = req.app.get('io') as Server;
    if (!io) {
      console.error('Socket.io instance not found in request');
      return;
    }
    
    const populated = await notification.populate('actorId', 'username name avatar');
    
    // Emit to the specific user's room
    io.to(`user:${notification.recipientId}`).emit('notification', populated);
  } catch (error) {
    console.error('Error emitting notification:', error);
  }
};

// Get all notifications for the authenticated user
export const getNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        message: "Unauthorized: User ID not found",
        error: "AUTH_ERROR" 
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    if (page < 1) {
      return res.status(400).json({ 
        message: "Invalid page number", 
        error: "INVALID_PAGE" 
      });
    }

    if (limit < 1 || limit > 100) {
      return res.status(400).json({ 
        message: "Invalid limit. Must be between 1 and 100", 
        error: "INVALID_LIMIT" 
      });
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
        read: false
      })
    ]);

    res.json({
      notifications,
      unreadCount,
      hasMore: notifications.length === limit,
      page,
      limit
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ 
      message: "Error fetching notifications", 
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
    });
  }
};

// Create a new notification
export const createNotification = async (req: AuthRequest, res: Response) => {
  try {
    // Validate required fields
    const { recipientId, actorId, type, entityId, entityType } = req.body;
    
    if (!recipientId || !actorId || !type || !entityId || !entityType) {
      return res.status(400).json({ 
        message: "Missing required fields",
        error: "VALIDATION_ERROR"
      });
    }

    // Check for duplicate notifications
    const existingNotification = await Notification.findOne({
      recipientId,
      actorId,
      type,
      entityId
    });

    if (existingNotification) {
      return res.status(409).json({
        message: "Duplicate notification",
        notification: existingNotification,
        error: "DUPLICATE_ERROR"
      });
    }

    const notification = new Notification(req.body);
    await notification.save();
    
    // Emit real-time notification
    await emitNotification(req, notification);
    
    res.status(201).json(notification);
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ 
      message: "Error creating notification", 
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
    });
  }
};

// Mark a notification as read
export const markAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        message: "Unauthorized", 
        error: "AUTH_ERROR" 
      });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientId: userId },
      { read: true },
      { new: true }
    ).populate('actorId', 'username name avatar');

    if (!notification) {
      return res.status(404).json({ 
        message: "Notification not found", 
        error: "NOT_FOUND" 
      });
    }

    // Emit updated notification
    const io = req.app.get('io') as Server;
    if (io) {
      io.to(`user:${userId}`).emit('notificationUpdated', notification);
    }

    res.json({ message: "Notification marked as read", notification });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ 
      message: "Error updating notification", 
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
    });
  }
};

// Mark all notifications as read
export const markAllAsRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        message: "Unauthorized", 
        error: "AUTH_ERROR" 
      });
    }

    await Notification.updateMany(
      { recipientId: userId, read: false },
      { read: true }
    );

    // Emit all notifications read event
    const io = req.app.get('io') as Server;
    if (io) {
      io.to(`user:${userId}`).emit('allNotificationsRead');
    }

    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({ 
      message: "Error updating notifications", 
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
    });
  }
};

// Delete a notification
export const deleteNotification = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        message: "Unauthorized", 
        error: "AUTH_ERROR" 
      });
    }

    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipientId: userId
    });

    if (!notification) {
      return res.status(404).json({ 
        message: "Notification not found", 
        error: "NOT_FOUND" 
      });
    }

    // Emit notification deleted event
    const io = req.app.get('io') as Server;
    if (io) {
      io.to(`user:${userId}`).emit('notificationDeleted', notification._id);
    }

    res.json({ message: "Notification deleted", notificationId: notification._id });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ 
      message: "Error deleting notification", 
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
    });
  }
};

// Get unread notification count
export const getUnreadCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ 
        message: "Unauthorized", 
        error: "AUTH_ERROR" 
      });
    }

    const unreadCount = await Notification.countDocuments({
      recipientId: userId,
      read: false
    });

    res.json({ unreadCount });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({ 
      message: "Error fetching unread notification count", 
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
    });
  }
};