# Core API Reference

Complete reference for the OxyHQServices core authentication client.

## OxyServices Class

The main client class for interacting with the Oxy API.

### Constructor

```typescript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices(options);
```

#### Options

```typescript
interface OxyServicesOptions {
  baseURL: string;          // Required: Oxy API URL
  timeout?: number;         // Request timeout (default: 5000ms)
  autoRefresh?: boolean;    // Auto-refresh tokens (default: true)
  storage?: StorageType;    // Token storage method
  retryAttempts?: number;   // Failed request retries (default: 3)
  debug?: boolean;          // Enable debug logging (default: false)
}

type StorageType = 'localStorage' | 'sessionStorage' | 'memory';
```

### Authentication Methods

#### login(credentials)

Authenticate user with credentials.

```typescript
interface LoginCredentials {
  username: string;     // Username or email
  password: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

const response = await oxy.auth.login({
  username: 'testuser',
  password: 'password123'
});

console.log('User:', response.user);
console.log('Token:', response.accessToken);
```

#### logout()

Logout current user and clear stored tokens.

```typescript
await oxy.auth.logout();
// Tokens are cleared and user is logged out
```

#### validate()

Validate current access token with the server.

```typescript
const isValid = await oxy.auth.validate();
if (isValid) {
  console.log('Token is valid');
} else {
  console.log('Token is invalid or expired');
}
```

#### refresh()

Manually refresh the access token using the stored refresh token.

```typescript
try {
  const newToken = await oxy.auth.refresh();
  console.log('New access token:', newToken);
} catch (error) {
  console.log('Refresh failed, please login again');
}
```

#### setTokens(accessToken, refreshToken)

Set authentication tokens manually.

```typescript
oxy.auth.setTokens('access_token_here', 'refresh_token_here');
```

#### clearTokens()

Clear all stored authentication tokens.

```typescript
oxy.auth.clearTokens();
// User will need to login again
```

#### getAccessToken()

Get the current access token.

```typescript
const token = oxy.auth.getAccessToken();
if (token) {
  console.log('Current access token:', token);
}
```

#### hasStoredTokens()

Check if tokens are stored (useful for auto-login).

```typescript
if (oxy.auth.hasStoredTokens()) {
  // Try to validate existing tokens
  const isValid = await oxy.auth.validate();
  if (isValid) {
    console.log('User automatically logged in');
  }
}
```

#### Authentication Status (UI Components)

For UI components, use the context's `isAuthenticated` instead of checking service methods:

```typescript
import { useOxy } from '@oxyhq/services/ui';

function MyComponent() {
  const { isAuthenticated, user } = useOxy();
  
  if (isAuthenticated) {
    return <div>Welcome {user?.username}!</div>;
  } else {
    return <div>Please sign in</div>;
  }
}
```

#### getCurrentUserId()

Get the current user's ID from the stored token.

```typescript
const userId = oxy.auth.getCurrentUserId();
if (userId) {
  console.log('Current user ID:', userId);
}
```

### User Management Methods

#### getCurrentUser()

Get the current user's profile data.

```typescript
try {
  const user = await oxy.users.getCurrentUser();
  console.log('User profile:', user);
} catch (error) {
  console.log('Failed to get user profile');
}
```

#### updateProfile(data)

Update the current user's profile.

```typescript
interface ProfileUpdate {
  email?: string;
  preferences?: {
    theme?: 'light' | 'dark';
    language?: string;
  };
}

const updatedUser = await oxy.users.updateProfile({
  email: 'newemail@example.com',
  preferences: {
    theme: 'dark',
    language: 'en'
  }
});

console.log('Updated user:', updatedUser);
```

### Session Management Methods

#### createSession(options)

Create a new device-based session.

```typescript
interface SessionOptions {
  username: string;
  password: string;
  deviceFingerprint: string;
  deviceInfo?: {
    userAgent?: string;
    platform?: string;
    deviceType?: 'mobile' | 'desktop' | 'tablet';
  };
}

const session = await oxy.sessions.createSession({
  username: 'testuser',
  password: 'password123',
  deviceFingerprint: 'unique-device-id',
  deviceInfo: {
    userAgent: navigator.userAgent,
    platform: 'web',
    deviceType: 'desktop'
  }
});

console.log('Session created:', session.sessionId);
```

#### getUserSessions()

Get all active sessions for the current user.

```typescript
const sessions = await oxy.sessions.getUserSessions();

sessions.forEach(session => {
  console.log('Session ID:', session.sessionId);
  console.log('Device:', session.deviceInfo.platform);
  console.log('Last active:', session.deviceInfo.lastActive);
  console.log('Is current:', session.isCurrent);
});
```

#### logoutSession(sessionId)

Logout from a specific session.

```typescript
await oxy.sessions.logoutSession('session-id-here');
console.log('Session logged out');
```

#### logoutAllOtherSessions()

Logout from all sessions except the current one.

