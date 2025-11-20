/**
 * Analytics Methods Mixin
 * 
 * Provides methods for analytics tracking and data retrieval
 */
import type { OxyServicesBase } from '../OxyServices.base';
import { CACHE_TIMES } from './mixinHelpers';

export function OxyServicesAnalyticsMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Track an analytics event
     * @param eventName - Name of the event to track
     * @param properties - Optional event properties
     */
    async trackEvent(eventName: string, properties?: Record<string, any>): Promise<void> {
      try {
        await this.makeRequest('POST', '/api/analytics/events', {
          event: eventName,
          properties
        }, { cache: false, retry: false }); // Don't retry analytics events
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get analytics data for a date range
     * @param startDate - Optional start date (ISO string)
     * @param endDate - Optional end date (ISO string)
     * @returns Analytics data
     */
    async getAnalytics(startDate?: string, endDate?: string): Promise<any> {
      try {
        const params: any = {};
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;
        
        return await this.makeRequest('GET', '/api/analytics', params, {
          cache: true,
          cacheTTL: CACHE_TIMES.LONG,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

