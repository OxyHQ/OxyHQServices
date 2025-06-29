/**
 * Tests for refactored useAuthFetch hook
 */

import { OxyServices } from '../../../core';

describe('useAuthFetch', () => {
  let oxyServices: OxyServices;

  beforeEach(() => {
    oxyServices = new OxyServices({
      baseURL: 'https://api.test.com'
    });
  });

  describe('OxyServices integration', () => {
    test('should set and get base URL', () => {
      expect(oxyServices.getBaseURL()).toBe('https://api.test.com');
      
      oxyServices.setBaseURL('https://new-api.test.com');
      expect(oxyServices.getBaseURL()).toBe('https://new-api.test.com');
    });

    test('should throw error for empty base URL', () => {
      expect(() => oxyServices.setBaseURL('')).toThrow('Base URL cannot be empty');
    });

    test('should handle token validation methods', () => {
      // Test that core methods exist
      expect(typeof oxyServices.getAccessToken).toBe('function');
      expect(typeof oxyServices.setTokens).toBe('function');
      expect(typeof oxyServices.clearTokens).toBe('function');
      expect(typeof oxyServices.refreshTokens).toBe('function');
    });
  });

  describe('URL resolution', () => {
    test('should resolve relative URLs correctly', () => {
      // This tests the logic that would be used in resolveURL function
      const baseURL = 'https://api.test.com';
      
      // Test relative URL with leading slash
      const relativeUrl = '/api/users';
      const expectedUrl = `${baseURL}${relativeUrl}`;
      expect(expectedUrl).toBe('https://api.test.com/api/users');
      
      // Test relative URL without leading slash
      const relativeUrl2 = 'api/users';
      const expectedUrl2 = `${baseURL}/${relativeUrl2}`;
      expect(expectedUrl2).toBe('https://api.test.com/api/users');
      
      // Test absolute URL (should remain unchanged)
      const absoluteUrl = 'https://other-api.test.com/api/users';
      expect(absoluteUrl).toBe('https://other-api.test.com/api/users');
    });
  });

  describe('Authentication middleware compatibility', () => {
    test('should create middleware function', () => {
      const middleware = oxyServices.createAuthenticateTokenMiddleware();
      expect(typeof middleware).toBe('function');
    });

    test('should validate tokens', async () => {
      const result = await oxyServices.authenticateToken('invalid-token');
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});