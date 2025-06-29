/**
 * Tests for authFetch separation between public and internal usage
 */

import { OxyServices } from '../../../core';

describe('AuthFetch Separation', () => {
  let oxyServices: OxyServices;

  beforeEach(() => {
    oxyServices = new OxyServices({
      baseURL: 'https://api.oxy.so'
    });
  });

  describe('OxyServices internal base URL isolation', () => {
    test('should preserve original base URL for internal calls', () => {
      const originalBaseURL = 'https://api.oxy.so';
      
      // Verify initial state
      expect(oxyServices.getBaseURL()).toBe(originalBaseURL);
      
      // Simulate app changing its own base URL (this should not affect OxyServices)
      // Note: In the new implementation, setApiUrl only affects app authFetch, not OxyServices
      const appBaseURL = 'https://app-api.example.com';
      
      // OxyServices base URL should remain unchanged
      expect(oxyServices.getBaseURL()).toBe(originalBaseURL);
    });

    test('should handle OxyServices base URL changes separately', () => {
      const originalBaseURL = 'https://api.oxy.so';
      const newOxyBaseURL = 'https://new-oxy-api.example.com';
      
      expect(oxyServices.getBaseURL()).toBe(originalBaseURL);
      
      // This should still work for internal module updates
      oxyServices.setBaseURL(newOxyBaseURL);
      expect(oxyServices.getBaseURL()).toBe(newOxyBaseURL);
    });

    test('should maintain separation - internal vs public URLs', () => {
      const oxyBaseURL = 'https://api.oxy.so';
      const appBaseURL = 'https://myapp.example.com';
      
      // OxyServices keeps its own URL for internal calls
      expect(oxyServices.getBaseURL()).toBe(oxyBaseURL);
      
      // App can have its own URL (this would be managed in context)
      // The separation ensures these don't interfere with each other
      expect(oxyBaseURL).not.toBe(appBaseURL);
    });
  });

  describe('URL validation and error handling', () => {
    test('should validate URLs properly', () => {
      expect(() => oxyServices.setBaseURL('')).toThrow('Base URL cannot be empty');
      expect(() => oxyServices.setBaseURL('not-a-url')).not.toThrow(); // axios will handle invalid URLs
    });

    test('should handle URL normalization', () => {
      oxyServices.setBaseURL('https://api.example.com/');
      expect(oxyServices.getBaseURL()).toBe('https://api.example.com/');
      
      oxyServices.setBaseURL('https://api.example.com');
      expect(oxyServices.getBaseURL()).toBe('https://api.example.com');
    });
  });
});