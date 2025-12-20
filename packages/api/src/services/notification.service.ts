import { Types } from 'mongoose';
import Notification from '../models/Notification';
import { NotificationData } from '../types/notification.types';
import { logger } from '../utils/logger';

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
      logger.error('Error creating notification', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Create a like notification
   */
  static async createLikeNotification(
    recipientId: Types.ObjectId | string,
    actorId: Types.ObjectId | string,
    postId: Types.ObjectId | string
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
    recipientId: Types.ObjectId | string,
    actorId: Types.ObjectId | string
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
    recipientId: Types.ObjectId | string,
    actorId: Types.ObjectId | string,
    replyId: Types.ObjectId | string
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
    recipientId: Types.ObjectId | string,
    actorId: Types.ObjectId | string,
    postId: Types.ObjectId | string
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
    recipientId: Types.ObjectId | string,
    actorId: Types.ObjectId | string,
    postId: Types.ObjectId | string
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
    recipientId: Types.ObjectId | string,
    actorId: Types.ObjectId | string,
    postId: Types.ObjectId | string
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
    recipientId: Types.ObjectId | string
  ) {
    // Use a default "system" actor ID or admin ID for welcome notifications
    const systemActorId = new Types.ObjectId('000000000000000000000000');
    
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
  static async deleteNotificationsByEntity(entityId: Types.ObjectId | string) {
    try {
      await Notification.deleteMany({ entityId });
    } catch (error) {
      logger.error('Error deleting notifications for entity', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
}