/**
 * Notification Types
 * 
 * Centralized type definitions for notification-related operations.
 */

import { Types } from 'mongoose';

export interface NotificationData {
  recipientId: Types.ObjectId | string;
  actorId: Types.ObjectId | string;
  type: 'like' | 'reply' | 'mention' | 'follow' | 'repost' | 'quote' | 'welcome';
  entityId: Types.ObjectId | string;
  entityType: 'post' | 'reply' | 'profile';
}

