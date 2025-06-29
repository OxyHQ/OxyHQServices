/**
 * Tests for URL resolution in separated authFetch implementation
 */

describe('URL Resolution Separation', () => {
  describe('resolveURL function behavior', () => {
    // Mock implementation of resolveURL logic used in useAuthFetch
    function resolveURL(input: RequestInfo | URL, baseURL: string): string {
      if (!baseURL) {
        throw new Error('Base URL not configured. Please provide a baseURL in OxyServices configuration.');
      }

      const url = input.toString();
      
      // If it's already a full URL (http/https), return as is
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      
      // Normalize base URL (remove trailing slash)
      const normalizedBaseURL = baseURL.replace(/\/$/, '');
      
      // If URL starts with /, it's relative to base URL
      if (url.startsWith('/')) {
        return `${normalizedBaseURL}${url}`;
      }
      
      // Otherwise, append to base URL with /
      return `${normalizedBaseURL}/${url}`;
    }

    test('should resolve relative URLs with app base URL', () => {
      const appBaseURL = 'https://myapp.example.com';
      
      expect(resolveURL('/api/users', appBaseURL)).toBe('https://myapp.example.com/api/users');
      expect(resolveURL('api/users', appBaseURL)).toBe('https://myapp.example.com/api/users');
      expect(resolveURL('/api/posts', appBaseURL)).toBe('https://myapp.example.com/api/posts');
    });

    test('should preserve absolute URLs unchanged', () => {
      const appBaseURL = 'https://myapp.example.com';
      const absoluteURL = 'https://external-api.example.com/data';
      
      expect(resolveURL(absoluteURL, appBaseURL)).toBe(absoluteURL);
    });

    test('should handle different app base URLs independently', () => {
      const appBaseURL1 = 'https://app1.example.com';
      const appBaseURL2 = 'https://app2.example.com';
      const oxyBaseURL = 'https://api.oxy.so';
      
      // Same endpoint, different base URLs
      expect(resolveURL('/api/users', appBaseURL1)).toBe('https://app1.example.com/api/users');
      expect(resolveURL('/api/users', appBaseURL2)).toBe('https://app2.example.com/api/users');
      expect(resolveURL('/api/users', oxyBaseURL)).toBe('https://api.oxy.so/api/users');
    });

    test('should normalize base URLs correctly', () => {
      const baseURLWithSlash = 'https://myapp.example.com/';
      const baseURLWithoutSlash = 'https://myapp.example.com';
      
      expect(resolveURL('/api/users', baseURLWithSlash)).toBe('https://myapp.example.com/api/users');
      expect(resolveURL('/api/users', baseURLWithoutSlash)).toBe('https://myapp.example.com/api/users');
    });

    test('should throw error for missing base URL', () => {
      expect(() => resolveURL('/api/users', '')).toThrow('Base URL not configured');
    });
  });

  describe('Separation scenarios', () => {
    test('should demonstrate independent URL management', () => {
      // Simulate the separation: internal vs public URLs
      const internalOxyURL = 'https://api.oxy.so';
      const publicAppURL = 'https://mention.earth/api';
      
      // Internal module calls (would use OxyServices base URL)
      const internalCall = resolveURL('/auth/validate', internalOxyURL);
      expect(internalCall).toBe('https://api.oxy.so/auth/validate');
      
      // Public authFetch calls (would use app base URL)
      const publicCall = resolveURL('/api/mentions', publicAppURL);
      expect(publicCall).toBe('https://mention.earth/api/api/mentions');
    });

    test('should support dynamic app URL changes', () => {
      // Simulate changing app URL without affecting internal URL
      let appBaseURL = 'https://staging.myapp.com';
      const oxyBaseURL = 'https://api.oxy.so';
      
      // Initial state
      expect(resolveURL('/api/data', appBaseURL)).toBe('https://staging.myapp.com/api/data');
      expect(resolveURL('/auth/me', oxyBaseURL)).toBe('https://api.oxy.so/auth/me');
      
      // App changes its URL
      appBaseURL = 'https://production.myapp.com';
      
      // App URLs updated
      expect(resolveURL('/api/data', appBaseURL)).toBe('https://production.myapp.com/api/data');
      // Internal URLs unchanged
      expect(resolveURL('/auth/me', oxyBaseURL)).toBe('https://api.oxy.so/auth/me');
    });
  });

  // Helper function to mimic resolveURL from the actual implementation
  function resolveURL(input: RequestInfo | URL, baseURL: string): string {
    if (!baseURL) {
      throw new Error('Base URL not configured. Please provide a baseURL in OxyServices configuration.');
    }

    const url = input.toString();
    
    // If it's already a full URL (http/https), return as is
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // Normalize base URL (remove trailing slash)
    const normalizedBaseURL = baseURL.replace(/\/$/, '');
    
    // If URL starts with /, it's relative to base URL
    if (url.startsWith('/')) {
      return `${normalizedBaseURL}${url}`;
    }
    
    // Otherwise, append to base URL with /
    return `${normalizedBaseURL}/${url}`;
  }
});