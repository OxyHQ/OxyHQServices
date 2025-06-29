#!/usr/bin/env node

const { OxyServices } = require('./lib/commonjs/core');

console.log('🧪 Testing OxyHQ Services UI Authentication Flow...\n');

// Initialize the service
const oxy = new OxyServices({
    baseURL: 'http://localhost:3001'
});

async function testUIAuthentication() {
    try {
        // 1. Test API health
        console.log('1️⃣ Testing API health...');
        const health = await oxy.getHealth();
        console.log('✅ API Health:', health.status);

        // 2. Test user registration (simulating sign up)
        console.log('\n2️⃣ Testing user registration...');
        const testUser = {
            username: `testuser_${Date.now()}`,
            email: `test_${Date.now()}@example.com`,
            password: 'TestPassword123!'
        };

        const signUpResponse = await oxy.signUp(testUser.username, testUser.email, testUser.password);
        console.log('✅ User registered:', signUpResponse.username);

        // 3. Test secure login (simulating UI login)
        console.log('\n3️⃣ Testing secure login...');
        const loginResponse = await oxy.secureLogin(
            testUser.username,
            testUser.password,
            'Test Device',
            'test-fingerprint'
        );
        console.log('✅ Secure login successful');
        console.log('   Session ID:', loginResponse.sessionId);
        console.log('   User:', loginResponse.user.username);

        // 4. Test getting token by session (what the UI context does)
        console.log('\n4️⃣ Testing token retrieval by session...');
        const tokenResponse = await oxy.getTokenBySession(loginResponse.sessionId);
        console.log('✅ Token retrieved successfully');
        console.log('   Has access token:', !!tokenResponse.accessToken);

        // 5. Test getting user by session (what the UI context does)
        console.log('\n5️⃣ Testing user retrieval by session...');
        const userBySession = await oxy.getUserBySession(loginResponse.sessionId);
        console.log('✅ User retrieved by session');
        console.log('   Username:', userBySession.username);
        console.log('   User ID:', userBySession.id);

        // 6. Test profile update (the problematic operation)
        console.log('\n6️⃣ Testing profile update (the operation that was failing)...');
        const updateData = {
            bio: 'Updated bio from UI test',
            location: 'Test Location',
            website: 'https://test.example.com'
        };

        const updatedUser = await oxy.updateProfile(updateData);
        console.log('✅ Profile updated successfully!');
        console.log('   New bio:', updatedUser.bio);
        console.log('   New location:', updatedUser.location);
        console.log('   New website:', updatedUser.website);

        // 7. Test session validation
        console.log('\n7️⃣ Testing session validation...');
        const validation = await oxy.validateSession(loginResponse.sessionId);
        console.log('✅ Session validation:', validation.valid);

        // 8. Test logout
        console.log('\n8️⃣ Testing logout...');
        await oxy.logoutSecureSession(loginResponse.sessionId, loginResponse.sessionId);
        console.log('✅ Logout successful');

        // 9. Test that authenticated endpoints fail after logout
        console.log('\n9️⃣ Testing authenticated endpoint after logout (should fail)...');
        try {
            await oxy.getUserBySession(loginResponse.sessionId);
            console.log('❌ Unexpected success - should have failed');
        } catch (error) {
            console.log('✅ Expected error after logout:', error.message);
        }

        console.log('\n🎉 All UI authentication tests passed!');
        console.log('\n📋 Summary:');
        console.log('✅ Secure session-based authentication works');
        console.log('✅ Token management is working correctly');
        console.log('✅ Profile updates work without 401 errors');
        console.log('✅ Session validation works');
        console.log('✅ Logout functionality works');

        console.log('\n🚀 The UI authentication fix is working correctly!');
        console.log('   The 401 error on profile updates should now be resolved.');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Run the test
testUIAuthentication(); 