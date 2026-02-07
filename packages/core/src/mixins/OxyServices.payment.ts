/**
 * Payment Methods Mixin
 * 
 * Provides methods for payment processing and management
 */
import type { OxyServicesBase } from '../OxyServices.base';
import { CACHE_TIMES } from './mixinHelpers';

export function OxyServicesPaymentMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Create a payment
     * @param data - Payment data
     * @returns Created payment object
     */
    async createPayment(data: any): Promise<any> {
      try {
        return await this.makeRequest('POST', '/payments', data, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get payment by ID
     * @param paymentId - The payment ID
     * @returns Payment object
     */
    async getPayment(paymentId: string): Promise<any> {
      try {
        return await this.makeRequest('GET', `/payments/${paymentId}`, undefined, {
          cache: true,
          cacheTTL: CACHE_TIMES.LONG,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user payments
     * @returns Array of user payments
     */
    async getUserPayments(): Promise<any[]> {
      try {
        return await this.makeRequest('GET', '/payments/user', undefined, {
          cache: false, // Don't cache user payments - always get fresh data
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user subscription
     * @param userId - The user ID
     * @returns Subscription object
     */
    async getSubscription(userId: string): Promise<any> {
      try {
        return await this.makeRequest('GET', `/subscription/${userId}`, undefined, {
          cache: true,
          cacheTTL: CACHE_TIMES.MEDIUM,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get current user's subscription
     * @returns Subscription object
     */
    async getCurrentUserSubscription(): Promise<any> {
      try {
        const userId = this.getCurrentUserId();
        if (!userId) {
          throw new Error('User not authenticated');
        }
        return await this.getSubscription(userId);
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user wallet
     * @param userId - The user ID
     * @returns Wallet object with balance
     */
    async getWallet(userId: string): Promise<any> {
      try {
        return await this.makeRequest('GET', `/wallet/${userId}`, undefined, {
          cache: true,
          cacheTTL: CACHE_TIMES.SHORT, // Cache wallet for short time as balance changes frequently
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get current user's wallet
     * @returns Wallet object with balance
     */
    async getCurrentUserWallet(): Promise<any> {
      try {
        const userId = this.getCurrentUserId();
        if (!userId) {
          throw new Error('User not authenticated');
        }
        return await this.getWallet(userId);
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get wallet transaction history
     * @param userId - The user ID
     * @param options - Pagination options
     * @returns Transaction history
     */
    async getWalletTransactions(userId: string, options?: { limit?: number; offset?: number }): Promise<any> {
      try {
        const params = new URLSearchParams();
        if (options?.limit) params.append('limit', options.limit.toString());
        if (options?.offset) params.append('offset', options.offset.toString());
        
        const queryString = params.toString();
        const url = `/wallet/transactions/${userId}${queryString ? `?${queryString}` : ''}`;
        
        return await this.makeRequest('GET', url, undefined, {
          cache: false, // Don't cache transactions - always get fresh data
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get current user's wallet transaction history
     * @param options - Pagination options
     * @returns Transaction history
     */
    async getCurrentUserWalletTransactions(options?: { limit?: number; offset?: number }): Promise<any> {
      try {
        const userId = this.getCurrentUserId();
        if (!userId) {
          throw new Error('User not authenticated');
        }
        return await this.getWalletTransactions(userId, options);
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

