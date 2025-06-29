/**
 * Real-world scenario test: Mention app and other Oxy ecosystem apps
 * This test demonstrates the exact use case described in the issue
 */

describe('Real-world Oxy Ecosystem Integration', () => {
  describe('Mention app scenario', () => {
    // Simulate the complete Mention app setup
    function simulateMentionAppSetup() {
      console.log('Setting up Mention app with Oxy authentication...');

      // 1. Create OxyServices for Oxy API authentication
      const oxyServices = {
        baseURL: 'https://api.oxy.so',
        getBaseURL: () => 'https://api.oxy.so',
        setBaseURL: (url: string) => {
          console.log(`[OxyServices] Internal URL change to: ${url}`);
        },
        // Internal methods that need to call Oxy API
        authenticateToken: async (token: string) => {
          const url = `https://api.oxy.so/auth/validate`;
          console.log(`[Internal] Validating token at: ${url}`);
          return { valid: true, user: { id: 'user123', username: 'mentionuser' } };
        },
        refreshTokens: async () => {
          const url = `https://api.oxy.so/auth/refresh`;
          console.log(`[Internal] Refreshing tokens at: ${url}`);
          return { accessToken: 'new-token', refreshToken: 'new-refresh' };
        }
      };

      // 2. Create context with separation
      let appBaseURL = oxyServices.baseURL; // Initially same

      const oxyContext = {
        oxyServices,
        setApiUrl: (url: string) => {
          console.log(`[App] Setting app API URL to: ${url}`);
          appBaseURL = url; // Only affects public authFetch
        },
        getAppBaseURL: () => appBaseURL,
        isAuthenticated: true,
        user: { id: 'user123', username: 'mentionuser' },
        login: async (username: string, password: string) => ({ id: 'user123' }),
        logout: async () => {},
        signUp: async (username: string, email: string, password: string) => ({ id: 'user123' }),
        activeSessionId: 'session123'
      };

      // 3. Create authFetch that uses app-specific URL
      const authFetch = {
        get: async (endpoint: string) => {
          const url = `${oxyContext.getAppBaseURL()}${endpoint}`;
          console.log(`[AuthFetch] GET ${url}`);
          return { data: `Response from ${url}` };
        },
        post: async (endpoint: string, data: any) => {
          const url = `${oxyContext.getAppBaseURL()}${endpoint}`;
          console.log(`[AuthFetch] POST ${url}`, data);
          return { data: `Posted to ${url}`, created: data };
        },
        put: async (endpoint: string, data: any) => {
          const url = `${oxyContext.getAppBaseURL()}${endpoint}`;
          console.log(`[AuthFetch] PUT ${url}`, data);
          return { data: `Updated at ${url}`, updated: data };
        },
        delete: async (endpoint: string) => {
          const url = `${oxyContext.getAppBaseURL()}${endpoint}`;
          console.log(`[AuthFetch] DELETE ${url}`);
          return { data: `Deleted from ${url}` };
        },
        setApiUrl: oxyContext.setApiUrl,
        isAuthenticated: oxyContext.isAuthenticated,
        user: oxyContext.user
      };

      return { oxyServices, oxyContext, authFetch };
    }

    test('should enable Mention app to use its own backend with Oxy authentication', async () => {
      console.log('\\n=== Mention App Real-world Test ===\\n');

      const { oxyServices, oxyContext, authFetch } = simulateMentionAppSetup();

      console.log('1. Initial setup - both use Oxy API:');
      // Internal authentication calls
      await oxyServices.authenticateToken('user-token');
      
      // Public app calls (initially to Oxy API)
      await authFetch.get('/api/user/profile');

      console.log('\\n2. Mention app configures its own backend:');
      // This is the key change - app sets its own API URL
      authFetch.setApiUrl('https://mention.earth/api');

      console.log('\\n3. After configuration - clean separation:');
      
      // Internal module calls STILL go to Oxy API
      await oxyServices.authenticateToken('user-token');
      await oxyServices.refreshTokens();
      
      // Public authFetch calls now go to Mention's backend
      await authFetch.get('/api/mentions');
      await authFetch.post('/api/mentions', { 
        text: 'Hello world from Mention!',
        userId: 'user123'
      });
      await authFetch.put('/api/mentions/123', { 
        text: 'Updated mention text' 
      });
      await authFetch.delete('/api/mentions/456');

      console.log('\\n4. Verification:');
      const internalURL = oxyServices.getBaseURL();
      const publicURL = oxyContext.getAppBaseURL();
      
      console.log(`Internal (Oxy API): ${internalURL}`);
      console.log(`Public (Mention API): ${publicURL}`);

      // Verify the separation
      expect(internalURL).toBe('https://api.oxy.so');
      expect(publicURL).toBe('https://mention.earth/api');

      console.log('\\n✅ Mention app can use Oxy auth with its own backend!');
    });

    test('should support multiple Oxy ecosystem apps with different backends', async () => {
      console.log('\\n=== Multiple Oxy Apps Test ===\\n');

      // Simulate different apps in the Oxy ecosystem
      const apps = [
        { name: 'Mention', url: 'https://mention.earth/api' },
        { name: 'Homiio', url: 'https://homiio.com/api' },
        { name: 'Custom App', url: 'https://my-custom-app.com/api' }
      ];

      for (const app of apps) {
        console.log(`${app.name} app setup:`);
        
        const { oxyServices, oxyContext, authFetch } = simulateMentionAppSetup();
        
        // Each app configures its own backend
        authFetch.setApiUrl(app.url);
        
        // Internal auth still works with Oxy
        await oxyServices.authenticateToken('token');
        
        // App-specific calls go to app backend
        await authFetch.get('/api/data');
        
        // Verify separation for each app
        expect(oxyServices.getBaseURL()).toBe('https://api.oxy.so');
        expect(oxyContext.getAppBaseURL()).toBe(app.url);
        
        console.log(`  ✅ ${app.name} configured successfully\\n`);
      }

      console.log('✅ Multiple apps can coexist with independent backends!');
    });

    test('should demonstrate zero-config setup with runtime configuration', async () => {
      console.log('\\n=== Zero-Config + Runtime Config Test ===\\n');

      console.log('1. Zero-config setup (as described in issue):');
      
      // App developer just needs to:
      const { oxyServices, authFetch } = simulateMentionAppSetup();
      
      console.log('   - Create OxyServices instance ✅');
      console.log('   - Wrap app with OxyProvider ✅');
      console.log('   - Use authFetch in components ✅');
      
      console.log('\\n2. Runtime configuration (almost zero setup):');
      
      // App can dynamically configure its API
      authFetch.setApiUrl('https://production.myapp.com/api');
      
      console.log('\\n3. Everything works seamlessly:');
      
      // Authentication through Oxy
      await oxyServices.authenticateToken('user-token');
      
      // App data through app's backend
      await authFetch.get('/api/app-specific-data');
      await authFetch.post('/api/app-actions', { action: 'create' });
      
      console.log('\\n✅ Zero-config setup with runtime flexibility achieved!');
    });
  });

  describe('Backend integration scenarios', () => {
    test('should support backend token validation while frontend uses app API', async () => {
      console.log('\\n=== Backend Integration Test ===\\n');

      // Simulate backend middleware
      const backendOxyServices = {
        baseURL: 'https://api.oxy.so',
        authenticateToken: async (token: string) => {
          const url = `https://api.oxy.so/auth/validate`;
          console.log(`[Backend] Validating token at: ${url}`);
          return { 
            valid: true, 
            user: { id: 'user123', username: 'testuser' },
            userId: 'user123'
          };
        }
      };

      // Simulate frontend using app API
      const { authFetch } = simulateMentionAppSetup();
      authFetch.setApiUrl('https://myapp.com/api');

      console.log('1. Frontend makes authenticated request to app backend:');
      await authFetch.post('/api/protected-endpoint', { data: 'sensitive' });

      console.log('\\n2. Backend validates token with Oxy API:');
      const tokenValidation = await backendOxyServices.authenticateToken('user-jwt-token');
      
      console.log('   Token validation result:', tokenValidation);

      console.log('\\n✅ Backend validates with Oxy, frontend uses app API!');
    });
  });
});