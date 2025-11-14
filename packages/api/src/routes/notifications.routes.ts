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
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Get all notifications for the authenticated user
router.get('/', asyncHandler(getNotifications));

// Get unread notification count
router.get('/unread-count', asyncHandler(getUnreadCount));

// Create a new notification
router.post('/', asyncHandler(createNotification));

// Mark a notification as read
router.put('/:id/read', asyncHandler(markAsRead));

// Mark all notifications as read
router.put('/read-all', asyncHandler(markAllAsRead));

// Delete a notification
router.delete('/:id', asyncHandler(deleteNotification));

export default router;