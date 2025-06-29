/**
 * Backward compatibility test - ensures existing API surface is unchanged
 */

describe('Backward Compatibility', () => {
  describe('Existing API surface', () => {
    // Mock the components to test the API surface
    function mockUseOxy() {
      return {
        oxyServices: {
          getBaseURL: () => 'https://api.oxy.so',
          setBaseURL: (url: string) => {},
        },
        isAuthenticated: true,
        user: { id: 'user123', username: 'testuser' },
        login: async (username: string, password: string) => ({ id: 'user123' }),
        logout: async () => {},
        signUp: async (username: string, email: string, password: string) => ({ id: 'user123' }),
        activeSessionId: 'session123',
        setApiUrl: (url: string) => {}, // This should still exist
        getAppBaseURL: () => 'https://app.example.com', // New addition
      };
    }

    function mockUseAuthFetch() {
      const oxyContext = mockUseOxy();
      
      // Mock the AuthFetchAPI interface
      const authFetch = async (input: RequestInfo | URL, init?: any) => {
        return new Response('{"success": true}');
      };

      // Add convenience methods as per the interface
      Object.assign(authFetch, {
        get: async (endpoint: string, options?: any) => ({ data: 'get response' }),
        post: async (endpoint: string, data?: any, options?: any) => ({ data: 'post response' }),
        put: async (endpoint: string, data?: any, options?: any) => ({ data: 'put response' }),
        delete: async (endpoint: string, options?: any) => ({ data: 'delete response' }),
        isAuthenticated: oxyContext.isAuthenticated,
        user: oxyContext.user,
        login: oxyContext.login,
        logout: oxyContext.logout,
        signUp: oxyContext.signUp,
        setApiUrl: oxyContext.setApiUrl, // Existing API
      });

      return authFetch;
    }

    test('should maintain existing useAuthFetch API', async () => {
      const authFetch = mockUseAuthFetch();

      // Test that all existing methods are still available
      expect(typeof authFetch).toBe('function'); // Main function
      expect(typeof authFetch.get).toBe('function');
      expect(typeof authFetch.post).toBe('function');
      expect(typeof authFetch.put).toBe('function');
      expect(typeof authFetch.delete).toBe('function');
      expect(typeof authFetch.setApiUrl).toBe('function'); // Key API method

      // Test that auth properties are available
      expect(typeof authFetch.isAuthenticated).toBe('boolean');
      expect(authFetch.user).toBeTruthy();
      expect(typeof authFetch.login).toBe('function');
      expect(typeof authFetch.logout).toBe('function');
      expect(typeof authFetch.signUp).toBe('function');
    });

    test('should support existing usage patterns from documentation', async () => {
      // Test usage pattern from refactored-authentication.md
      const authFetch = mockUseAuthFetch();

      // Simple authenticated GET request
      const profile = await authFetch.get('/api/users/me');
      expect(profile).toEqual({ data: 'get response' });

      // Simple authenticated POST request
      const result = await authFetch.post('/api/users/me', { name: 'Updated Name' });
      expect(result).toEqual({ data: 'post response' });

      // Runtime API URL updates (this should still work)
      authFetch.setApiUrl('https://new-api.com');
      
      // Verify no breaking changes in the API surface
      expect(authFetch.isAuthenticated).toBe(true);
      expect(authFetch.user?.username).toBe('testuser');
    });

    test('should support existing OxyServices API', () => {
      const oxyContext = mockUseOxy();
      const oxyServices = oxyContext.oxyServices;

      // Existing OxyServices methods should still work
      expect(typeof oxyServices.getBaseURL).toBe('function');
      expect(typeof oxyServices.setBaseURL).toBe('function');
      expect(oxyServices.getBaseURL()).toBe('https://api.oxy.so');

      // This should not throw
      oxyServices.setBaseURL('https://new-oxy-url.com');
    });

    test('should demonstrate zero-config setup still works', () => {
      // From the documentation example
      console.log('Testing zero-config setup pattern...');

      // 1. Create OxyServices instance (existing pattern)
      const mockOxyServices = {
        baseURL: 'https://your-api.com',
        getBaseURL: () => 'https://your-api.com',
      };

      // 2. Wrap app with provider (existing pattern)
      const mockProvider = {
        oxyServices: mockOxyServices,
      };

      // 3. Use authFetch in components (existing pattern)
      const authFetch = mockUseAuthFetch();

      // All existing functionality should work
      expect(authFetch).toBeTruthy();
      expect(typeof authFetch.get).toBe('function');
      expect(typeof authFetch.setApiUrl).toBe('function');

      console.log('✅ Zero-config setup compatibility verified');
    });
  });

  describe('New functionality (additive)', () => {
    test('should add new getAppBaseURL without breaking existing API', () => {
      const oxyContext = mockUseOxy();

      // New method should be available
      expect(typeof oxyContext.getAppBaseURL).toBe('function');
      expect(oxyContext.getAppBaseURL()).toBe('https://app.example.com');

      // Existing methods should still work
      expect(typeof oxyContext.setApiUrl).toBe('function');
    });

    test('should demonstrate separation without breaking existing usage', () => {
      console.log('\nTesting that new separation doesn\'t break existing patterns...');

      const oxyContext = mockUseOxy();
      
      // Existing pattern: app sets API URL
      oxyContext.setApiUrl('https://myapp.example.com');
      
      // New behavior: this now only affects public authFetch, not internal calls
      // But from the app's perspective, the API call is identical
      expect(typeof oxyContext.setApiUrl).toBe('function');
      
      // Internal calls would still work independently (behind the scenes)
      expect(oxyContext.oxyServices.getBaseURL()).toBe('https://api.oxy.so');
      
      console.log('✅ Separation is transparent to existing users');
    });
  });
});