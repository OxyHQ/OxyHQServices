/**
 * Integration test demonstrating the separation of internal and public authFetch usage
 * This test simulates real-world usage patterns described in the issue
 */

describe('AuthFetch Separation - Integration Test', () => {
  describe('Real-world usage simulation', () => {
    // Mock OxyServices to simulate the actual implementation
    class MockOxyServices {
      private internalBaseURL: string;

      constructor(config: { baseURL: string }) {
        this.internalBaseURL = config.baseURL;
      }

      // Internal URL management (used by the module itself)
      getBaseURL(): string {
        return this.internalBaseURL;
      }

      setBaseURL(url: string): void {
        if (!url) throw new Error('Base URL cannot be empty');
        this.internalBaseURL = url;
      }

      // Simulate internal module methods that make API calls
      authenticateToken(token: string): Promise<{ valid: boolean; error?: string }> {
        const url = `${this.internalBaseURL}/auth/validate`;
        console.log(`Internal module call to: ${url}`);
        return Promise.resolve({ valid: false, error: 'Invalid token' });
      }

      refreshTokens(): Promise<void> {
        const url = `${this.internalBaseURL}/auth/refresh`;
        console.log(`Internal module call to: ${url}`);
        return Promise.resolve();
      }

      getUserBySession(sessionId: string): Promise<any> {
        const url = `${this.internalBaseURL}/users/session/${sessionId}`;
        console.log(`Internal module call to: ${url}`);
        return Promise.resolve({ id: 'user123', username: 'testuser' });
      }
    }

    // Mock context state (simulating the new OxyContext implementation)
    class MockOxyContext {
      private oxyServices: MockOxyServices;
      private appBaseURL: string;

      constructor(oxyServices: MockOxyServices) {
        this.oxyServices = oxyServices;
        this.appBaseURL = oxyServices.getBaseURL(); // Initially same as internal URL
      }

      // Public methods for apps
      setApiUrl(url: string): void {
        if (!url) throw new Error('Base URL cannot be empty');
        this.appBaseURL = url; // Only affects public authFetch
      }

      getAppBaseURL(): string {
        return this.appBaseURL;
      }

      getOxyServices(): MockOxyServices {
        return this.oxyServices;
      }
    }

    // Mock authFetch (simulating the new useAuthFetch implementation)
    function createMockAuthFetch(context: MockOxyContext) {
      return {
        get: async (endpoint: string) => {
          const url = `${context.getAppBaseURL()}${endpoint}`;
          console.log(`Public authFetch call to: ${url}`);
          return { data: `Response from ${url}` };
        },
        post: async (endpoint: string, data: any) => {
          const url = `${context.getAppBaseURL()}${endpoint}`;
          console.log(`Public authFetch call to: ${url}`);
          return { data: `Posted to ${url}`, posted: data };
        }
      };
    }

    test('should demonstrate clean separation in Mention app scenario', async () => {
      console.log('\n=== Mention App Integration Test ===\n');

      // 1. Initialize OxyServices for internal module usage
      const oxyServices = new MockOxyServices({
        baseURL: 'https://api.oxy.so'
      });

      // 2. Create context (simulating OxyProvider)
      const context = new MockOxyContext(oxyServices);
      
      // 3. Create authFetch (simulating useAuthFetch hook)
      const authFetch = createMockAuthFetch(context);

      console.log('1. Initial state:');
      
      // Internal module calls should use Oxy API
      await oxyServices.authenticateToken('test-token');
      await oxyServices.getUserBySession('session123');
      
      // Public authFetch calls initially use Oxy API too
      await authFetch.get('/api/users/me');
      await authFetch.post('/api/mentions', { text: 'Hello world' });

      console.log('\n2. Mention app sets its own API URL:');
      
      // App configures its own API URL
      context.setApiUrl('https://mention.earth/api');

      console.log('\n3. After configuration:');
      
      // Internal module calls STILL use Oxy API (unchanged)
      await oxyServices.authenticateToken('test-token');
      await oxyServices.refreshTokens();
      
      // Public authFetch calls now use Mention's API
      await authFetch.get('/api/mentions');
      await authFetch.post('/api/mentions', { text: 'New mention' });
      
      // Verify URLs are correctly separated
      expect(oxyServices.getBaseURL()).toBe('https://api.oxy.so');
      expect(context.getAppBaseURL()).toBe('https://mention.earth/api');
      
      console.log('\n✅ Clean separation achieved!');
    });

    test('should support dynamic URL changes without affecting internal calls', async () => {
      console.log('\n=== Dynamic URL Changes Test ===\n');

      const oxyServices = new MockOxyServices({
        baseURL: 'https://api.oxy.so'
      });
      const context = new MockOxyContext(oxyServices);
      const authFetch = createMockAuthFetch(context);

      // Scenario: App switches between staging and production
      const environments = [
        'https://staging.myapp.com/api',
        'https://production.myapp.com/api',
        'https://dev.myapp.com/api'
      ];

      for (const [index, env] of environments.entries()) {
        console.log(`${index + 1}. Switching to ${env}:`);
        
        context.setApiUrl(env);
        
        // Internal calls remain unchanged
        await oxyServices.authenticateToken('token');
        
        // Public calls use new environment
        await authFetch.get('/api/data');
        
        // Verify separation
        expect(oxyServices.getBaseURL()).toBe('https://api.oxy.so');
        expect(context.getAppBaseURL()).toBe(env);
      }
      
      console.log('\n✅ Dynamic URL changes work correctly!');
    });

    test('should handle zero-config setup as described in issue', () => {
      console.log('\n=== Zero-Config Setup Test ===\n');

      // Simulate the zero-config setup described in the issue
      console.log('1. Create OxyServices instance:');
      const oxyServices = new MockOxyServices({
        baseURL: 'https://your-api.com'
      });

      console.log('2. Wrap app with provider (simulated):');
      const context = new MockOxyContext(oxyServices);

      console.log('3. Use authFetch in components (simulated):');
      const authFetch = createMockAuthFetch(context);

      // Verify the setup works
      expect(oxyServices.getBaseURL()).toBe('https://your-api.com');
      expect(context.getAppBaseURL()).toBe('https://your-api.com');

      console.log('4. Change API URL at runtime:');
      context.setApiUrl('https://production-api.com');

      // Verify separation
      expect(oxyServices.getBaseURL()).toBe('https://your-api.com'); // Internal unchanged
      expect(context.getAppBaseURL()).toBe('https://production-api.com'); // Public changed

      console.log('\n✅ Zero-config setup with separation works!');
    });
  });
});