/**
 * Karma Methods Mixin
 * 
 * Provides methods for karma system management
 */
import type { OxyServicesBase } from '../OxyServices.base';
import { CACHE_TIMES } from './mixinHelpers';

export function OxyServicesKarmaMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
    /**
     * Get user karma
     */
    async getUserKarma(userId: string): Promise<any> {
      try {
        return await this.makeRequest('GET', `/api/karma/${userId}`, undefined, {
          cache: true,
          cacheTTL: 2 * 60 * 1000, // 2 minutes cache
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Give karma to user
     */
    async giveKarma(userId: string, amount: number, reason?: string): Promise<any> {
      try {
        return await this.makeRequest('POST', `/api/karma/${userId}/give`, {
          amount,
          reason
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user karma total
     * @param userId - The user ID
     * @returns User karma total
     */
    async getUserKarmaTotal(userId: string): Promise<any> {
      try {
        return await this.makeRequest('GET', `/api/karma/${userId}/total`, undefined, {
          cache: true,
          cacheTTL: CACHE_TIMES.MEDIUM,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user karma history
     * @param userId - The user ID
     * @param limit - Optional limit for results
     * @param offset - Optional offset for pagination
     * @returns User karma history
     */
    async getUserKarmaHistory(userId: string, limit?: number, offset?: number): Promise<any> {
      try {
        const params: any = {};
        if (limit) params.limit = limit;
        if (offset) params.offset = offset;
        
        return await this.makeRequest('GET', `/api/karma/${userId}/history`, params, {
          cache: true,
          cacheTTL: CACHE_TIMES.MEDIUM,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get karma leaderboard
     * @returns Karma leaderboard
     */
    async getKarmaLeaderboard(): Promise<any> {
      try {
        return await this.makeRequest('GET', '/api/karma/leaderboard', undefined, {
          cache: true,
          cacheTTL: CACHE_TIMES.LONG,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get karma rules
     * @returns Karma rules
     */
    async getKarmaRules(): Promise<any> {
      try {
        return await this.makeRequest('GET', '/api/karma/rules', undefined, {
          cache: true,
          cacheTTL: CACHE_TIMES.EXTRA_LONG, // Rules don't change often
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

