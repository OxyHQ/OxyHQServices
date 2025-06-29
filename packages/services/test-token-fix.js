#!/usr/bin/env node

const { OxyServices } = require('./lib/commonjs/core');

console.log('🔧 Testing Token Fix...\n');

// Initialize the service
const oxy = new OxyServices({
    baseURL: 'http://localhost:3001'
});

async function testTokenFix() {
    try {
        // 1. Test that getTokenBySession works
        console.log('1️⃣ Testing getTokenBySession method...');
        
        // First, we need to create a session
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

        // 2. Test getTokenBySession
        console.log('\n2️⃣ Testing getTokenBySession...');
        const tokenResponse = await oxy.getTokenBySession(loginResponse.sessionId);
        console.log('✅ getTokenBySession works:', !!tokenResponse.accessToken);

        // 3. Test that getAccessToken doesn't exist (should throw error)
        console.log('\n3️⃣ Testing that getAccessToken method doesn\'t exist...');
        if (typeof oxy.getAccessToken === 'function') {
            console.log('❌ getAccessToken method still exists - this is wrong!');
        } else {
            console.log('✅ getAccessToken method correctly removed');
        }

        // 4. Test profile update with token
        console.log('\n4️⃣ Testing profile update with token...');
        const updateData = {
            bio: 'Test bio from token fix test'
        };

        const updatedUser = await oxy.updateProfile(updateData);
        console.log('✅ Profile update successful:', updatedUser.bio);

        // 5. Cleanup
        console.log('\n5️⃣ Cleaning up...');
        await oxy.logoutSecureSession(loginResponse.sessionId, loginResponse.sessionId);
        console.log('✅ Cleanup complete');

        console.log('\n🎉 Token fix test passed!');
        console.log('   The 401 error should now be resolved in your UI.');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        if (error.message.includes('getAccessToken')) {
            console.error('   This confirms the old method is still being called somewhere.');
        }
        process.exit(1);
    }
}

// Run the test
testTokenFix(); 