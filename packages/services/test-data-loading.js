#!/usr/bin/env node

const { OxyServices } = require('./lib/commonjs/core');

console.log('🧪 Testing User Data Loading and Refresh...\n');

async function testDataLoadingAndRefresh() {
    const oxyServices = new OxyServices({
        baseURL: 'http://localhost:3001',
        timeout: 10000,
    });

    try {
        // Test 1: Login and get initial user data
        console.log('1. Logging in and getting initial user data...');
        const loginResponse = await oxyServices.secureLogin('testuser', 'password123', 'Test Device', 'test-fingerprint');
        console.log('✅ Login successful, session ID:', loginResponse.sessionId);

        // Set the token
        const tokenResponse = await oxyServices.getTokenBySession(loginResponse.sessionId);
        oxyServices.setTokens(tokenResponse.accessToken, '');

        // Get initial user data
        const initialUser = await oxyServices.getCurrentUser();
        console.log('✅ Initial user data:', {
            username: initialUser.username,
            email: initialUser.email,
            name: initialUser.name,
            bio: initialUser.bio,
            location: initialUser.location,
            website: initialUser.website
        });

        // Test 2: Update some fields
        console.log('\n2. Updating user fields...');
        const updateData = {
            bio: 'Updated bio for testing',
            location: 'Test Location',
            website: 'https://test.com'
        };

        await oxyServices.updateProfile(updateData);
        console.log('✅ Profile updated with:', updateData);

        // Test 3: Get user data again to verify it's updated
        console.log('\n3. Getting updated user data...');
        const updatedUser = await oxyServices.getCurrentUser();
        console.log('✅ Updated user data:', {
            username: updatedUser.username,
            email: updatedUser.email,
            name: updatedUser.name,
            bio: updatedUser.bio,
            location: updatedUser.location,
            website: updatedUser.website
        });

        // Test 4: Verify the data was actually updated
        console.log('\n4. Verifying data updates...');
        const bioUpdated = updatedUser.bio === 'Updated bio for testing';
        const locationUpdated = updatedUser.location === 'Test Location';
        const websiteUpdated = updatedUser.website === 'https://test.com';

        console.log(`   Bio updated: ${bioUpdated ? '✅' : '❌'} (${updatedUser.bio})`);
        console.log(`   Location updated: ${locationUpdated ? '✅' : '❌'} (${updatedUser.location})`);
        console.log(`   Website updated: ${websiteUpdated ? '✅' : '❌'} (${updatedUser.website})`);

        if (bioUpdated && locationUpdated && websiteUpdated) {
            console.log('\n🎉 All tests passed! Data loading and saving is working correctly.');
        } else {
            console.log('\n❌ Some tests failed. There may be an issue with data persistence.');
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
        console.error('Error details:', {
            message: error.message,
            status: error.status,
            code: error.code,
            response: error.response
        });
    }
}

testDataLoadingAndRefresh(); 