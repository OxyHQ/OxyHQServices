import { User, IUser } from '../models/User';
import { logger } from '../utils/logger';
import performanceMonitor from '../utils/performanceMonitor';

interface LocationQueryOptions {
  limit?: number;
  skip?: number;
  sort?: { [key: string]: 1 | -1 };
  type?: string;
  country?: string;
  city?: string;
  near?: {
    lat: number;
    lon: number;
    maxDistance: number;
  };
}

interface LocationSearchResult {
  locations: any[];
  total: number;
  hasMore: boolean;
}

class LocationQueryService {
  /**
   * Find locations near a specific point using geospatial queries
   */
  async findLocationsNear(
    lat: number, 
    lon: number, 
    maxDistance: number = 10000,
    options: LocationQueryOptions = {}
  ): Promise<LocationSearchResult> {
    const endTimer = performanceMonitor.startTimer('db_find_locations_near');
    
    try {
      const { limit = 10, skip = 0 } = options;

      const query = {
        "locations.coordinates": {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [lon, lat] // MongoDB uses [longitude, latitude]
            },
            $maxDistance: maxDistance
          }
        }
      };

      const results = await User.aggregate([
        { $match: query },
        { $unwind: "$locations" },
        { $match: query },
        {
          $project: {
            _id: 1,
            username: 1,
            "location": "$locations",
            distance: {
              $geoNear: {
                near: { type: "Point", coordinates: [lon, lat] },
                distanceField: "distance",
                spherical: true
              }
            }
          }
        },
        { $sort: { distance: 1 } },
        { $skip: skip },
        { $limit: limit + 1 } // Get one extra to check if there are more
      ]);

      const hasMore = results.length > limit;
      const locations = hasMore ? results.slice(0, limit) : results;

