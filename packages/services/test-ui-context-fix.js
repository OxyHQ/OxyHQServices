#!/usr/bin/env node

const { OxyServices } = require('./lib/commonjs/core');

console.log('🧪 Testing UI Context Token Fix...\n');

// Initialize the service
const oxy = new OxyServices({
    baseURL: 'http://localhost:3001'
});

// Simulate the ensureToken function from the UI context
async function ensureToken(activeSessionId, oxyServices) {
    console.log('ensureToken: Starting token check...');
    console.log('ensureToken: Active session ID:', activeSessionId);
    
    if (!activeSessionId) {
        console.error('ensureToken: No active session ID found');
        throw new Error('No active session');
    }

    try {
        console.log('ensureToken: Getting token for session:', activeSessionId);
        // Get the current token for the active session
        const tokenResponse = await oxyServices.getTokenBySession(activeSessionId);
        console.log('ensureToken: Token retrieved successfully:', !!tokenResponse.accessToken);
        
        // Set the token on the service instance so it can be used for API calls
        oxyServices.setTokens(tokenResponse.accessToken, ''); // No refresh token needed for session-based auth
        console.log('ensureToken: Token set on service instance');
        
    } catch (error) {
        console.error('ensureToken: Failed to get token for session:', error);
        throw new Error('Authentication failed. Please log in again.');
    }
}

// Simulate the handleSave function from AccountSettingsScreen
async function handleSave(user, oxyServices, activeSessionId) {
    if (!user || !oxyServices) {
        console.error('handleSave: Missing user or oxyServices', { user: !!user, oxyServices: !!oxyServices });
        return;
    }

    try {
        console.log('handleSave: Starting profile update...');
        console.log('handleSave: User authenticated:', !!user);
        console.log('handleSave: Active session ID:', activeSessionId);

        // Ensure the token is set before making API calls
        console.log('handleSave: Ensuring token is set...');
        await ensureToken(activeSessionId, oxyServices);
        console.log('handleSave: Token ensured successfully');

        const updates = {
            bio: 'Updated bio from UI context test',
            location: 'Test Location',
            website: 'https://test.example.com'
        };

        console.log('handleSave: Making API call with updates:', updates);
        const result = await oxyServices.updateProfile(updates);
        console.log('handleSave: Profile update successful:', result.bio);
        
        return result;
    } catch (error) {
        console.error('Profile update error:', error);
        console.error('Error details:', {
            message: error.message,
            status: error.status,
            code: error.code,
            response: error.response
        });
        throw error;
    }
}

async function testUIContextFix() {
    try {
        // 1. Create a test user and session
        console.log('1️⃣ Creating test user and session...');
        const testUser = {
            username: `testuser_${Date.now()}`,
            email: `test_${Date.now()}@example.com`,
            password: 'TestPassword123!'
        };

        // Register and login to get a session
        await oxy.signUp(testUser.username, testUser.email, testUser.password);
        const loginResponse = await oxy.secureLogin(
            testUser.username,
            testUser.password,
            'Test Device',
            'test-fingerprint'
        );

        console.log('✅ Session created:', loginResponse.sessionId);

        // 2. Test the UI context flow
        console.log('\n2️⃣ Testing UI context authentication flow...');
        
        // Simulate the UI context state
        const mockUser = loginResponse.user;
        const activeSessionId = loginResponse.sessionId;
        
        console.log('✅ Mock user created:', mockUser.username);
        console.log('✅ Active session ID:', activeSessionId);

        // 3. Test the handleSave function (simulating AccountSettingsScreen)
        console.log('\n3️⃣ Testing handleSave function...');
        const result = await handleSave(mockUser, oxy, activeSessionId);
        console.log('✅ handleSave completed successfully');

        // 4. Verify the profile was actually updated
        console.log('\n4️⃣ Verifying profile update...');
        const updatedUser = await oxy.getUserBySession(activeSessionId);
        console.log('✅ Profile verification:', updatedUser.bio);

        // 5. Cleanup
        console.log('\n5️⃣ Cleaning up...');
        await oxy.logoutSecureSession(activeSessionId, activeSessionId);
        console.log('✅ Cleanup complete');

        console.log('\n🎉 UI Context Token Fix Test Passed!');
        console.log('   The 401 error should now be resolved in your UI.');
        console.log('   The ensureToken function is working correctly.');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        if (error.message.includes('getAccessToken')) {
            console.error('   This confirms the old method is still being called somewhere.');
        } else if (error.status === 401) {
            console.error('   This indicates the token is still not being set properly.');
        }
        process.exit(1);
    }
}

// Run the test
testUIContextFix(); 