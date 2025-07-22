import axios from 'axios';
import { Request, Response } from 'express';
import { logger } from '../utils/logger';

interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  boundingbox: string[];
  lat: string;
  lon: string;
  display_name: string;
  class: string;
  type: string;
  importance: number;
  icon?: string;
  address?: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
}

interface EnhancedLocationResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  address: {
    street?: string;
    streetNumber?: string;
    streetDetails?: string;
    postalCode?: string;
    city?: string;
    state?: string;
    country?: string;
    formattedAddress?: string;
  };
  metadata: {
    placeId: string;
    osmId: string;
    osmType: string;
    countryCode?: string;
    timezone?: string;
  };
}

export class LocationSearchController {
  /**
   * Search for locations using Nominatim API
   */
  async searchLocations(req: Request, res: Response) {
    try {
      const { query, limit = 5, countrycodes, addressdetails = 1 } = req.query;

      if (!query || typeof query !== 'string') {
        return res.status(400).json({ 
          message: 'Query parameter is required' 
        });
      }

      if (query.length < 3) {
        return res.status(400).json({ 
          message: 'Query must be at least 3 characters long' 
        });
      }

      logger.info(`Searching locations for query: ${query}`);

      // Build Nominatim API URL
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        limit: limit.toString(),
        addressdetails: addressdetails.toString(),
        'accept-language': 'en'
      });

      if (countrycodes) {
        params.append('countrycodes', countrycodes as string);
      }

      const response = await axios.get(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        {
          headers: {
            'User-Agent': 'OxyHQ-LocationSearch/1.0'
          },
          timeout: 10000
        }
      );

      const results: NominatimResult[] = response.data;

      // Transform results to our enhanced format
      const enhancedResults: EnhancedLocationResult[] = results.map(result => {
        const address = result.address || {};
        
        return {
          place_id: result.place_id,
          display_name: result.display_name,
          lat: result.lat,
          lon: result.lon,
          type: result.type,
          address: {
            street: address.road,
            streetNumber: address.house_number,
            streetDetails: address.neighbourhood || address.suburb,
            postalCode: address.postcode,
            city: address.city,
            state: address.state,
            country: address.country,
            formattedAddress: result.display_name
          },
          metadata: {
            placeId: result.place_id.toString(),
            osmId: result.osm_id.toString(),
            osmType: result.osm_type,
            countryCode: address.country_code?.toUpperCase()
          }
        };
      });

      logger.info(`Found ${enhancedResults.length} locations for query: ${query}`);

      res.json({
        success: true,
        results: enhancedResults,
        query,
        total: enhancedResults.length
      });

    } catch (error) {
      logger.error('Error searching locations:', error);
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          return res.status(408).json({ 
            message: 'Request timeout - please try again' 
          });
        }
        if (error.response?.status === 429) {
          return res.status(429).json({ 
            message: 'Too many requests - please wait before trying again' 
          });
        }
      }

      res.status(500).json({ 
        message: 'Error searching locations' 
      });
    }
  }

  /**
   * Get detailed information about a specific location by coordinates
   */
  async getLocationDetails(req: Request, res: Response) {
    try {
      const { lat, lon } = req.query;

      if (!lat || !lon) {
        return res.status(400).json({ 
          message: 'Latitude and longitude parameters are required' 
        });
      }

      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lon as string);

      if (isNaN(latitude) || isNaN(longitude)) {
        return res.status(400).json({ 
          message: 'Invalid latitude or longitude values' 
        });
      }

      if (latitude < -90 || latitude > 90) {
        return res.status(400).json({ 
          message: 'Latitude must be between -90 and 90' 
        });
      }

      if (longitude < -180 || longitude > 180) {
        return res.status(400).json({ 
          message: 'Longitude must be between -180 and 180' 
        });
      }

      logger.info(`Getting location details for coordinates: ${lat}, ${lon}`);

      const response = await axios.get(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1&accept-language=en`,
        {
          headers: {
            'User-Agent': 'OxyHQ-LocationSearch/1.0'
          },
          timeout: 10000
        }
      );

      const result: NominatimResult = response.data;
      const address = result.address || {};

      const enhancedResult: EnhancedLocationResult = {
        place_id: result.place_id,
        display_name: result.display_name,
        lat: result.lat,
        lon: result.lon,
        type: result.type,
        address: {
          street: address.road,
          streetNumber: address.house_number,
          streetDetails: address.neighbourhood || address.suburb,
          postalCode: address.postcode,
          city: address.city,
          state: address.state,
          country: address.country,
          formattedAddress: result.display_name
        },
        metadata: {
          placeId: result.place_id.toString(),
          osmId: result.osm_id.toString(),
          osmType: result.osm_type,
          countryCode: address.country_code?.toUpperCase()
        }
      };

      logger.info(`Retrieved location details for: ${result.display_name}`);

      res.json({
        success: true,
        result: enhancedResult
      });

    } catch (error) {
      logger.error('Error getting location details:', error);
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          return res.status(408).json({ 
            message: 'Request timeout - please try again' 
          });
        }
        if (error.response?.status === 429) {
          return res.status(429).json({ 
            message: 'Too many requests - please wait before trying again' 
          });
        }
      }

      res.status(500).json({ 
        message: 'Error getting location details' 
      });
    }
  }
}

export default new LocationSearchController(); 