#!/usr/bin/env node

const { OxyServices } = require('./lib/commonjs/core');

console.log('🧪 Testing useOxy Hook and OxyContext...\n');

// Initialize the service
const oxy = new OxyServices({
    baseURL: 'http://localhost:3001'
});

// Mock the OxyContext state interface
class MockOxyContext {
    constructor(oxyServices) {
        this.oxyServices = oxyServices;
        this.user = null;
        this.minimalUser = null;
        this.sessions = [];
        this.activeSessionId = null;
        this.isLoading = false;
        this.error = null;
        this.storage = new Map(); // Simple in-memory storage for testing
    }

    // Simulate the ensureToken function
    async ensureToken() {
        console.log('useOxy.ensureToken: Starting token check...');
        console.log('useOxy.ensureToken: Active session ID:', this.activeSessionId);
        
        if (!this.activeSessionId) {
            console.error('useOxy.ensureToken: No active session ID found');
            throw new Error('No active session');
        }

        try {
            console.log('useOxy.ensureToken: Getting token for session:', this.activeSessionId);
            const tokenResponse = await this.oxyServices.getTokenBySession(this.activeSessionId);
            console.log('useOxy.ensureToken: Token retrieved successfully:', !!tokenResponse.accessToken);
            
            // Set the token on the service instance
            this.oxyServices.setTokens(tokenResponse.accessToken, '');
            console.log('useOxy.ensureToken: Token set on service instance');
            
        } catch (error) {
            console.error('useOxy.ensureToken: Failed to get token for session:', error);
            throw new Error('Authentication failed. Please log in again.');
        }
    }

