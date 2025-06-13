# Troubleshooting Guide

This guide helps you resolve common issues when using OxyHQServices.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Authentication Problems](#authentication-problems)
- [UI Component Issues](#ui-component-issues)
- [Network and API Issues](#network-and-api-issues)
- [Build and Deployment Issues](#build-and-deployment-issues)
- [Platform-Specific Issues](#platform-specific-issues)
- [Performance Issues](#performance-issues)
- [Debug Mode](#debug-mode)

## Installation Issues

### Peer Dependency Warnings

**Problem**: npm warns about missing or incompatible peer dependencies.

**Solution**:
```bash
# Check which dependencies are missing
npm ls

# Install missing peer dependencies
npm install react-native-gesture-handler react-native-reanimated react-native-safe-area-context react-native-svg

# For legacy dependency resolution
npm install --legacy-peer-deps
```

### React Native Version Conflicts

**Problem**: Compatibility issues between React Native versions.

**Solution**:
```bash
# Check React Native version
npx react-native --version

# Update to supported version (0.60+)
npx react-native upgrade

# Clear cache after upgrade
npx react-native start --reset-cache
```

### TypeScript Compilation Errors

**Problem**: TypeScript errors during compilation.

**Solution**:
```bash
# Update TypeScript to supported version
npm install --save-dev typescript@^5.3.0

# Check tsconfig.json configuration
{
  "compilerOptions": {
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "jsx": "react-jsx"
  }
}
```

## Authentication Problems

### Token Not Found

**Problem**: "Token not found" or "Unauthorized" errors.

**Symptoms**:
- API calls return 401 status
- User appears logged out after refresh

**Solution**:
```typescript
// Check if tokens are stored
const hasTokens = oxy.auth.hasStoredTokens();
console.log('Has stored tokens:', hasTokens);

// Verify token storage configuration
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  storage: 'localStorage' // or 'asyncStorage' for React Native
});

// Check token manually
const token = oxy.auth.getAccessToken();
console.log('Current token:', token);
```

### Token Expired

**Problem**: Authentication fails due to expired tokens.

**Solution**:
```typescript
// Enable automatic token refresh
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  autoRefresh: true
});

// Handle refresh manually
try {
  await oxy.auth.refresh();
} catch (error) {
  // Refresh failed, redirect to login
  await oxy.auth.clearTokens();
  // Redirect user to login page
}

// Listen for refresh events
oxy.events.on('refreshFailed', () => {
  // Handle refresh failure
  console.log('Token refresh failed, please log in again');
});
```

### Login Fails with Valid Credentials

**Problem**: Login fails even with correct username/password.

**Debugging steps**:
```typescript
// Enable debug mode
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  debug: true
});

// Check network connectivity
try {
  const response = await fetch('https://your-api.com/health');
  console.log('API server reachable:', response.ok);
} catch (error) {
  console.error('Network error:', error);
}

// Verify login endpoint
try {
  const result = await oxy.auth.login({
    email: 'user@example.com',
    password: 'password'
  });
  console.log('Login successful:', result);
} catch (error) {
  console.error('Login error:', error.message);
  console.error('Error details:', error);
}
```

### CORS Issues

**Problem**: Cross-Origin Request Blocked errors in browser.

**Solution**:
```javascript
// Server-side CORS configuration (Express.js)
const cors = require('cors');

app.use(cors({
  origin: ['http://localhost:3000', 'https://your-app.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

## UI Component Issues

### Components Not Rendering

**Problem**: OxyHQServices components don't appear or render incorrectly.

**Solution**:
```tsx
// Ensure OxyProvider wraps your app
import { OxyProvider } from '@oxyhq/services/ui';

function App() {
  return (
    <OxyProvider client={oxyClient}>
      {/* Your components here */}
    </OxyProvider>
  );
}

// Check for provider context
import { useOxyAuth } from '@oxyhq/services/ui';

function MyComponent() {
  try {
    const { user } = useOxyAuth();
    return <div>Welcome {user?.username}</div>;
  } catch (error) {
    console.error('OxyProvider not found:', error);
    return <div>Authentication provider missing</div>;
  }
}
```

### Font Loading Issues

**Problem**: Custom fonts not loading properly.

**Solution**:
```tsx
// Enable custom fonts in OxyProvider
<OxyProvider client={oxy} customFonts={true}>
  <App />
</OxyProvider>

// For React Native, ensure font files are linked
// Check src/assets/fonts/ directory exists

// For web projects, include font CSS
const fontCSS = `
  @font-face {
    font-family: 'Phudu';
    src: url('/path/to/Phudu-Regular.ttf') format('truetype');
  }
`;
```

### Styling Issues

**Problem**: Components don't match expected appearance.

**Solution**:
```tsx
// Check theme configuration
const customTheme = {
  colors: {
    primary: '#007AFF',
    background: '#FFFFFF',
    // ... other colors
  }
};

<OxyProvider client={oxy} theme={customTheme}>
  <App />
</OxyProvider>

// Verify platform-specific styles
import { Platform } from 'react-native';

const styles = StyleSheet.create({
  container: {
    ...Platform.select({
      ios: { paddingTop: 20 },
      android: { paddingTop: 0 },
      web: { padding: 16 }
    })
  }
});
```

### Avatar Not Displaying

**Problem**: User avatars show fallback instead of actual image.

**Solution**:
```tsx
// Check user object structure
const user = {
  username: 'john_doe',
  avatarUrl: 'https://example.com/avatar.jpg', // Must be 'avatarUrl'
  email: 'john@example.com'
};

// Debug avatar loading
<Avatar 
  user={user} 
  onPress={() => console.log('User object:', user)}
  fallbackIcon={<Text>?</Text>}
/>

// Check image URL validity
const testImageLoad = (url) => {
  const img = new Image();
  img.onload = () => console.log('Image loaded successfully');
  img.onerror = () => console.error('Image failed to load');
  img.src = url;
};
```

## Network and API Issues

### Connection Timeout

**Problem**: API requests timeout or fail to connect.

**Solution**:
```typescript
// Increase timeout
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  timeout: 10000 // 10 seconds
});

// Add retry logic
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  retryAttempts: 3
});

// Handle network errors
oxy.events.on('networkError', (error) => {
  console.error('Network error:', error);
  // Show user-friendly error message
});
```

### API Server Errors

**Problem**: Server returns 500 or other error status codes.

**Solution**:
```typescript
// Enable detailed error logging
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  debug: true
});

// Check server health
const checkServerHealth = async () => {
  try {
    const response = await fetch('https://your-api.com/health');
    console.log('Server status:', response.status);
    console.log('Server response:', await response.text());
  } catch (error) {
    console.error('Server unreachable:', error);
  }
};
```

### SSL Certificate Issues

**Problem**: SSL/TLS certificate errors in production.

**Solution**:
```typescript
// For development only - NOT for production
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  // Only in development environment
  ...(process.env.NODE_ENV === 'development' && {
    customHeaders: {
      'Accept': 'application/json'
    }
  })
});

