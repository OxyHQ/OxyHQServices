import { OxyServices } from '../OxyServices';
import { User, Notification } from '../../models/interfaces';
import { buildSearchParams, buildPaginationParams, PaginationParams } from '../../utils/apiUtils';

/**
 * User service for handling user operations, profiles, and social features
 */
export class UserService extends OxyServices {
  /**
   * Get profile by username
   */
  async getProfileByUsername(username: string): Promise<User> {
    try {
      const res = await this.getClient().get(`/users/profile/${username}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Search user profiles
   */
  async searchProfiles(query: string, limit?: number, offset?: number): Promise<User[]> {
    try {
      const params = new URLSearchParams({ query });
      if (limit) params.append('limit', limit.toString());
      if (offset) params.append('offset', offset.toString());
      
      const res = await this.getClient().get(`/users/search?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get profile recommendations
   */
  async getProfileRecommendations(): Promise<Array<{
    id: string;
    username: string;
    name?: { first?: string; last?: string; full?: string };
    description?: string;
    _count?: { followers: number; following: number };
    [key: string]: any;
  }>> {
    try {
      const res = await this.getClient().get('/users/recommendations');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User> {
    try {
      const res = await this.getClient().get(`/users/${userId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<User> {
    try {
      const res = await this.getClient().get('/users/me');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(updates: Record<string, any>): Promise<User> {
    try {
      const res = await this.getClient().put('/users/profile', updates);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update user by ID (admin function)
   */
  async updateUser(userId: string, updates: Record<string, any>): Promise<User> {
    try {
      const res = await this.getClient().put(`/users/${userId}`, updates);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Follow a user
   */
  async followUser(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.getClient().post(`/users/${userId}/follow`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Unfollow a user
   */
  async unfollowUser(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.getClient().delete(`/users/${userId}/follow`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get follow status
   */
  async getFollowStatus(userId: string): Promise<{ isFollowing: boolean }> {
    try {
      const res = await this.getClient().get(`/users/${userId}/follow-status`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user followers
   */
  async getUserFollowers(
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ followers: User[]; total: number; hasMore: boolean }> {
    try {
      const params = new URLSearchParams();
      if (limit) params.append('limit', limit.toString());
      if (offset) params.append('offset', offset.toString());
      
      const res = await this.getClient().get(`/users/${userId}/followers?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user following
   */
  async getUserFollowing(
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ following: User[]; total: number; hasMore: boolean }> {
    try {
      const params = new URLSearchParams();
      if (limit) params.append('limit', limit.toString());
      if (offset) params.append('offset', offset.toString());
      
      const res = await this.getClient().get(`/users/${userId}/following?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get notifications
   */
  async getNotifications(): Promise<Notification[]> {
    try {
      const res = await this.getClient().get('/notifications');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(): Promise<number> {
    try {
      const res = await this.getClient().get('/notifications/unread-count');
      return res.data.count;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create notification
   */
  async createNotification(data: Partial<Notification>): Promise<Notification> {
    try {
      const res = await this.getClient().post('/notifications', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(notificationId: string): Promise<void> {
    try {
      await this.getClient().put(`/notifications/${notificationId}/read`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsAsRead(): Promise<void> {
    try {
      await this.getClient().put('/notifications/read-all');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string): Promise<void> {
    try {
      await this.getClient().delete(`/notifications/${notificationId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }
} 