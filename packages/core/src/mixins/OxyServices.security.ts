/**
 * Security Methods Mixin
 */
import type { OxyServicesBase } from '../OxyServices.base';
import type { SecurityActivity, SecurityActivityResponse, SecurityEventType } from '../models/interfaces';

export function OxyServicesSecurityMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Get user's security activity with pagination
     * @param limit - Number of results (default: 50, max: 100)
     * @param offset - Pagination offset (default: 0)
     * @param eventType - Optional filter by event type
     * @returns Security activity response with pagination
     */
    async getSecurityActivity(
      limit?: number,
      offset?: number,
      eventType?: SecurityEventType
    ): Promise<SecurityActivityResponse> {
      try {
        const params: any = {};
        if (limit !== undefined) params.limit = limit;
        if (offset !== undefined) params.offset = offset;
        if (eventType) params.eventType = eventType;

        const response = await this.makeRequest<SecurityActivityResponse>(
          'GET',
          '/api/security/activity',
          params,
          { cache: false }
        );

        return response;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get recent security activity (convenience method)
     * @param limit - Number of recent events to fetch (default: 10)
     * @returns Array of recent security activities
     */
    async getRecentSecurityActivity(limit: number = 10): Promise<SecurityActivity[]> {
      try {
        const response = await this.getSecurityActivity(limit, 0);
        return response.data || [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Log private key exported event
     * @param deviceId - Optional device ID for tracking
     * @returns Promise that resolves when event is logged
     */
    async logPrivateKeyExported(deviceId?: string): Promise<void> {
      try {
        await this.makeRequest<{ success: boolean }>(
          'POST',
          '/api/security/activity/private-key-exported',
          { deviceId },
          { cache: false }
        );
      } catch (error) {
        // Don't throw - logging failures shouldn't break user flow
        // But log for monitoring
        if (__DEV__) {
          console.warn('[OxyServices] Failed to log private key exported event:', error);
        }
      }
    }

    /**
     * Log backup created event
     * @param deviceId - Optional device ID for tracking
     * @returns Promise that resolves when event is logged
     */
    async logBackupCreated(deviceId?: string): Promise<void> {
      try {
        await this.makeRequest<{ success: boolean }>(
          'POST',
          '/api/security/activity/backup-created',
          { deviceId },
          { cache: false }
        );
      } catch (error) {
        // Don't throw - logging failures shouldn't break user flow
        // But log for monitoring
        if (__DEV__) {
          console.warn('[OxyServices] Failed to log backup created event:', error);
        }
      }
    }
  };
}

