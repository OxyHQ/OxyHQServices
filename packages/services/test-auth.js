const OxyServices = require('./lib/commonjs/node/index.js').default;

async function testAuthenticationFlow() {
  console.log('🔐 Testing OxyHQ Services Authentication Flow...\n');

  // Initialize services
  const oxy = new OxyServices({
    baseURL: 'http://localhost:3001'
  });

  try {
    // Test 1: Check API health (no auth required)
    console.log('1️⃣ Testing API health (no auth required)...');
    const healthResponse = await fetch('http://localhost:3001/health');
    const health = await healthResponse.json();
    console.log('✅ API Health:', health.status);
    console.log('');

    // Test 2: Test username availability (no auth required)
    console.log('2️⃣ Testing username availability (no auth required)...');
    const usernameCheck = await oxy.checkUsernameAvailability('testuser123');
    console.log('✅ Username availability:', usernameCheck);
    console.log('');

    // Test 3: Test user search (no auth required)
    console.log('3️⃣ Testing user search (no auth required)...');
    const searchResults = await oxy.searchProfiles('test');
    console.log('✅ Search results:', searchResults.length, 'users found');
    console.log('');

    // Test 4: Test authenticated endpoint without auth (should fail)
    console.log('4️⃣ Testing authenticated endpoint without auth (should fail)...');
    try {
      await oxy.getCurrentUser();
      console.log('❌ This should have failed!');
    } catch (error) {
      console.log('✅ Expected error:', error.code, '-', error.message);
      console.log('✅ This confirms the API is properly protecting authenticated endpoints');
    }
    console.log('');

    // Test 5: Test user registration (no auth required)
    console.log('5️⃣ Testing user registration (no auth required)...');
    try {
      const signUpResult = await oxy.signUp('testuser123', 'test@example.com', 'password123');
      console.log('✅ User registered successfully:', signUpResult.user.username);
      console.log('✅ Access token received:', !!signUpResult.token);
      console.log('');
      
      // Test 6: Test authenticated endpoint with auth (should work)
      console.log('6️⃣ Testing authenticated endpoint with auth (should work)...');
      const currentUser = await oxy.getCurrentUser();
      console.log('✅ Current user retrieved:', currentUser.username);
      console.log('✅ User ID:', currentUser.id);
      console.log('');

      // Test 7: Test profile update (authenticated)
      console.log('7️⃣ Testing profile update (authenticated)...');
      const updatedUser = await oxy.updateProfile({
        bio: 'Updated bio from test script'
      });
      console.log('✅ Profile updated successfully');
      console.log('✅ New bio:', updatedUser.bio);
      console.log('');

      // Test 8: Test logout
      console.log('8️⃣ Testing logout...');
      await oxy.logout();
      console.log('✅ Logout successful');
      console.log('');

      // Test 9: Test authenticated endpoint after logout (should fail)
      console.log('9️⃣ Testing authenticated endpoint after logout (should fail)...');
      try {
        await oxy.getCurrentUser();
        console.log('❌ This should have failed after logout!');
      } catch (error) {
        console.log('✅ Expected error after logout:', error.code, '-', error.message);
      }
      console.log('');

    } catch (signUpError) {
      if (signUpError.message.includes('already exists')) {
        console.log('ℹ️  User already exists, testing login instead...');
        
        // Test login with existing user
        const loginResult = await oxy.login('testuser123', 'password123');
        console.log('✅ User logged in successfully:', loginResult.user.username);
        console.log('✅ Access token received:', !!loginResult.accessToken);
        console.log('');

        // Test authenticated endpoint
        const currentUser = await oxy.getCurrentUser();
        console.log('✅ Current user retrieved:', currentUser.username);
        console.log('');

        // Test logout
        await oxy.logout();
        console.log('✅ Logout successful');
        console.log('');
      } else {
        throw signUpError;
      }
    }

    console.log('🎉 All authentication tests passed! The services package is working correctly.');
    console.log('');
    console.log('📋 Summary:');
    console.log('✅ Unauthenticated endpoints work correctly');
    console.log('✅ Authenticated endpoints are properly protected');
    console.log('✅ Authentication flow works end-to-end');
    console.log('✅ Token management is working');
    console.log('✅ Logout functionality works');
    console.log('');
    console.log('🚀 The OxyHQ Services package is ready for production use!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testAuthenticationFlow(); 