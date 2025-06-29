# 🔐 Refactored Authentication System

## Overview

The authentication system has been completely refactored to provide a centralized, reliable, and production-ready solution for the Oxy ecosystem. The new system offers:

- **Zero-config setup** - Just a Provider for frontend, middleware for backend
- **Centralized logic** - All authentication logic consolidated 
- **Automatic token management** - Handles JWT and session-based authentication
- **Runtime API configuration** - Change API URLs dynamically
- **Production-ready** - Clean, professional implementation without debug logging
- **Full TypeScript support** - Complete type safety

## 🚀 Quick Start

### Frontend (React/React Native)

```typescript
import { OxyProvider, useAuthFetch } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services/core';

// 1. Create OxyServices instance
const oxyServices = new OxyServices({
  baseURL: 'https://your-api.com'
});

// 2. Wrap your app
function App() {
  return (
    <OxyProvider oxyServices={oxyServices}>
      <YourApp />
    </OxyProvider>
  );
}

// 3. Use in components
function UserProfile() {
  const authFetch = useAuthFetch();
  
  const loadProfile = () => authFetch.get('/api/users/me');
  const updateProfile = (data) => authFetch.post('/api/users/me', data);
  
  return (
    <div>
      <p>Authenticated: {authFetch.isAuthenticated ? 'Yes' : 'No'}</p>
      <p>User: {authFetch.user?.username}</p>
      <button onClick={loadProfile}>Load Profile</button>
    </div>
  );
}
```

### Backend (Express.js)

```typescript
import express from 'express';
import { OxyServices } from '@oxyhq/services/core';

const app = express();

// 1. Create OxyServices instance
const oxyServices = new OxyServices({
  baseURL: process.env.API_URL || 'http://localhost:3001'
});

// 2. Create authentication middleware
const authenticateToken = oxyServices.createAuthenticateTokenMiddleware({
  loadFullUser: true
});

// 3. Use on protected routes
app.get('/api/protected', authenticateToken, (req, res) => {
  res.json({
    message: 'Access granted',
    user: req.user,
    userId: req.userId
  });
});
```

## 📚 Detailed Usage

### useAuthFetch Hook

The `useAuthFetch` hook provides a drop-in replacement for the native `fetch` API with automatic authentication:

```typescript
const authFetch = useAuthFetch();

// Simple GET request
const data = await authFetch.get('/api/users');

// POST with data
const result = await authFetch.post('/api/users', {
  name: 'John Doe',
  email: 'john@example.com'
});

// PUT request
const updated = await authFetch.put('/api/users/123', { name: 'Jane Doe' });

// DELETE request
await authFetch.delete('/api/users/123');

// Raw fetch with custom options
const response = await authFetch('/api/custom', {
  method: 'PATCH',
  headers: { 'Custom-Header': 'value' }
});
```

### API Configuration

#### Set API URL at Runtime

```typescript
const authFetch = useAuthFetch();

// Switch between environments
authFetch.setApiUrl('https://dev-api.example.com');   // Development
authFetch.setApiUrl('https://api.example.com');       // Production
authFetch.setApiUrl('http://localhost:3001');         // Local
```

#### Authentication Status

```typescript
const authFetch = useAuthFetch();

console.log('Authenticated:', authFetch.isAuthenticated);
console.log('Current user:', authFetch.user);

// Login/logout
await authFetch.login('username', 'password');
await authFetch.logout();
await authFetch.signUp('username', 'email', 'password');
```

### Backend Middleware

#### Basic Usage

```typescript
const oxyServices = new OxyServices({ baseURL: 'https://api.example.com' });

// Create middleware with default options
const auth = oxyServices.createAuthenticateTokenMiddleware();

app.get('/api/protected', auth, (req, res) => {
  // req.user contains full user object
  // req.userId contains user ID
  res.json({ user: req.user });
});
```

#### Custom Configuration

```typescript
const auth = oxyServices.createAuthenticateTokenMiddleware({
  loadFullUser: false,  // Only load user ID (faster)
  onError: (error) => {
    console.log('Auth error:', error.message);
    // Custom error logging/handling
  }
});
```

#### Manual Token Validation

```typescript
app.get('/api/custom-auth', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  const result = await oxyServices.authenticateToken(token);
  
  if (result.valid) {
    res.json({ user: result.user, userId: result.userId });
  } else {
    res.status(401).json({ error: result.error });
  }
});
```

## 🔧 Advanced Features

### Custom Hooks

Create domain-specific API hooks:

```typescript
function useUserAPI() {
  const authFetch = useAuthFetch();
  
  return {
    getProfile: () => authFetch.get('/api/users/me'),
    updateProfile: (data) => authFetch.put('/api/users/me', data),
    uploadAvatar: (file) => authFetch.post('/api/users/me/avatar', { file }),
    changePassword: (oldPass, newPass) => authFetch.post('/api/users/me/password', {
      oldPassword: oldPass,
      newPassword: newPass
    })
  };
}
```

### Error Handling

