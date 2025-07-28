import { OxyServices } from '../OxyServices';

/**
 * Location service for handling location search and geolocation features
 */
export class LocationService extends OxyServices {
  /**
   * Search locations
   */
  async searchLocations(query: string, limit: number = 5, countrycodes?: string): Promise<any[]> {
    try {
      const params = new URLSearchParams({
        query,
        limit: limit.toString()
      });
      
      if (countrycodes) {
        params.append('countrycodes', countrycodes);
      }
      
      const res = await this.getClient().get(`/location-search/search?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get location details by coordinates
   */
  async getLocationDetails(lat: number, lon: number): Promise<any> {
    try {
      const res = await this.getClient().get(`/location-search/reverse?lat=${lat}&lon=${lon}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Find locations near coordinates
   */
  async findLocationsNear(
    lat: number, 
    lon: number, 
    maxDistance: number = 10000,
    limit: number = 10,
    skip: number = 0
  ): Promise<any> {
    try {
      const params = new URLSearchParams({
        lat: lat.toString(),
        lon: lon.toString(),
        maxDistance: maxDistance.toString(),
        limit: limit.toString(),
        skip: skip.toString()
      });
      
      const res = await this.getClient().get(`/location-search/near?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Search locations in database
   */
  async searchLocationsInDB(
    query: string,
    limit: number = 10,
    skip: number = 0,
    type?: string,
    country?: string,
    city?: string
  ): Promise<any> {
    try {
      const params = new URLSearchParams({
        query,
        limit: limit.toString(),
        skip: skip.toString()
      });
      if (type) params.append('type', type);
      if (country) params.append('country', country);
      if (city) params.append('city', city);
      
      const res = await this.getClient().get(`/location-search/db-search?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get location statistics
   */
  async getLocationStats(): Promise<any> {
    try {
      const res = await this.getClient().get('/location-search/stats');
      return res.data.stats;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get cache statistics
   */
  async getLocationCacheStats(): Promise<any> {
    try {
      const res = await this.getClient().get('/location-search/cache/stats');
      return res.data.stats;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Clear location cache
   */
  async clearLocationCache(): Promise<any> {
    try {
      const res = await this.getClient().delete('/location-search/cache');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get performance statistics
   */
  async getLocationPerformanceStats(): Promise<any> {
    try {
      const res = await this.getClient().get('/location-search/performance');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
} 