```typescript
const result = await oxy.sessions.logoutAllOtherSessions();
console.log(`Logged out ${result.loggedOutSessions} sessions`);
```

### HTTP Client Methods

#### request(endpoint, options)

Make a raw HTTP request to the API.

```typescript
const response = await oxy.request('/users/me', {
  method: 'GET',
  headers: {
    'Custom-Header': 'value'
  }
});

const data = await response.json();
```

#### get(endpoint, options)

Make a GET request.

```typescript
const data = await oxy.get('/users/me');
```

#### post(endpoint, data, options)

Make a POST request.

```typescript
const response = await oxy.post('/users/update', {
  email: 'new@example.com'
});
```

#### put(endpoint, data, options)

Make a PUT request.

```typescript
const response = await oxy.put('/users/profile', profileData);
```

#### delete(endpoint, options)

Make a DELETE request.

```typescript
await oxy.delete('/sessions/session-id');
```

## Configuration Methods

### updateConfig(newConfig)

Update client configuration after initialization.

```typescript
oxy.updateConfig({
  timeout: 10000,
  debug: true
});
```

### getConfig()

Get current client configuration.

```typescript
const config = oxy.getConfig();
console.log('Current config:', config);
```

## Event System

The client emits events for various authentication states.

```typescript
// Listen for token refresh
oxy.events.on('tokenRefreshed', (tokens) => {
  console.log('Tokens refreshed:', tokens);
});

// Listen for refresh failures
oxy.events.on('refreshFailed', (error) => {
  console.log('Token refresh failed:', error);
  // Redirect to login
});

// Listen for authentication changes
oxy.events.on('authStateChanged', (isAuthenticated) => {
  console.log('Auth state changed:', isAuthenticated);
});

// Listen for network errors
oxy.events.on('networkError', (error) => {
  console.log('Network error occurred:', error);
});
```

## Error Handling

### Error Types

```typescript
import { 
  OxyAuthError, 
  OxyNetworkError, 
  OxyValidationError 
} from '@oxyhq/services';

try {
  await oxy.auth.login({ username: 'test', password: 'wrong' });
} catch (error) {
  if (error instanceof OxyAuthError) {
    console.error('Authentication failed:', error.message);
  } else if (error instanceof OxyNetworkError) {
    console.error('Network error:', error.message);
  } else if (error instanceof OxyValidationError) {
    console.error('Validation error:', error.message);
  }
}
```

### Error Codes

| Code | Type | Description |
|------|------|-------------|
| `AUTH_FAILED` | OxyAuthError | Invalid credentials |
| `TOKEN_EXPIRED` | OxyAuthError | Access token expired |
| `TOKEN_INVALID` | OxyAuthError | Malformed token |
| `REFRESH_FAILED` | OxyAuthError | Refresh token invalid |
| `NETWORK_ERROR` | OxyNetworkError | Request failed |
| `TIMEOUT_ERROR` | OxyNetworkError | Request timeout |
| `VALIDATION_ERROR` | OxyValidationError | Invalid input data |

## TypeScript Types

### Core Interfaces

```typescript
interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  preferences: {
    theme: 'light' | 'dark';
    language: string;
  };
}

interface SessionData {
  sessionId: string;
  deviceInfo: {
    userAgent: string;
    platform: string;
    deviceType: string;
    lastActive: string;
  };
  isActive: boolean;
  isCurrent: boolean;
  createdAt: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

interface SessionResponse {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  user: User;
}
```

### Configuration Types

```typescript
interface OxyServicesOptions {
  baseURL: string;
  timeout?: number;
  autoRefresh?: boolean;
  storage?: 'localStorage' | 'sessionStorage' | 'memory';
  retryAttempts?: number;
  debug?: boolean;
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}
```

## Usage Patterns

### Auto-Login on App Start

```typescript
async function initializeAuth() {
  if (oxy.auth.hasStoredTokens()) {
    try {
      const isValid = await oxy.auth.validate();
      if (isValid) {
        const user = await oxy.users.getCurrentUser();
        return user;
      }
    } catch (error) {
      oxy.auth.clearTokens();
    }
  }
  return null;
}

// Use in your app initialization
const user = await initializeAuth();
if (user) {
  console.log('User auto-logged in:', user.username);
}
```

### Retry with Token Refresh

```typescript
async function apiCallWithRetry(apiCall) {
  try {
    return await apiCall();
  } catch (error) {
    if (error instanceof OxyAuthError && error.code === 'TOKEN_EXPIRED') {
      try {
        await oxy.auth.refresh();
        return await apiCall();
      } catch (refreshError) {
        // Refresh failed, redirect to login
        throw new Error('Please login again');
      }
    }
    throw error;
  }
}

// Usage
const user = await apiCallWithRetry(() => oxy.users.getCurrentUser());
```

### Multi-Environment Configuration

```typescript
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

const oxy = new OxyServices(config[process.env.NODE_ENV]);
```

This comprehensive API reference covers all available methods and patterns for using the OxyHQServices core client library.