```typescript
try {
  const data = await authFetch.get('/api/protected');
} catch (error) {
  if (error.status === 401) {
    // User needs to authenticate
    console.log('Please log in');
  } else if (error.status === 403) {
    // User doesn't have permission
    console.log('Access denied');
  } else {
    // Other error
    console.error('API error:', error.message);
  }
}
```

### React Native Integration

```typescript
import { OxyProvider, useAuthFetch } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services/core';

function ReactNativeApp() {
  const oxyServices = new OxyServices({
    baseURL: 'https://api.example.com'
  });

  return (
    <OxyProvider oxyServices={oxyServices}>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </OxyProvider>
  );
}

function ProfileScreen() {
  const authFetch = useAuthFetch();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (authFetch.isAuthenticated) {
      authFetch.get('/api/users/me').then(setProfile);
    }
  }, [authFetch.isAuthenticated]);

  return (
    <View>
      <Text>Welcome {profile?.username}!</Text>
    </View>
  );
}
```

## 🧪 Testing

### Frontend Testing

```typescript
import { render, screen } from '@testing-library/react';
import { OxyProvider } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services/core';

test('renders authenticated user profile', () => {
  const oxyServices = new OxyServices({
    baseURL: 'https://api.test.com'
  });
  
  render(
    <OxyProvider oxyServices={oxyServices}>
      <UserProfile />
    </OxyProvider>
  );
  
  // Test authenticated state
});
```

### Backend Testing

```typescript
import { OxyServices } from '@oxyhq/services/core';

test('authenticates valid tokens', async () => {
  const oxyServices = new OxyServices({
    baseURL: 'https://api.test.com'
  });
  
  const result = await oxyServices.authenticateToken('valid-jwt-token');
  
  expect(result.valid).toBe(true);
  expect(result.user).toBeDefined();
  expect(result.userId).toBeDefined();
});

test('rejects invalid tokens', async () => {
  const oxyServices = new OxyServices({
    baseURL: 'https://api.test.com'
  });
  
  const result = await oxyServices.authenticateToken('invalid-token');
  
  expect(result.valid).toBe(false);
  expect(result.error).toBeTruthy();
});
```

## 📋 Migration Guide

### From Previous useAuthFetch

#### Before
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

#### After
```typescript
const authFetch = useAuthFetch();

const apiCall = async () => {
  return authFetch.get('/api/data');
  // That's it! All token management is automatic
};
```

### From Manual Authentication

#### Before
```typescript
app.get('/api/protected', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token' });
  }
  
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    req.userId = decoded.id;
    // Continue with route logic...
  });
});
```

#### After
```typescript
const auth = oxyServices.createAuthenticateTokenMiddleware();

app.get('/api/protected', auth, (req, res) => {
  // req.user and req.userId are automatically available
  res.json({ user: req.user });
});
```

## 🔗 API Reference

### useAuthFetch Hook

| Method | Description | Returns |
|--------|-------------|---------|
| `authFetch(url, options?)` | Main fetch function | `Promise<Response>` |
| `authFetch.get(endpoint, options?)` | GET request | `Promise<any>` |
| `authFetch.post(endpoint, data?, options?)` | POST request | `Promise<any>` |
| `authFetch.put(endpoint, data?, options?)` | PUT request | `Promise<any>` |
| `authFetch.delete(endpoint, options?)` | DELETE request | `Promise<any>` |
| `authFetch.setApiUrl(url)` | Update API URL | `void` |
| `authFetch.login(username, password)` | Login user | `Promise<User>` |
| `authFetch.logout()` | Logout user | `Promise<void>` |
| `authFetch.signUp(username, email, password)` | Register user | `Promise<User>` |

### OxyServices Core

| Method | Description | Returns |
|--------|-------------|---------|
| `getBaseURL()` | Get current API URL | `string` |
| `setBaseURL(url)` | Set API URL | `void` |
| `createAuthenticateTokenMiddleware(options?)` | Create Express middleware | `Function` |
| `authenticateToken(token)` | Validate token | `Promise<ValidationResult>` |
| `getAccessToken()` | Get current access token | `string \| null` |
| `setTokens(accessToken, refreshToken)` | Set authentication tokens | `void` |
| `clearTokens()` | Clear all tokens | `void` |

## ✅ Benefits

- **Simplified Development**: Zero-config setup reduces boilerplate
- **Consistent Behavior**: Centralized logic ensures reliability
- **Production Ready**: Professional implementation without debug noise
- **TypeScript Support**: Full type safety across the application
- **Automatic Token Management**: Handles refresh tokens transparently
- **Flexible Configuration**: Runtime API URL changes
- **Seamless Integration**: Works with existing Oxy ecosystem
- **Comprehensive Testing**: Built-in test utilities and examples

## 🤝 Contributing

When contributing to the authentication system:

1. Maintain backward compatibility
2. Add comprehensive tests for new features
3. Update documentation for API changes
4. Follow the existing TypeScript patterns
5. Ensure zero-config principle is preserved

## 📄 License

This is part of the OxyHQ Services package and follows the same license terms.