// Check certificate validity
openssl s_client -connect your-api.com:443 -servername your-api.com
```

## Build and Deployment Issues

### Metro Bundle Errors (React Native)

**Problem**: Metro bundler fails to resolve modules.

**Solution**:
```bash
# Clear Metro cache
npx react-native start --reset-cache

# Clear all caches
rm -rf node_modules
npm install
npx react-native start --reset-cache
```

**Metro config** (metro.config.js):
```javascript
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.alias = {
  '@oxyhq/services': require.resolve('@oxyhq/services'),
};

module.exports = config;
```

### Webpack Build Errors (Web)

**Problem**: Webpack fails to build with OxyHQServices.

**Solution**:
```javascript
// webpack.config.js
module.exports = {
  resolve: {
    alias: {
      '@oxyhq/services': path.resolve(__dirname, 'node_modules/@oxyhq/services')
    },
    fallback: {
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "buffer": require.resolve("buffer")
    }
  }
};
```

### Production Build Issues

**Problem**: App works in development but fails in production.

**Solution**:
```typescript
// Environment-specific configuration
const config = {
  development: {
    baseURL: 'http://localhost:3001',
    debug: true
  },
  production: {
    baseURL: 'https://api.yourapp.com',
    debug: false,
    timeout: 10000
  }
};

