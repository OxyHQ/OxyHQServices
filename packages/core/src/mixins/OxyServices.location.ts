/**
 * Location Methods Mixin
 */
import type { OxyServicesBase } from '../OxyServices.base';

export function OxyServicesLocationMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Update user location
     * @param latitude - Latitude coordinate
     * @param longitude - Longitude coordinate
     * @returns Location update result
     */
    async updateLocation(latitude: number, longitude: number): Promise<any> {
      try {
        return await this.makeRequest('POST', '/api/location', {
          latitude,
          longitude
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get nearby users
     * @param radius - Optional search radius in meters
     * @returns Array of nearby users
     */
    async getNearbyUsers(radius?: number): Promise<any[]> {
      try {
        const params: any = radius ? { radius } : undefined;
        return await this.makeRequest('GET', '/api/location/nearby', params, {
          cache: false, // Don't cache location data - always get fresh data
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