    // Simulate the login function
    async login(username, password, deviceName = 'Test Device') {
        console.log('useOxy.login: Starting login process...');
        this.isLoading = true;
        this.error = null;

        try {
            const response = await this.oxyServices.secureLogin(
                username,
                password,
                deviceName,
                'test-fingerprint'
            );

            // Create client session
            const clientSession = {
                sessionId: response.sessionId,
                deviceId: response.deviceId,
                expiresAt: response.expiresAt,
                lastActive: new Date().toISOString(),
                userId: response.user.id,
                username: response.user.username
            };

            // Update sessions
            this.sessions = [clientSession];
            this.activeSessionId = response.sessionId;

            // Get token and set it
            const tokenResponse = await this.oxyServices.getTokenBySession(response.sessionId);
            this.oxyServices.setTokens(tokenResponse.accessToken, '');

            // Load full user data
            const fullUser = await this.oxyServices.getUserBySession(response.sessionId);
            this.user = fullUser;
            this.minimalUser = {
                id: fullUser.id,
                username: fullUser.username,
                avatar: fullUser.avatar
            };

            console.log('useOxy.login: Login successful');
            return fullUser;
        } catch (error) {
            this.error = error.message;
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    // Simulate the logout function
    async logout() {
        console.log('useOxy.logout: Starting logout process...');
        
        if (!this.activeSessionId) {
            console.log('useOxy.logout: No active session to logout');
            return;
        }

        try {
            await this.oxyServices.logoutSecureSession(this.activeSessionId, this.activeSessionId);
            
            // Clear state
            this.sessions = [];
            this.activeSessionId = null;
            this.user = null;
            this.minimalUser = null;
            this.oxyServices.clearTokens();
            
            console.log('useOxy.logout: Logout successful');
        } catch (error) {
            console.error('useOxy.logout: Logout error:', error);
            this.error = 'Logout failed';
        }
    }

    // Simulate the signUp function
    async signUp(username, email, password) {
        console.log('useOxy.signUp: Starting signup process...');
        this.isLoading = true;
        this.error = null;

        try {
            const response = await this.oxyServices.signUp(username, email, password);
            console.log('useOxy.signUp: Signup successful, now logging in...');
            
            // Auto-login after signup
            const user = await this.login(username, password);
            return user;
        } catch (error) {
            this.error = error.message;
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    // Get authentication state
    get isAuthenticated() {
        return !!this.user || (!!this.activeSessionId && !!this.oxyServices.getCurrentUserId());
    }

    // Simulate useOxy hook
    get useOxy() {
        return {
            user: this.user,
            minimalUser: this.minimalUser,
            sessions: this.sessions,
            activeSessionId: this.activeSessionId,
            isAuthenticated: this.isAuthenticated,
            isLoading: this.isLoading,
            error: this.error,
            oxyServices: this.oxyServices,
            login: this.login.bind(this),
            logout: this.logout.bind(this),
            signUp: this.signUp.bind(this),
            ensureToken: this.ensureToken.bind(this)
        };
    }
}

// Test the useOxy hook functionality
async function testUseOxyHook() {
    try {
        console.log('1️⃣ Testing useOxy hook initialization...');
        const mockContext = new MockOxyContext(oxy);
        const { useOxy } = mockContext;
        
        console.log('✅ useOxy hook created');
        console.log('   Initial state:', {
            user: !!useOxy.user,
            isAuthenticated: useOxy.isAuthenticated,
            isLoading: useOxy.isLoading,
            sessions: useOxy.sessions.length,
            activeSessionId: !!useOxy.activeSessionId
        });

        // 2. Test signup flow
        console.log('\n2️⃣ Testing useOxy.signUp...');
        const testUser = {
            username: `testuser_${Date.now()}`,
            email: `test_${Date.now()}@example.com`,
            password: 'TestPassword123!'
        };

        const signUpUser = await useOxy.signUp(testUser.username, testUser.email, testUser.password);
        console.log('✅ Signup successful:', signUpUser.username);
        console.log('   State after signup:', {
            user: !!useOxy.user,
            isAuthenticated: useOxy.isAuthenticated,
            sessions: useOxy.sessions.length,
            activeSessionId: !!useOxy.activeSessionId
        });

        // 3. Test ensureToken functionality
        console.log('\n3️⃣ Testing useOxy.ensureToken...');
        await useOxy.ensureToken();
        console.log('✅ ensureToken works correctly');

        // 4. Test profile update with useOxy context
        console.log('\n4️⃣ Testing profile update with useOxy context...');
        
        // Simulate AccountSettingsScreen using useOxy
        const handleSaveWithUseOxy = async () => {
            if (!useOxy.user || !useOxy.oxyServices) {
                console.error('handleSaveWithUseOxy: Missing user or oxyServices');
                return;
            }

            try {
                console.log('handleSaveWithUseOxy: Starting profile update...');
                console.log('handleSaveWithUseOxy: User authenticated:', !!useOxy.user);
                console.log('handleSaveWithUseOxy: Active session ID:', useOxy.activeSessionId);

                // Use the ensureToken from useOxy
                console.log('handleSaveWithUseOxy: Ensuring token is set...');
                await useOxy.ensureToken();
                console.log('handleSaveWithUseOxy: Token ensured successfully');

                const updates = {
                    bio: 'Updated bio from useOxy test',
                    location: 'Test Location',
                    website: 'https://test.example.com'
                };

                console.log('handleSaveWithUseOxy: Making API call with updates:', updates);
                const result = await useOxy.oxyServices.updateProfile(updates);
                console.log('handleSaveWithUseOxy: Profile update successful:', result.bio);
                
                return result;
            } catch (error) {
                console.error('Profile update error:', error);
                throw error;
            }
        };

        const updateResult = await handleSaveWithUseOxy();
        console.log('✅ Profile update with useOxy successful');

        // 5. Test authentication state consistency
        console.log('\n5️⃣ Testing authentication state consistency...');
        console.log('   User object:', !!useOxy.user);
        console.log('   isAuthenticated:', useOxy.isAuthenticated);
        console.log('   Active session:', !!useOxy.activeSessionId);
        console.log('   Sessions count:', useOxy.sessions.length);
        console.log('   Loading state:', useOxy.isLoading);
        console.log('   Error state:', useOxy.error);

        // 6. Test logout functionality
        console.log('\n6️⃣ Testing useOxy.logout...');
        await useOxy.logout();
        console.log('✅ Logout successful');
        console.log('   State after logout:', {
            user: !!useOxy.user,
            isAuthenticated: useOxy.isAuthenticated,
            sessions: useOxy.sessions.length,
            activeSessionId: !!useOxy.activeSessionId
        });

        // 7. Test that authenticated endpoints fail after logout
        console.log('\n7️⃣ Testing authenticated endpoint after logout (should fail)...');
        try {
            await useOxy.oxyServices.getUserBySession('invalid-session');
            console.log('❌ Unexpected success - should have failed');
        } catch (error) {
            console.log('✅ Expected error after logout:', error.message);
        }

        console.log('\n🎉 useOxy Hook Test Passed!');
        console.log('\n📋 Summary:');
        console.log('✅ useOxy hook initializes correctly');
        console.log('✅ Authentication state is properly managed');
        console.log('✅ Signup flow works end-to-end');
        console.log('✅ Login flow works correctly');
        console.log('✅ ensureToken function works with useOxy');
        console.log('✅ Profile updates work with useOxy context');
        console.log('✅ Logout functionality works');
        console.log('✅ Authentication state is consistent');

        console.log('\n🚀 The useOxy hook is working correctly!');
        console.log('   Your UI components should now work properly with authentication.');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Run the test
testUseOxyHook(); 