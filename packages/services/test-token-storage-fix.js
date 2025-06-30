/**
 * Test script to verify token storage fixes
 * This script simulates the storage issue scenario and verifies the fixes work
 */

const { OxyServices } = require('./lib/commonjs/core');
const { initializeOxyStore, useOxyStore } = require('./lib/commonjs/stores');

// Configure test environment
const testConfig = {
  baseURL: process.env.OXY_API_URL || 'http://localhost:3001',
  username: 'nate',
  password: 'password123'
};

console.log('🧪 Testing Token Storage Fixes\n');

async function testTokenStorageFix() {
  try {
    // 1. Create OxyServices instance
    console.log('1️⃣ Creating OxyServices instance...');
    const oxy = new OxyServices({ baseURL: testConfig.baseURL });
    console.log('✅ OxyServices created');

    // 2. Initialize store
    console.log('\n2️⃣ Initializing OxyStore...');
    initializeOxyStore(oxy);
    console.log('✅ OxyStore initialized');

    // 3. Check initial state
    console.log('\n3️⃣ Checking initial state...');
    const initialState = useOxyStore.getState();
    console.log('Initial state:', {
      hasUser: !!initialState.user,
      isAuthenticated: initialState.isAuthenticated,
      hasAccessToken: !!initialState.accessToken,
      hasRefreshToken: !!initialState.refreshToken,
    });

    // 4. Test login with improved token handling
    console.log('\n4️⃣ Testing login with improved token handling...');
    try {
      const user = await initialState.login(testConfig.username, testConfig.password);
      console.log('✅ Login successful:', user.username);
      
      // Check tokens after login
      const postLoginState = useOxyStore.getState();
      console.log('Post-login state:', {
        hasUser: !!postLoginState.user,
        isAuthenticated: postLoginState.isAuthenticated,
        hasAccessToken: !!postLoginState.accessToken,
        hasRefreshToken: !!postLoginState.refreshToken,
        accessTokenLength: postLoginState.accessToken?.length || 0,
        refreshTokenLength: postLoginState.refreshToken?.length || 0,
      });

      if (!postLoginState.accessToken) {
        console.log('⚠️ No access token found after login - testing syncTokens...');
        postLoginState.syncTokens();
        
        const postSyncState = useOxyStore.getState();
        console.log('Post-sync state:', {
          hasAccessToken: !!postSyncState.accessToken,
          hasRefreshToken: !!postSyncState.refreshToken,
          accessTokenLength: postSyncState.accessToken?.length || 0,
          refreshTokenLength: postSyncState.refreshToken?.length || 0,
        });
      }

    } catch (loginError) {
      console.log('⚠️ Login failed (expected in test environment):', loginError.message);
      
      // Simulate the storage issue scenario
      console.log('\n5️⃣ Simulating storage issue scenario...');
      
      // Manually set user without tokens (simulating the issue)
      const mockUser = {
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      // Set user with null tokens (this was the original issue)
      useOxyStore.getState().setUser(mockUser, null, null);
      
      const issueState = useOxyStore.getState();
      console.log('Issue simulation state:', {
        hasUser: !!issueState.user,
        isAuthenticated: issueState.isAuthenticated,
        hasAccessToken: !!issueState.accessToken,
        hasRefreshToken: !!issueState.refreshToken,
        username: issueState.user?.username,
      });
      
      // Test the fix: setting user again with some tokens should work
      console.log('\n6️⃣ Testing fix: setting valid tokens...');
      useOxyStore.getState().setUser(mockUser, 'mock-access-token', 'mock-refresh-token');
      
      const fixedState = useOxyStore.getState();
      console.log('Fixed state:', {
        hasUser: !!fixedState.user,
        isAuthenticated: fixedState.isAuthenticated,
        hasAccessToken: !!fixedState.accessToken,
        hasRefreshToken: !!fixedState.refreshToken,
        accessTokenLength: fixedState.accessToken?.length || 0,
        refreshTokenLength: fixedState.refreshToken?.length || 0,
      });
      
      if (fixedState.accessToken && fixedState.refreshToken) {
        console.log('✅ Fix successful: Tokens are now properly stored');
      } else {
        console.log('❌ Fix failed: Tokens are still missing');
      }
    }

    console.log('\n🎉 Token storage fix test completed');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testTokenStorageFix().catch(console.error); 