      endTimer();
      return {
        locations,
        total: locations.length,
        hasMore
      };

    } catch (error) {
      logger.error('Error finding locations near point:', error);
      endTimer();
      throw new Error('Error finding nearby locations');
    }
  }

  /**
   * Search locations by text query using MongoDB text search
   */
  async searchLocationsByText(
    searchQuery: string,
    options: LocationQueryOptions = {}
  ): Promise<LocationSearchResult> {
    try {
      const { limit = 10, skip = 0, type, country, city } = options;

      // Build match conditions
      const matchConditions: any = {
        $text: { $search: searchQuery }
      };

      if (type) {
        matchConditions["locations.type"] = type;
      }

      if (country) {
        matchConditions["locations.address.country"] = { $regex: country, $options: 'i' };
      }

      if (city) {
        matchConditions["locations.address.city"] = { $regex: city, $options: 'i' };
      }

      const results = await User.aggregate([
        { $match: matchConditions },
        { $unwind: "$locations" },
        { $match: matchConditions },
        {
          $project: {
            _id: 1,
            username: 1,
            "location": "$locations",
            score: { $meta: "textScore" }
          }
        },
        { $sort: { score: { $meta: "textScore" } } },
        { $skip: skip },
        { $limit: limit + 1 }
      ]);

      const hasMore = results.length > limit;
      const locations = hasMore ? results.slice(0, limit) : results;

      return {
        locations,
        total: locations.length,
        hasMore
      };

    } catch (error) {
      logger.error('Error searching locations by text:', error);
      throw new Error('Error searching locations');
    }
  }

  /**
   * Get locations by type with efficient filtering
   */
  async getLocationsByType(
    type: string,
    options: LocationQueryOptions = {}
  ): Promise<LocationSearchResult> {
    try {
      const { limit = 10, skip = 0, country, city } = options;

      const matchConditions: any = {
        "locations.type": type
      };

      if (country) {
        matchConditions["locations.address.country"] = { $regex: country, $options: 'i' };
      }

      if (city) {
        matchConditions["locations.address.city"] = { $regex: city, $options: 'i' };
      }

      const results = await User.aggregate([
        { $match: matchConditions },
        { $unwind: "$locations" },
        { $match: matchConditions },
        {
          $project: {
            _id: 1,
            username: 1,
            "location": "$locations"
          }
        },
        { $sort: { "location.createdAt": -1 } },
        { $skip: skip },
        { $limit: limit + 1 }
      ]);

      const hasMore = results.length > limit;
      const locations = hasMore ? results.slice(0, limit) : results;

      return {
        locations,
        total: locations.length,
        hasMore
      };

    } catch (error) {
      logger.error('Error getting locations by type:', error);
      throw new Error('Error getting locations by type');
    }
  }

  /**
   * Get locations by country and city
   */
  async getLocationsByCountryCity(
    country: string,
    city?: string,
    options: LocationQueryOptions = {}
  ): Promise<LocationSearchResult> {
    try {
      const { limit = 10, skip = 0, type } = options;

      const matchConditions: any = {
        "locations.address.country": { $regex: country, $options: 'i' }
      };

      if (city) {
        matchConditions["locations.address.city"] = { $regex: city, $options: 'i' };
      }

      if (type) {
        matchConditions["locations.type"] = type;
      }

      const results = await User.aggregate([
        { $match: matchConditions },
        { $unwind: "$locations" },
        { $match: matchConditions },
        {
          $project: {
            _id: 1,
            username: 1,
            "location": "$locations"
          }
        },
        { $sort: { "location.createdAt": -1 } },
        { $skip: skip },
        { $limit: limit + 1 }
      ]);

      const hasMore = results.length > limit;
      const locations = hasMore ? results.slice(0, limit) : results;

      return {
        locations,
        total: locations.length,
        hasMore
      };

    } catch (error) {
      logger.error('Error getting locations by country/city:', error);
      throw new Error('Error getting locations by country/city');
    }
  }

  /**
   * Get location statistics
   */
  async getLocationStats(): Promise<{
    totalLocations: number;
    locationsByType: { [key: string]: number };
    locationsByCountry: { [key: string]: number };
    topCities: { city: string; count: number }[];
  }> {
    try {
      const stats = await User.aggregate([
        { $unwind: "$locations" },
        {
          $group: {
            _id: null,
            totalLocations: { $sum: 1 },
            locationsByType: {
              $push: "$locations.type"
            },
            locationsByCountry: {
              $push: "$locations.address.country"
            },
            cities: {
              $push: "$locations.address.city"
            }
          }
        },
        {
          $project: {
            totalLocations: 1,
            locationsByType: {
              $reduce: {
                input: "$locationsByType",
                initialValue: {},
                in: {
                  $mergeObjects: [
                    "$$value",
                    {
                      $literal: {
                        $concat: [
                          "$$this",
                          ": ",
                          { $toString: { $add: [{ $indexOfArray: ["$locationsByType", "$$this"] }, 1] } }
                        ]
                      }
                    }
                  ]
                }
              }
            },
            locationsByCountry: {
              $reduce: {
                input: "$locationsByCountry",
                initialValue: {},
                in: {
                  $mergeObjects: [
                    "$$value",
                    {
                      $literal: {
                        $concat: [
                          "$$this",
                          ": ",
                          { $toString: { $add: [{ $indexOfArray: ["$locationsByCountry", "$$this"] }, 1] } }
                        ]
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      ]);

      // Process results
      const result = stats[0] || {
        totalLocations: 0,
        locationsByType: {},
        locationsByCountry: {},
        topCities: []
      };

      // Get top cities
      const cityStats = await User.aggregate([
        { $unwind: "$locations" },
        {
          $group: {
            _id: "$locations.address.city",
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $project: {
            city: "$_id",
            count: 1,
            _id: 0
          }
        }
      ]);

      return {
        totalLocations: result.totalLocations,
        locationsByType: result.locationsByType,
        locationsByCountry: result.locationsByCountry,
        topCities: cityStats
      };

    } catch (error) {
      logger.error('Error getting location stats:', error);
      throw new Error('Error getting location statistics');
    }
  }

  /**
   * Update location coordinates efficiently
   */
  async updateLocationCoordinates(
    userId: string,
    locationId: string,
    lat: number,
    lon: number
  ): Promise<boolean> {
    try {
      const result = await User.updateOne(
        {
          _id: userId,
          "locations.id": locationId
        },
        {
          $set: {
            "locations.$.coordinates": { lat, lon },
            "locations.$.updatedAt": new Date()
          }
        }
      );

      return result.modifiedCount > 0;

    } catch (error) {
      logger.error('Error updating location coordinates:', error);
      throw new Error('Error updating location coordinates');
    }
  }

  /**
   * Delete location efficiently
   */
  async deleteLocation(userId: string, locationId: string): Promise<boolean> {
    try {
      const result = await User.updateOne(
        { _id: userId },
        {
          $pull: {
            locations: { id: locationId }
          }
        }
      );

      return result.modifiedCount > 0;

    } catch (error) {
      logger.error('Error deleting location:', error);
      throw new Error('Error deleting location');
    }
  }
}

// Export singleton instance
export const locationQueryService = new LocationQueryService();
export default locationQueryService; 