const oxy = new OxyServices(config[process.env.NODE_ENV || 'development']);
```

## Platform-Specific Issues

### iOS Simulator Issues

**Problem**: App crashes or behaves differently on iOS simulator.

**Solution**:
```bash
# Reset iOS Simulator
Device → Erase All Content and Settings

# Clean iOS build
cd ios
xcodebuild clean
rm -rf build/
cd ..
npx react-native run-ios
```

### Android Build Errors

**Problem**: Android build fails or crashes.

**Solution**:
```bash
# Clean Android build
cd android
./gradlew clean
cd ..

# Check Android SDK
echo $ANDROID_HOME
echo $ANDROID_SDK_ROOT

# Rebuild
npx react-native run-android
```

### Web Bundle Size Issues

**Problem**: Large bundle size affecting performance.

**Solution**:
```typescript
// Use specific imports to reduce bundle size
import { OxyServices } from '@oxyhq/services/core';
import { Avatar } from '@oxyhq/services/ui';

// Instead of
import { OxyServices, Avatar } from '@oxyhq/services/full';
```

## Performance Issues

### Slow Authentication

**Problem**: Login/logout operations are slow.

**Solution**:
```typescript
// Enable token caching
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  autoRefresh: true,
  storage: 'localStorage' // Faster than 'memory'
});

// Implement loading states
const [loading, setLoading] = useState(false);

const handleLogin = async (credentials) => {
  setLoading(true);
  try {
    await oxy.auth.login(credentials);
  } finally {
    setLoading(false);
  }
};
```

### Memory Leaks

**Problem**: Memory usage increases over time.

**Solution**:
```typescript
// Cleanup event listeners
useEffect(() => {
  const handleAuthChange = (isAuthenticated) => {
    console.log('Auth state changed:', isAuthenticated);
  };

  oxy.events.on('authStateChanged', handleAuthChange);

  return () => {
    oxy.events.off('authStateChanged', handleAuthChange);
  };
}, []);

// Clear tokens on app exit
window.addEventListener('beforeunload', () => {
  oxy.auth.clearTokens();
});
```

## Debug Mode

### Enabling Debug Mode

```typescript
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  debug: true
});

// Or enable dynamically
oxy.updateConfig({ debug: true });
```

### Debug Information

Debug mode provides detailed logging for:
- HTTP requests and responses
- Token operations
- Authentication state changes
- Error details

### Custom Logging

```typescript
// Custom error handling
oxy.events.on('networkError', (error) => {
  console.group('Network Error Details');
  console.error('Error:', error.message);
  console.error('Status:', error.statusCode);
  console.error('URL:', error.config?.url);
  console.error('Headers:', error.config?.headers);
  console.groupEnd();
});

// Performance monitoring
const startTime = Date.now();
await oxy.auth.login(credentials);
console.log('Login took:', Date.now() - startTime, 'ms');
```

## Getting Additional Help

If you can't resolve your issue:

1. **Check the logs**: Enable debug mode and check console output
2. **Search existing issues**: Look for similar problems in [GitHub Issues](https://github.com/oxyhq/oxyhqservices/issues)
3. **Create a minimal reproduction**: Isolate the problem in a simple test case
4. **Provide environment details**: Include versions, platform, and configuration

### Issue Template

When reporting issues, include:

```
**Environment:**
- OxyHQServices version: 
- Platform: React/React Native/Node.js
- Version: 
- Operating System: 

**Description:**
Brief description of the issue

**Steps to Reproduce:**
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior:**
What should happen

**Actual Behavior:**
What actually happens

**Error Messages:**
```
Error messages or logs
```

**Code Sample:**
```typescript
// Minimal code that reproduces the issue
```
```

## Related Documentation

- [Installation Guide](./installation.md)
- [Core API Reference](./core-api.md)
- [UI Components Guide](./ui-components.md)
- [Quick Start Guide](./quick-start.md)
- [FAQ](./faq.md)