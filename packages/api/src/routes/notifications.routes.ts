import express from 'express';
import { 
  getNotifications, 
  createNotification, 
  markAsRead, 
  markAllAsRead, 
  deleteNotification,
  getUnreadCount
} from '../controllers/notification.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Get all notifications for the authenticated user
router.get('/', getNotifications);

// Get unread notification count
router.get('/unread-count', getUnreadCount);

// Create a new notification
router.post('/', createNotification);

// Mark a notification as read
router.put('/:id/read', markAsRead);

// Mark all notifications as read
router.put('/read-all', markAllAsRead);

// Delete a notification
router.delete('/:id', deleteNotification);

export default router;