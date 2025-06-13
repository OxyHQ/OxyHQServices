# Frequently Asked Questions (FAQ)

This document answers common questions about OxyHQServices.

## Table of Contents

- [General Questions](#general-questions)
- [Installation and Setup](#installation-and-setup)
- [Authentication](#authentication)
- [UI Components](#ui-components)
- [Platform Support](#platform-support)
- [Performance](#performance)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## General Questions

### What is OxyHQServices?

OxyHQServices is a TypeScript client library for the Oxy API that provides authentication, user management, and UI components for React and React Native applications. It simplifies integrating authentication and user features into your apps.

### What platforms does OxyHQServices support?

- **Node.js** 16+ (for backend usage)
- **React** 16.8+ (for web applications)
- **React Native** 0.60+ (for mobile applications)
- **Express.js** (middleware support)

### Is OxyHQServices free to use?

Yes, OxyHQServices is open source and available under the MIT License. You can use it freely in both commercial and non-commercial projects.

### Do I need a separate Oxy API server?

Yes, OxyHQServices is a client library that connects to an Oxy API server. You'll need to set up the companion Oxy API server or use a hosted solution.

## Installation and Setup

### How do I install OxyHQServices?

```bash
npm install @oxyhq/services
```

For React Native, you'll also need peer dependencies:
```bash
npm install react-native-gesture-handler react-native-reanimated react-native-safe-area-context react-native-svg
```

### Can I use OxyHQServices with TypeScript?

Yes! OxyHQServices is built with TypeScript and provides full type definitions. It works seamlessly with TypeScript projects and provides excellent IntelliSense support.

### Do I need to configure anything after installation?

The minimal setup requires initializing the client and wrapping your app with the provider (for UI components):

```typescript
import { OxyServices } from '@oxyhq/services';
import { OxyProvider } from '@oxyhq/services/ui';

const oxy = new OxyServices({
  baseURL: 'https://your-api-server.com'
});

function App() {
  return (
    <OxyProvider client={oxy}>
      {/* Your app */}
    </OxyProvider>
  );
}
```

### Can I use only parts of the library?

Yes! The library provides multiple entry points:

```typescript
// Core services only (no UI)
import { OxyServices } from '@oxyhq/services';

// UI components only
import { OxyProvider, Avatar } from '@oxyhq/services/ui';

// Everything
import { OxyServices, OxyProvider } from '@oxyhq/services/full';
```

## Authentication

### How does authentication work?

OxyHQServices uses JWT (JSON Web Tokens) for authentication. When you log in, you receive an access token and refresh token. The access token is used for API requests, and the refresh token is used to get new access tokens when they expire.

### Are tokens automatically refreshed?

Yes, if you enable `autoRefresh: true` in the configuration. The library will automatically refresh expired tokens in the background.

```typescript
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  autoRefresh: true
});
```

### Where are tokens stored?

By default:
- **Web**: localStorage
- **React Native**: AsyncStorage
- **Node.js**: Memory

You can configure storage:
```typescript
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  storage: 'sessionStorage' // or 'memory', 'localStorage'
});
```

### How do I handle authentication in server-side rendering (SSR)?

For SSR, use memory storage and manually manage tokens:

```typescript
// Server-side
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  storage: 'memory'
});

// Set tokens from request cookies/headers
oxy.auth.setTokens(accessToken, refreshToken);
```

### Can I use OxyHQServices with multiple users simultaneously?

The library is designed for single-user authentication per client instance. For multiple users, create separate client instances or implement your own session management.

### How do I implement logout functionality?

```typescript
// Simple logout (clears local tokens)
await oxy.auth.logout();

// Logout all sessions (including other devices)
await oxy.sessions.logoutAllSessions();
```

## UI Components

### What UI components are included?

- **OxyProvider**: Authentication context provider
- **Avatar**: User avatar with fallback support
- **FollowButton**: Social follow/unfollow button
- **OxyLogo**: Brand logo component

More components may be added in future versions.

### Can I customize the appearance of components?

Yes! Components accept style props and respect your theme configuration:

```tsx
<Avatar 
  user={user} 
  size={60}
  style={{ borderRadius: 30, borderWidth: 2 }}
/>

// Or use custom theme
<OxyProvider client={oxy} theme={customTheme}>
  <App />
</OxyProvider>
```

### Do components work on both web and mobile?

Yes, all UI components are cross-platform and automatically adapt to the platform they're running on.

### Can I use my own authentication screens?

Absolutely! The UI components are optional. You can build completely custom authentication flows using just the core API:

```typescript
// Custom login form
const handleLogin = async (email, password) => {
  try {
    await oxy.auth.login({ email, password });
    // Handle success
  } catch (error) {
    // Handle error
  }
};
```

## Platform Support

### Does it work with Expo?

Yes! OxyHQServices works perfectly with Expo projects. Install the required peer dependencies using `expo install`.

### Can I use it in a Next.js project?

Yes, OxyHQServices works with Next.js. For SSR, make sure to handle token storage appropriately:

```typescript
// Use memory storage for SSR
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  storage: typeof window !== 'undefined' ? 'localStorage' : 'memory'
});
```

### Does it support React Native Web?

Yes, the components work with React Native Web projects.

### What about Electron apps?

OxyHQServices works in Electron apps. Use the web configuration for the renderer process.

## Performance

### Is OxyHQServices performant?

Yes, the library is optimized for performance:
- Minimal bundle size with tree-shaking support
- Efficient token caching
- Optimized network requests
- Lazy loading of components

### How can I reduce bundle size?

Use specific imports:
```typescript
// Good - only imports what you need
import { OxyServices } from '@oxyhq/services/core';

// Avoid - imports everything
import { OxyServices } from '@oxyhq/services/full';
```

### Does it cache API responses?

The library caches authentication tokens but not general API responses. You can implement your own caching layer if needed.

## Security

### Is OxyHQServices secure?

Yes, the library follows security best practices:
- JWT tokens with expiration
- Secure token storage
- HTTPS-only communication
- Device fingerprinting for session management

### How are tokens stored securely?

- **Web**: localStorage (consider HttpOnly cookies for enhanced security)
- **React Native**: AsyncStorage (encrypted storage available via plugins)
- **Node.js**: Memory (tokens not persisted)

### Can I use custom token storage?

Currently, you can choose from predefined storage options. Custom storage implementations may be added in future versions.

### How do I implement CSRF protection?

The library includes built-in CSRF token handling when used with the companion Oxy API server.

## Troubleshooting

### Why am I getting "OxyProvider not found" errors?

Make sure your components are wrapped with `OxyProvider`:

```tsx
// Correct
<OxyProvider client={oxy}>
  <MyComponent /> {/* Can use useOxyAuth here */}
</OxyProvider>

// Incorrect
<MyComponent /> {/* useOxyAuth will fail */}
```

### Why are my authentication tokens not persisting?

Check your storage configuration:
```typescript
// Make sure storage is set correctly
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  storage: 'localStorage' // or appropriate for your platform
});
```

### Why are network requests failing?

Common causes:
1. **CORS issues**: Configure your server's CORS policy
2. **Base URL**: Ensure the API server URL is correct
3. **Network connectivity**: Check if the server is reachable
4. **SSL/TLS**: Verify certificate validity in production

### How do I debug authentication issues?

Enable debug mode:
```typescript
const oxy = new OxyServices({
  baseURL: 'https://your-api.com',
  debug: true
});
```

This will log detailed information about requests, responses, and authentication events.

### Why are fonts not loading in my app?

Make sure custom fonts are enabled:
```tsx
<OxyProvider client={oxy} customFonts={true}>
  <App />
</OxyProvider>
```

For React Native, ensure font files are properly linked and the `src/assets/fonts/` directory exists.

## Common Patterns

### How do I check if a user is authenticated?

```typescript
// Using the hook (React/React Native)
const { isAuthenticated, user } = useOxyAuth();

// Using the client directly
const isAuthenticated = oxy.auth.isAuthenticated();
const userId = oxy.auth.getCurrentUserId();
```

### How do I handle authentication state changes?

```typescript
// Listen for state changes
oxy.events.on('authStateChanged', (isAuthenticated) => {
  console.log('User authentication changed:', isAuthenticated);
});

// React hook automatically handles state changes
const { isAuthenticated } = useOxyAuth();
```

### How do I implement protected routes?

```typescript
// React example
function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useOxyAuth();
  
  if (loading) return <LoadingSpinner />;
  if (!isAuthenticated) return <LoginScreen />;
  
  return children;
}

// Express.js example
app.use('/api/protected', oxy.middleware());
```

### How do I handle errors gracefully?

```typescript
import { OxyAuthError, OxyNetworkError } from '@oxyhq/services';

try {
  await oxy.auth.login(credentials);
} catch (error) {
  if (error instanceof OxyAuthError) {
    // Handle authentication-specific errors
    console.error('Login failed:', error.message);
  } else if (error instanceof OxyNetworkError) {
    // Handle network-related errors
    console.error('Network error:', error.message);
  } else {
    // Handle unexpected errors
    console.error('Unexpected error:', error);
  }
}
```

## Migration and Updates

### How do I migrate from version X to Y?

Check the [Migration Guide](../MIGRATION_GUIDE.md) for version-specific migration instructions.

### How often is OxyHQServices updated?

The library follows semantic versioning. Check the [Changelog](../CHANGELOG.md) for recent updates and the [GitHub repository](https://github.com/oxyhq/oxyhqservices) for the latest releases.

### Are there breaking changes between versions?

Breaking changes only occur in major version updates (e.g., 1.x.x to 2.x.x). Minor and patch versions maintain backward compatibility.

## Getting Help

### Where can I get help?

1. **Documentation**: Check the [documentation](./README.md)
2. **Troubleshooting**: See the [troubleshooting guide](./troubleshooting.md)
3. **GitHub Issues**: Search or create issues on [GitHub](https://github.com/oxyhq/oxyhqservices/issues)
4. **Examples**: Look at the [examples](./examples/) directory

### How do I report bugs?

Create an issue on GitHub with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (platform, versions, etc.)
- Minimal code example

### Can I contribute to OxyHQServices?

Yes! Contributions are welcome. See the [Contributing Guide](../CONTRIBUTING.md) for details on how to contribute.

### Is there a community Discord/Slack?

Check the [project homepage](https://oxy.so) for community links and discussion forums.

## Related Documentation

- [Installation Guide](./installation.md)
- [Quick Start Guide](./quick-start.md)
- [Core API Reference](./core-api.md)
- [UI Components Guide](./ui-components.md)
- [Troubleshooting Guide](./troubleshooting.md)
- [Contributing Guide](../CONTRIBUTING.md)