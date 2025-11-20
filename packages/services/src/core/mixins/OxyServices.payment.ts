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
        return await this.makeRequest('POST', '/api/payments', data, { cache: false });
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
        return await this.makeRequest('GET', `/api/payments/${paymentId}`, undefined, {
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
        return await this.makeRequest('GET', '/api/payments/user', undefined, {
          cache: false, // Don't cache user payments - always get fresh data
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

