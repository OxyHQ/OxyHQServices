# Troubleshooting Guide

This guide covers common issues when using OxyHQ Services zero-config authentication and how to resolve them.

## 🔧 Common Issues

### Frontend Issues

#### "useAuth must be used within an AuthProvider"

**Problem**: You're trying to use authentication hooks outside of the AuthProvider context.

**Solution**:
```tsx
// ❌ Wrong - hooks used outside provider
function App() {
  const { isAuthenticated } = useAuth(); // Error!
  return <div>App</div>;
}

// ✅ Correct - AuthProvider wraps the app
function App() {
  return (
    <AuthProvider baseURL="https://api.oxy.so">
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { isAuthenticated } = useAuth(); // Works!
  return <div>App</div>;
}
```

#### Authentication not persisting across app restarts

**Symptoms**: User gets logged out every time they refresh the page or restart the app.

**Common Causes**:
1. **React Native**: AsyncStorage not properly installed
2. **Web**: Local storage being cleared by browser
3. **Network**: API server not accessible during token validation

**Solutions**:

**For React Native**:
```bash
# Make sure AsyncStorage is installed
npm install @react-native-async-storage/async-storage

# For iOS (if using bare React Native)
cd ios && pod install
```

**For Web**:
```typescript
// Check if local storage is available
if (typeof Storage !== "undefined") {
  console.log("Local storage is available");
} else {
  console.error("Local storage is not supported");
}
```

**For both platforms**:
```typescript
// Debug token loading in development
<AuthProvider 
  baseURL="https://api.oxy.so"
  onDebugLog={(message) => console.log('[Auth Debug]', message)} // Add debug logging
>
  <App />
</AuthProvider>
```

#### Tokens not automatically refreshing

**Symptoms**: User gets logged out unexpectedly, even though they were recently active.

**Debug Steps**:
1. Check token expiration times in browser dev tools
2. Verify refresh token endpoint is working
3. Check network connectivity

**Solution**:
```typescript
// Check token status manually
const { getCurrentUser } = useAuth();

useEffect(() => {
  const checkTokenStatus = async () => {
    try {
      await getCurrentUser(); // This will trigger refresh if needed
    } catch (error) {
      console.error('Token refresh failed:', error);
    }
  };
  
  checkTokenStatus();
}, []);
```

#### Login/logout not updating UI immediately

**Symptoms**: Authentication state seems "stuck" - UI doesn't update after login/logout.

**Solution**:
```tsx
// Make sure you're using the auth state correctly
function LoginButton() {
  const { login, isLoading, error } = useAuth();
  
  const handleLogin = async () => {
    try {
      await login(username, password);
      // Don't manually redirect - let auth state changes handle it
    } catch (err) {
      // Error will be available in the error state
      console.error('Login failed:', err);
    }
  };
  
  return (
    <button onClick={handleLogin} disabled={isLoading}>
      {isLoading ? 'Logging in...' : 'Login'}
    </button>
  );
}
```

### Backend Issues

#### req.user is undefined even with authentication middleware

**Problem**: The `req.user` field is not populated despite using `authenticateRequest()`.

**Solutions**:

**Check middleware import**:
```typescript
// ❌ Wrong import
import { authMiddleware } from './old-auth';

// ✅ Correct import
import { authenticateRequest, OxyRequest } from '@oxyhq/api/middleware/zero-config-auth';
```

**Verify middleware usage**:
```typescript
// ❌ Wrong - missing middleware or wrong request type
app.get('/profile', (req: Request, res) => {
  console.log(req.user); // undefined
});

// ✅ Correct - middleware applied with correct types
app.get('/profile', authenticateRequest(), (req: OxyRequest, res) => {
  console.log(req.user); // Populated automatically
  res.json(req.user);
});
```

**Check JWT secrets**:
```bash
# Make sure these are set in your environment
ACCESS_TOKEN_SECRET=your-secret-here
REFRESH_TOKEN_SECRET=your-refresh-secret-here
```

#### "Invalid token" errors even with valid requests

**Problem**: Valid authentication tokens are being rejected.

**Debug Steps**:
1. Verify JWT secrets match between frontend and backend
2. Check token format and expiration
3. Examine middleware configuration

**Solution**:
```typescript
// Add debug logging to middleware
app.use(authenticateRequest({
  onError: (error, req, res) => {
    console.error('Auth error:', error);
    console.error('Token:', req.headers.authorization);
    
    res.status(error.statusCode).json({
      error: error.code,
      message: error.message
    });
  }
}));
```

#### CORS issues preventing authentication

**Symptoms**: Authentication works in development but fails in production with CORS errors.

