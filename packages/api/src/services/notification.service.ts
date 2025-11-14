import Notification from '../models/Notification';
import { NotificationData } from '../types/notification.types';

/**
 * Service to handle notification operations
 */
export class NotificationService {

  /**
   * Create a new notification
   * 
   * @param data - Notification data object
   * @returns The created notification or null if it exists
   */
  static async createNotification(data: NotificationData) {
    try {
      // Check if notification already exists to prevent duplicates
      const existingNotification = await Notification.findOne({
        recipientId: data.recipientId,
        actorId: data.actorId,
        type: data.type,
        entityId: data.entityId
      });

      // Don't create duplicate notifications
      if (existingNotification) {
        return null;
      }

      // Don't notify yourself
      if (data.recipientId.toString() === data.actorId.toString()) {
        return null;
      }

      // Create the notification
      const notification = new Notification(data);
      await notification.save();
      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create a like notification
   */
  static async createLikeNotification(
    recipientId: mongoose.Types.ObjectId | string,
    actorId: mongoose.Types.ObjectId | string,
    postId: mongoose.Types.ObjectId | string
  ) {
    return this.createNotification({
      recipientId,
      actorId,
      type: 'like',
      entityId: postId,
      entityType: 'post'
    });
  }

  /**
   * Create a follow notification
   */
  static async createFollowNotification(
    recipientId: mongoose.Types.ObjectId | string,
    actorId: mongoose.Types.ObjectId | string
  ) {
    return this.createNotification({
      recipientId,
      actorId,
      type: 'follow',
      entityId: recipientId,
      entityType: 'profile'
    });
  }

  /**
   * Create a reply notification
   */
  static async createReplyNotification(
    recipientId: mongoose.Types.ObjectId | string,
    actorId: mongoose.Types.ObjectId | string,
    replyId: mongoose.Types.ObjectId | string
  ) {
    return this.createNotification({
      recipientId,
      actorId,
      type: 'reply',
      entityId: replyId,
      entityType: 'reply'
    });
  }

  /**
   * Create a mention notification
   */
  static async createMentionNotification(
    recipientId: mongoose.Types.ObjectId | string,
    actorId: mongoose.Types.ObjectId | string,
    postId: mongoose.Types.ObjectId | string
  ) {
    return this.createNotification({
      recipientId,
      actorId,
      type: 'mention',
      entityId: postId,
      entityType: 'post'
    });
  }

  /**
   * Create a repost notification
   */
  static async createRepostNotification(
    recipientId: mongoose.Types.ObjectId | string,
    actorId: mongoose.Types.ObjectId | string,
    postId: mongoose.Types.ObjectId | string
  ) {
    return this.createNotification({
      recipientId,
      actorId,
      type: 'repost',
      entityId: postId,
      entityType: 'post'
    });
  }

  /**
   * Create a quote post notification
   */
  static async createQuoteNotification(
    recipientId: mongoose.Types.ObjectId | string,
    actorId: mongoose.Types.ObjectId | string,
    postId: mongoose.Types.ObjectId | string
  ) {
    return this.createNotification({
      recipientId,
      actorId,
      type: 'quote',
      entityId: postId,
      entityType: 'post'
    });
  }

  /**
   * Create a welcome notification for new users
   */
  static async createWelcomeNotification(
    recipientId: mongoose.Types.ObjectId | string
  ) {
    // Use a default "system" actor ID or admin ID for welcome notifications
    const systemActorId = new mongoose.Types.ObjectId('000000000000000000000000');
    
    return this.createNotification({
      recipientId,
      actorId: systemActorId,
      type: 'welcome',
      entityId: recipientId,
      entityType: 'profile'
    });
  }

  /**
   * Delete notifications related to a specific entity (e.g., when a post is deleted)
   */
  static async deleteNotificationsByEntity(entityId: mongoose.Types.ObjectId | string) {
    try {
      await Notification.deleteMany({ entityId });
    } catch (error) {
      console.error('Error deleting notifications for entity:', error);
      throw error;
    }
  }
}