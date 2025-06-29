# Refactored Authentication System

## Overview

The authentication system has been refactored to centralize logic and provide consistent, reliable behavior. The main improvements include:

1. **Simplified useAuthFetch** - Removed excessive debugging, improved error handling
2. **API URL configuration** - Easy to set and update the main API URL
3. **Better integration with useOxy** - Leverages existing infrastructure
4. **Production-ready** - Clean, professional implementation

## Frontend Usage (Zero Config)

### Basic Setup

```typescript
import { OxyProvider, useAuthFetch } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services/core';

// Create OxyServices instance
const oxyServices = new OxyServices({
  baseURL: 'https://your-api.com'  // Configure your API URL
});

// Wrap your app with the provider
function App() {
  return (
    <OxyProvider oxyServices={oxyServices}>
      <YourApp />
    </OxyProvider>
  );
}
```

### Using useAuthFetch in Components

```typescript
import { useAuthFetch } from '@oxyhq/services/ui';

function UserProfile() {
  const authFetch = useAuthFetch();

  const fetchProfile = async () => {
    try {
      // Simple authenticated GET request
      const profile = await authFetch.get('/api/users/me');
      console.log('User profile:', profile);
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    }
  };

  const updateProfile = async (data) => {
    try {
      // Simple authenticated POST request
      const result = await authFetch.post('/api/users/me', data);
      console.log('Profile updated:', result);
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  };

  return (
    <div>
      <h1>Welcome {authFetch.user?.username}</h1>
      <p>Authenticated: {authFetch.isAuthenticated ? 'Yes' : 'No'}</p>
      <button onClick={fetchProfile}>Load Profile</button>
      <button onClick={() => updateProfile({ name: 'New Name' })}>Update Profile</button>
    </div>
  );
}
```

### Dynamic API URL Configuration

```typescript
function ApiSettings() {
  const authFetch = useAuthFetch();

  const changeApiUrl = () => {
    // Update API URL at runtime
    authFetch.setApiUrl('https://new-api-server.com');
  };

  return (
    <button onClick={changeApiUrl}>
      Switch to Production API
    </button>
  );
}
```

## Backend Usage (Express.js)

### Using Authentication Middleware

```typescript
import express from 'express';
import { OxyServices } from '@oxyhq/services/core';

const app = express();
const oxyServices = new OxyServices({
  baseURL: process.env.API_URL || 'http://localhost:3001'
});

// Use the built-in middleware
const authenticateToken = oxyServices.createAuthenticateTokenMiddleware({
  loadFullUser: true,  // Load complete user profile
  onError: (error) => {
    console.log('Auth error:', error);
  }
});

// Protected route
app.get('/api/protected', authenticateToken, (req, res) => {
  res.json({
    message: 'Access granted',
    user: req.user,
    userId: req.userId
  });
});
```

### Manual Token Validation

```typescript
import { OxyServices } from '@oxyhq/services/core';

const oxyServices = new OxyServices({
  baseURL: process.env.API_URL
});

async function validateApiKey(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  const result = await oxyServices.authenticateToken(token);
  
  if (result.valid) {
    req.user = result.user;
    req.userId = result.userId;
    next();
  } else {
    res.status(401).json({ error: result.error });
  }
}
```

## Key Features

### 1. Zero Configuration
- Just wrap with `OxyProvider` on frontend
- Use `createAuthenticateTokenMiddleware()` on backend
- No additional setup required

### 2. Automatic Token Management
- Automatic token refresh on expiry
- Handles session-based and JWT authentication
- Graceful fallback when tokens are unavailable

### 3. Error Handling
- Consistent error messages across the system
- Proper HTTP status codes
- Clear error types for different scenarios

### 4. Professional & Production Ready
- Clean, maintainable code
- Proper TypeScript support
- Comprehensive error handling
- No debug logging in production

## Migration from Previous Version

### Before (Manual Token Management)
```typescript
const [token, setToken] = useState(localStorage.getItem('token'));

const apiCall = async () => {
  let response = await fetch('/api/data', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (response.status === 401) {
    // Manual token refresh logic...
  }
  
  return response.json();
};
```

### After (Zero Config)
```typescript
const authFetch = useAuthFetch();

const apiCall = async () => {
  return authFetch.get('/api/data');
  // That's it! All token management is automatic
};
```

## Testing

The refactored system includes comprehensive tests and can be tested using the standard testing patterns:

```typescript
import { OxyServices } from '@oxyhq/services/core';

test('should configure API URL', () => {
  const oxyServices = new OxyServices({ baseURL: 'https://api.test.com' });
  expect(oxyServices.getBaseURL()).toBe('https://api.test.com');
  
  oxyServices.setBaseURL('https://new-api.test.com');
  expect(oxyServices.getBaseURL()).toBe('https://new-api.test.com');
});
```