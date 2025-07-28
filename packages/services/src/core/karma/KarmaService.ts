import { OxyServices } from '../OxyServices';
import {
  KarmaRule,
  KarmaHistory,
  KarmaLeaderboardEntry,
  KarmaAwardRequest
} from '../../models/interfaces';

/**
 * Karma service for handling karma system operations
 */
export class KarmaService extends OxyServices {
  /**
   * Get karma leaderboard
   */
  async getKarmaLeaderboard(): Promise<KarmaLeaderboardEntry[]> {
    try {
      const res = await this.getClient().get('/karma/leaderboard');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get karma rules
   */
  async getKarmaRules(): Promise<KarmaRule[]> {
    try {
      const res = await this.getClient().get('/karma/rules');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user karma total
   */
  async getUserKarmaTotal(userId: string): Promise<{ total: number }> {
    try {
      const res = await this.getClient().get(`/karma/users/${userId}/total`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user karma history
   */
  async getUserKarmaHistory(
    userId: string, 
    limit?: number, 
    offset?: number
  ): Promise<{ history: KarmaHistory[]; total: number; hasMore: boolean }> {
    try {
      const params = new URLSearchParams();
      if (limit) params.append('limit', limit.toString());
      if (offset) params.append('offset', offset.toString());
      
      const res = await this.getClient().get(`/karma/users/${userId}/history?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Award karma to user
   */
  async awardKarma(data: KarmaAwardRequest): Promise<{ success: boolean; message: string; history: KarmaHistory }> {
    try {
      const res = await this.getClient().post('/karma/award', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Deduct karma from user
   */
  async deductKarma(data: KarmaAwardRequest): Promise<{ success: boolean; message: string; history: KarmaHistory }> {
    try {
      const res = await this.getClient().post('/karma/deduct', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create or update karma rule
   */
  async createOrUpdateKarmaRule(data: Partial<KarmaRule>): Promise<KarmaRule> {
    try {
      const res = await this.getClient().post('/karma/rules', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
} 