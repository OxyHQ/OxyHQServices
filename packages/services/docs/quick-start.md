# Quick Start Guide

Get started with OxyHQServices in under 5 minutes.

## Installation

```bash
npm install @oxyhq/services
```

## Basic Authentication

### 1. Initialize Client

```typescript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: 'http://localhost:3001' // Your Oxy API URL
});
```

### 2. Authenticate User

```typescript
try {
  // Login with credentials
  const response = await oxy.auth.login({
    username: 'testuser',
    password: 'password123'
  });
  
  console.log('Login successful!');
  console.log('User:', response.user);
  console.log('Access Token:', response.accessToken);
} catch (error) {
  console.error('Login failed:', error.message);
}
```

### 3. Make Authenticated Requests

```typescript
// Get current user (requires authentication)
const user = await oxy.users.getCurrentUser();
console.log('Current user:', user);

// Check if user is authenticated
if (oxy.auth.isAuthenticated()) {
  console.log('User is logged in');
} else {
  console.log('User is not logged in');
}
```

## React/React Native Integration

### 1. Setup Provider

```typescript
import React from 'react';
import { OxyProvider } from '@oxyhq/services/ui';

function App() {
  return (
    <OxyProvider config={{ baseURL: 'http://localhost:3001' }}>
      <MyApp />
    </OxyProvider>
  );
}
```

### 2. Use Authentication Hook

```typescript
import React from 'react';
import { useOxy } from '@oxyhq/services/ui';

function MyApp() {
  const { user, login, logout, isLoading } = useOxy();

  const handleLogin = async () => {
    try {
      await login('testuser', 'password123');
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      {user ? (
        <div>
          <h1>Welcome, {user.username}!</h1>
          <button onClick={logout}>Logout</button>
        </div>
      ) : (
        <div>
          <h1>Please log in</h1>
          <button onClick={handleLogin}>Login</button>
        </div>
      )}
    </div>
  );
}

export default App;
```

### 3. Use UI Components

```typescript
import React from 'react';
import { Avatar, FollowButton } from '@oxyhq/services/ui';

function UserProfile({ userId }) {
  return (
    <div>
      <Avatar userId={userId} size={64} />
      <FollowButton targetUserId={userId} />
    </div>
  );
}
```

## Express.js Backend Integration

### 1. Setup Middleware

```typescript
import express from 'express';
import { OxyServices } from '@oxyhq/services';

const app = express();
const oxy = new OxyServices({
  baseURL: 'http://localhost:3001'
});

// Create authentication middleware
const authenticateToken = oxy.middleware.authenticate({
  loadUser: true // Load full user data
});

// Use on protected routes
app.get('/api/protected', authenticateToken, (req, res) => {
  // req.user contains authenticated user data
  // req.userId contains user ID
  // req.accessToken contains the validated token
  
  res.json({
    message: 'Access granted',
    user: req.user
  });
});
```

### 2. Manual Token Validation

```typescript
// Validate token manually
async function validateUserToken(token) {
  try {
    const result = await oxy.auth.validateToken(token);
    if (result.valid) {
      return result.user;
    }
    return null;
  } catch (error) {
    console.error('Token validation failed:', error);
    return null;
  }
}

// Use in route handlers
app.get('/api/user-data', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = await validateUserToken(token);
  
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({ user });
});
```

## Session Management

### 1. Device-Based Sessions

```typescript
// Create session with device fingerprint
const session = await oxy.sessions.createSession({
  username: 'testuser',
  password: 'password123',
  deviceFingerprint: 'unique-device-id',
  deviceInfo: {
    userAgent: navigator.userAgent,
    platform: 'web'
  }
});

console.log('Session created:', session.sessionId);
```

### 2. Manage Multiple Sessions

```typescript
// Get all user sessions
const sessions = await oxy.sessions.getUserSessions();
console.log('Active sessions:', sessions);

// Logout from specific session
await oxy.sessions.logoutSession('session-id-here');

// Logout from all other sessions
await oxy.sessions.logoutAllOtherSessions();
```

## Error Handling

```typescript
import { OxyAuthError, OxyNetworkError } from '@oxyhq/services';

try {
  await oxy.auth.login({ username: 'test', password: 'wrong' });
} catch (error) {
  if (error instanceof OxyAuthError) {
    console.error('Authentication error:', error.message);
  } else if (error instanceof OxyNetworkError) {
    console.error('Network error:', error.message);
  } else {
    console.error('Unknown error:', error);
  }
}
```

## Configuration Options

```typescript
const oxy = new OxyServices({
  baseURL: 'http://localhost:3001',     // Required: API server URL
  timeout: 5000,                       // Request timeout (ms)
  autoRefresh: true,                   // Auto-refresh expired tokens
  storage: 'localStorage',             // Token storage: 'localStorage' | 'sessionStorage' | 'memory'
  retryAttempts: 3,                    // Retry failed requests
  debug: true                          // Enable debug logging
});
```

## Common Patterns

### Auto-Login on App Start

```typescript
// Check for existing tokens on app initialization
async function initializeAuth() {
  if (oxy.auth.hasStoredTokens()) {
    try {
      const isValid = await oxy.auth.validate();
      if (isValid) {
        console.log('User automatically logged in');
        return await oxy.users.getCurrentUser();
      }
    } catch (error) {
      console.log('Stored tokens invalid, clearing...');
      oxy.auth.clearTokens();
    }
  }
  return null;
}

// Use in your app initialization
initializeAuth().then(user => {
  if (user) {
    // Update UI to show logged in state
  }
});
```

### Token Refresh Handling

```typescript
// The client automatically handles token refresh,
// but you can listen for refresh events
oxy.events.on('tokenRefreshed', (newTokens) => {
  console.log('Tokens refreshed:', newTokens);
});

oxy.events.on('refreshFailed', (error) => {
  console.log('Token refresh failed, please login again');
  // Redirect to login screen
});
```

## Next Steps

- **[Core API Reference](./core-api.md)** - Complete API documentation
- **[UI Components Guide](./ui-components.md)** - React/RN component usage
- **[Express Middleware](./express-middleware.md)** - Backend integration
- **[Examples](./examples/)** - More code examples
- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions

## Example Projects

Check out these example implementations:

- **my-app** - React Native app with authentication
- **my-app-backend** - Express.js server with middleware
- **Integration examples** - Various use cases and patterns
