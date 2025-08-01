/**
 * Tests for the new validation utility functions added to fix the TypeError issue
 */

import {
  isNotNullOrUndefined,
  safeGet,
  safeCall,
  validateServiceInstance,
  safeAsyncCall
} from '../validationUtils';

describe('New Validation Utilities', () => {
  describe('isNotNullOrUndefined', () => {
    it('should return false for null', () => {
      expect(isNotNullOrUndefined(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isNotNullOrUndefined(undefined)).toBe(false);
    });

    it('should return true for valid values', () => {
      expect(isNotNullOrUndefined(0)).toBe(true);
      expect(isNotNullOrUndefined('')).toBe(true);
      expect(isNotNullOrUndefined(false)).toBe(true);
      expect(isNotNullOrUndefined({})).toBe(true);
      expect(isNotNullOrUndefined([])).toBe(true);
    });
  });

  describe('safeGet', () => {
    it('should return null for null/undefined objects', () => {
      expect(safeGet(null, 'prop')).toBeNull();
      expect(safeGet(undefined, 'prop')).toBeNull();
    });

    it('should return property value for valid objects', () => {
      const obj = { searchProfiles: 'method', name: 'test' };
      expect(safeGet(obj, 'searchProfiles')).toBe('method');
      expect(safeGet(obj, 'name')).toBe('test');
    });
  });

  describe('safeCall', () => {
    it('should return null for null/undefined objects', () => {
      expect(safeCall(null, 'toString')).toBeNull();
      expect(safeCall(undefined, 'toString')).toBeNull();
    });

    it('should return null if method does not exist', () => {
      const obj = { name: 'test' };
      expect(safeCall(obj, 'nonExistentMethod' as any)).toBeNull();
    });

    it('should call method if object and method exist', () => {
      const obj = { 
        searchProfiles: jest.fn().mockReturnValue('result'),
        getData: jest.fn().mockReturnValue('data')
      };
      
      expect(safeCall(obj, 'searchProfiles')).toBe('result');
      expect(obj.searchProfiles).toHaveBeenCalled();
    });
  });

  describe('validateServiceInstance', () => {
    it('should throw error for null/undefined service', () => {
      expect(() => validateServiceInstance(null)).toThrow('Service instance is not initialized');
      expect(() => validateServiceInstance(undefined)).toThrow('Service instance is not initialized');
    });

    it('should throw error for non-object service', () => {
      expect(() => validateServiceInstance('string')).toThrow('Service instance is not a valid object');
      expect(() => validateServiceInstance(123)).toThrow('Service instance is not a valid object');
    });

    it('should not throw for valid object', () => {
      expect(() => validateServiceInstance({})).not.toThrow();
      expect(() => validateServiceInstance({ searchProfiles: () => {} })).not.toThrow();
    });

    it('should use custom service name in error messages', () => {
      expect(() => validateServiceInstance(null, 'OxyServices')).toThrow('OxyServices instance is not initialized');
    });
  });

  describe('safeAsyncCall', () => {
    it('should return result for successful async operation', async () => {
      const asyncFn = jest.fn().mockResolvedValue('success');
      const result = await safeAsyncCall(asyncFn, 'fallback');
      
      expect(result).toBe('success');
      expect(asyncFn).toHaveBeenCalled();
    });

    it('should return fallback value for failed async operation', async () => {
      const asyncFn = jest.fn().mockRejectedValue(new Error('failure'));
      const result = await safeAsyncCall(asyncFn, 'fallback');
      
      expect(result).toBe('fallback');
      expect(asyncFn).toHaveBeenCalled();
    });
  });
});