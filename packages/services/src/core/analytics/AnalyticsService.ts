import { OxyServices } from '../OxyServices';
import { AnalyticsData, FollowerDetails, ContentViewer } from '../../models/interfaces';

/**
 * Analytics service for handling analytics and content viewer operations
 */
export class AnalyticsService extends OxyServices {
  /**
   * Get analytics data for user
   */
  async getAnalytics(userId: string, period?: string): Promise<AnalyticsData> {
    try {
      const params = new URLSearchParams();
      if (period) params.append('period', period);
      
      const res = await this.getClient().get(`/api/analytics/users/${userId}?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update analytics data
   */
  async updateAnalytics(userId: string, type: string, data: Record<string, any>): Promise<{ message: string }> {
    try {
      const res = await this.getClient().put(`/api/analytics/users/${userId}/${type}`, data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get content viewers for user
   */
  async getContentViewers(userId: string, period?: string): Promise<ContentViewer[]> {
    try {
      const params = new URLSearchParams();
      if (period) params.append('period', period);
      
      const res = await this.getClient().get(`/api/analytics/users/${userId}/viewers?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get follower details for user
   */
  async getFollowerDetails(userId: string, period?: string): Promise<FollowerDetails> {
    try {
      const params = new URLSearchParams();
      if (period) params.append('period', period);
      
      const res = await this.getClient().get(`/api/analytics/users/${userId}/followers?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
} 