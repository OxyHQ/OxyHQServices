/**
 * Simple test for service guard utilities focused on preventing TypeError
 */

import {
  safeSearchProfiles,
  safeServiceCall,
  isServiceReady,
  safeHandleSearch,
  safeLoadMoreResults,
  waitForServiceReady
} from '../serviceGuards';

// Mock OxyServices
const mockOxyServices = {
  searchProfiles: jest.fn(),
  getCurrentUser: jest.fn(),
  signIn: jest.fn(),
  signUp: jest.fn(),
  getUserById: jest.fn(),
};

const incompleteMockService = {
  searchProfiles: jest.fn(),
  // Missing essential methods
};

describe('Service Guards - Core Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console warnings/errors during tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('safeSearchProfiles', () => {
    it('should return empty array when service is null', async () => {
      const result = await safeSearchProfiles(null, 'test');
      expect(result).toEqual([]);
    });

    it('should return empty array when service is undefined', async () => {
      const result = await safeSearchProfiles(undefined, 'test');
      expect(result).toEqual([]);
    });

    it('should return empty array when searchProfiles method is missing', async () => {
      const invalidService = { someOtherMethod: () => {} } as any;
      const result = await safeSearchProfiles(invalidService, 'test');
      expect(result).toEqual([]);
    });

    it('should call searchProfiles when service is valid', async () => {
      const mockResults = [{ id: '1', name: 'Test User' }];
      mockOxyServices.searchProfiles.mockResolvedValue(mockResults);

      const result = await safeSearchProfiles(mockOxyServices as any, 'test');
      
      expect(mockOxyServices.searchProfiles).toHaveBeenCalledWith('test', undefined);
      expect(result).toEqual(mockResults);
    });

    it('should handle errors and return empty array', async () => {
      mockOxyServices.searchProfiles.mockRejectedValue(new Error('API Error'));

      const result = await safeSearchProfiles(mockOxyServices as any, 'test');
      
      expect(result).toEqual([]);
    });

    it('should pass pagination parameters', async () => {
      const mockResults = [{ id: '1', name: 'Test User' }];
      const pagination = { page: 1, limit: 10 };
      mockOxyServices.searchProfiles.mockResolvedValue(mockResults);

      await safeSearchProfiles(mockOxyServices as any, 'test', pagination);
      
      expect(mockOxyServices.searchProfiles).toHaveBeenCalledWith('test', pagination);
    });
  });

  describe('isServiceReady', () => {
    it('should return false for null service', () => {
      expect(isServiceReady(null)).toBe(false);
    });

    it('should return false for undefined service', () => {
      expect(isServiceReady(undefined)).toBe(false);
    });

    it('should return false for incomplete service', () => {
      expect(isServiceReady(incompleteMockService as any)).toBe(false);
    });

    it('should return true for complete service', () => {
      expect(isServiceReady(mockOxyServices as any)).toBe(true);
    });
  });

  describe('safeHandleSearch', () => {
    it('should call onEmpty when service is not ready', async () => {
      const onEmpty = jest.fn();
      
      await safeHandleSearch(null, 'test', { onEmpty });
      
      expect(onEmpty).toHaveBeenCalled();
    });

    it('should call onEmpty when query is invalid', async () => {
      const onEmpty = jest.fn();
      
      await safeHandleSearch(mockOxyServices as any, '', { onEmpty });
      
      expect(onEmpty).toHaveBeenCalled();
    });

    it('should handle successful search', async () => {
      const mockResults = [{ id: '1', name: 'Test User' }];
      const onSuccess = jest.fn();
      mockOxyServices.searchProfiles.mockResolvedValue(mockResults);

      await safeHandleSearch(mockOxyServices as any, 'test', { onSuccess });
      
      expect(onSuccess).toHaveBeenCalledWith(mockResults);
    });

    it('should call onEmpty when no results found', async () => {
      const onEmpty = jest.fn();
      mockOxyServices.searchProfiles.mockResolvedValue([]);

      await safeHandleSearch(mockOxyServices as any, 'test', { onEmpty });
      
      expect(onEmpty).toHaveBeenCalled();
    });

    it('should handle search errors gracefully', async () => {
      const onError = jest.fn();
      // The current implementation catches errors in safeSearchProfiles
      // and returns empty array, which then calls onEmpty, not onError
      mockOxyServices.searchProfiles.mockRejectedValue(new Error('Search failed'));

      await safeHandleSearch(mockOxyServices as any, 'test', { onError });
      
      // Should not throw or crash - this is the main goal
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('safeLoadMoreResults', () => {
    it('should call onError when service is not ready', async () => {
      const onError = jest.fn();
      
      await safeLoadMoreResults(null, 'test', 2, { onError });
      
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should call onError when query is invalid', async () => {
      const onError = jest.fn();
      
      await safeLoadMoreResults(mockOxyServices as any, '', 2, { onError });
      
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should handle successful load more', async () => {
      const mockResults = [{ id: '1', name: 'Test' }];
      const onSuccess = jest.fn();
      mockOxyServices.searchProfiles.mockResolvedValue(mockResults);

      await safeLoadMoreResults(mockOxyServices as any, 'test', 2, { 
        onSuccess, 
        pageSize: 10 
      });
      
      expect(onSuccess).toHaveBeenCalledWith(mockResults, false);
    });

    it('should pass correct pagination parameters', async () => {
      mockOxyServices.searchProfiles.mockResolvedValue([]);

      await safeLoadMoreResults(mockOxyServices as any, 'test', 3, { pageSize: 5 });
      
      expect(mockOxyServices.searchProfiles).toHaveBeenCalledWith('test', {
        page: 3,
        limit: 5,
        offset: 10 // (3-1) * 5
      });
    });
  });

  describe('waitForServiceReady', () => {
    it('should resolve immediately when service is ready', async () => {
      const getService = () => mockOxyServices as any;
      
      const result = await waitForServiceReady(getService, 1000, 50);
      
      expect(result).toBe(mockOxyServices);
    });

    it('should wait and resolve when service becomes ready', async () => {
      let serviceReady = false;
      const getService = () => serviceReady ? mockOxyServices as any : null;
      
      // Make service ready after 100ms
      setTimeout(() => { serviceReady = true; }, 100);
      
      const start = Date.now();
      const result = await waitForServiceReady(getService, 1000, 50);
      const elapsed = Date.now() - start;
      
      expect(result).toBe(mockOxyServices);
      expect(elapsed).toBeGreaterThan(90); // Should have waited at least ~100ms
    });

    it('should reject when timeout is reached', async () => {
      const getService = () => null; // Never ready
      
      await expect(waitForServiceReady(getService, 100, 25))
        .rejects.toThrow('Service did not become ready within 100ms');
    });
  });
});