const { OxyServices } = require('./packages/services/lib/commonjs/core');

// Initialize OxyServices
const oxy = new OxyServices({
  baseURL: 'http://localhost:3001'
});

async function debugMiddleware() {
  console.log('🔍 Debugging OxyHQ Middleware...\n');

  // Use the token from registration
  const testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4NzU1ZTRkYjljNzA1NzI1NThjOWUxYSIsInVzZXJJZCI6IjY4NzU1ZTRkYjljNzA1NzI1NThjOWUxYSIsInVzZXJuYW1lIjoidGVzdHVzZXIiLCJpYXQiOjE3NTI1MjIzMTcsImV4cCI6MTc1MjUyNTkxN30.SG5FuzXncWnPwzsMsp1cdPBt2Cor_pVZ7GQwFIUlZus';

  // Step 1: Test direct token validation
  console.log('1. Testing direct token validation...');
  try {
    // Set the token in the OxyServices instance
    oxy.setTokens(testToken, '');
    
    // Test the validate method directly
    const isValid = await oxy.validate();
    console.log('✅ Direct validation result:', isValid);
    
    // Test the authenticateToken method
    const authResult = await oxy.authenticateToken(testToken);
    console.log('✅ AuthenticateToken result:', authResult);
    
  } catch (error) {
    console.error('❌ Error during validation:', error.message);
    return;
  }

  // Step 2: Test the middleware creation
  console.log('\n2. Testing middleware creation...');
  try {
    const middleware = oxy.createAuthenticateTokenMiddleware({
      loadFullUser: true,
      onError: (error) => {
        console.log('🔴 Middleware error handler called:', error);
      }
    });
    console.log('✅ Middleware created successfully');
    console.log('Middleware type:', typeof middleware);
    
    // Step 3: Test middleware with mock request
    console.log('\n3. Testing middleware with mock request...');
    
    const mockReq = {
      headers: {
        authorization: `Bearer ${testToken}`
      }
    };
    
    const mockRes = {
      status: (code) => {
        console.log(`📤 Response status: ${code}`);
        return mockRes;
      },
      json: (data) => {
        console.log('📤 Response data:', data);
        return mockRes;
      }
    };
    
    const mockNext = () => {
      console.log('✅ Next() called - middleware passed');
    };
    
    await middleware(mockReq, mockRes, mockNext);
    
    console.log('\n📋 Final request object:');
    console.log('- userId:', mockReq.userId);
    console.log('- user:', mockReq.user ? 'Present' : 'Missing');
    console.log('- accessToken:', mockReq.accessToken ? 'Present' : 'Missing');
    
  } catch (error) {
    console.error('❌ Error during middleware test:', error);
  }
}

// Run the debug
debugMiddleware().catch(console.error); 