**Solution**:
```typescript
// Ensure CORS is configured to allow credentials
app.use(cors({
  origin: ['https://yourapp.com', 'http://localhost:3000'],
  credentials: true, // Important!
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}));

// Make sure frontend sends credentials
const client = axios.create({
  baseURL: 'https://api.oxy.so',
  withCredentials: true // Important!
});
```

### Network & Connectivity Issues

#### "Network request failed" errors

**Common Causes**:
1. API server not running or accessible
2. Incorrect base URL configuration
3. Firewall blocking requests
4. SSL/TLS certificate issues

**Solutions**:

**Check API connectivity**:
```bash
# Test if API is accessible
curl -X GET https://api.oxy.so/health

# Test authentication endpoint
curl -X POST https://api.oxy.so/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}'
```

**Verify configuration**:
```typescript
// Make sure base URL is correct
<AuthProvider baseURL="https://api.oxy.so"> {/* Not http:// in production */}
  <App />
</AuthProvider>
```

#### Timeout errors during authentication

**Problem**: Requests are timing out, especially on slower networks.

**Solution**:
```typescript
// Increase timeout in AuthProvider configuration
<AuthProvider 
  baseURL="https://api.oxy.so"
  timeout={30000} // 30 seconds instead of default 15
>
  <App />
</AuthProvider>
```

### React Native Specific Issues

#### "Unable to resolve module" errors

**Problem**: React Native can't find required modules.

**Solutions**:

**For Expo**:
```bash
# Install required polyfills
npm install react-native-url-polyfill

# Add to your App.js/App.tsx at the very top
import 'react-native-url-polyfill/auto';
```

**For Bare React Native**:
```bash
# Additional setup may be required
npm install @react-native-async-storage/async-storage
cd ios && pod install # For iOS
```

#### AsyncStorage warnings in console

**Problem**: React Native shows warnings about AsyncStorage usage.

**Solution**:
```typescript
// The warnings are usually harmless, but you can suppress them
import { LogBox } from 'react-native';

LogBox.ignoreLogs([
  'AsyncStorage has been extracted',
]);
```

#### Authentication not working in production builds

**Problem**: Authentication works in development but fails in release builds.

**Common Causes**:
1. Bundle minification breaking code
2. Different network security policies
3. Missing environment variables

**Solutions**:
```typescript
// Add network security config for Android (android/app/src/main/res/xml/network_security_config.xml)
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">your-api-domain.com</domain>
    </domain-config>
</network-security-config>

// Reference it in android/app/src/main/AndroidManifest.xml
<application
    android:networkSecurityConfig="@xml/network_security_config">
```

## 🔍 Debugging Tools

### Enable Debug Mode

**Frontend**:
```typescript
// Add debug logging to auth provider
<AuthProvider 
  baseURL="https://api.oxy.so"
  debug={true} // Enable debug mode
>
  <App />
</AuthProvider>

// Or set in localStorage (web only)
localStorage.setItem('debug', '@oxy:auth');
```

**Backend**:
```bash
# Enable debug logging
export DEBUG=@oxy:auth
node server.js
```

### Check Authentication State

```typescript
function DebugAuth() {
  const auth = useAuth();
  
  useEffect(() => {
    console.log('Auth state:', {
      isAuthenticated: auth.isAuthenticated,
      isLoading: auth.isLoading,
      user: auth.user,
      error: auth.error,
    });
  }, [auth]);
  
  return <div>Check console for auth state</div>;
}
```

### Network Request Logging

```typescript
// Add request/response interceptors for debugging
const client = useOxyClient();

// Log all requests
client.interceptors.request.use(request => {
  console.log('Request:', request);
  return request;
});

// Log all responses
client.interceptors.response.use(
  response => {
    console.log('Response:', response);
    return response;
  },
  error => {
    console.error('Response error:', error);
    return Promise.reject(error);
  }
);
```

## 📞 Getting Help

If you're still experiencing issues after trying these solutions:

1. **Check the examples**: Look at working examples in the [examples directory](./examples/)
2. **Enable debug mode**: Use the debugging tools above to get more information
3. **GitHub Issues**: Search existing issues or create a new one at [github.com/oxyhq/services/issues](https://github.com/oxyhq/services/issues)
4. **Community Support**: Join our Discord at [discord.gg/oxy](https://discord.gg/oxy)

### When Creating a Bug Report

Please include:

1. **Environment information**:
   - React Native version (if applicable)
   - Node.js version
   - Package versions (`@oxyhq/services`, `@oxyhq/api`)
   - Platform (iOS, Android, Web)

2. **Code samples**:
   - Minimal reproducible example
   - Authentication setup code
   - Error messages and stack traces

3. **Network information**:
   - API endpoint URL
   - Browser dev tools network tab screenshots
   - Any CORS or connectivity errors

4. **Expected vs actual behavior**:
   - What you expected to happen
   - What actually happened
   - Steps to reproduce the issue

This helps us identify and fix issues much faster! 🚀