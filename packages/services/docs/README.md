# OxyHQServices Documentation

Complete reference for the OxyHQServices TypeScript client library.

## 📚 Documentation

- **[Quick Start](./quick-start.md)** - Get started in 5 minutes
- **[Installation](./installation.md)** - Setup and configuration
- **[Core API](./core-api.md)** - Authentication and client methods
- **[UI Components](./ui-components.md)** - React/React Native components
- **[Express Middleware](./express-middleware.md)** - Backend integration
- **[TypeScript Types](./typescript-types.md)** - Type definitions
- **[Examples](./examples/)** - Code examples and demos

## 🚀 Quick Start

### Installation

```bash
npm install @oxyhq/services
```

### Basic Usage

```typescript
import { OxyServices } from '@oxyhq/services';

// Initialize client
const oxy = new OxyServices({
  baseURL: 'http://localhost:3001'
});

// Authenticate
const response = await oxy.auth.login({
  email: 'user@example.com',
  password: 'password'
});

// Use authenticated client
const user = await oxy.users.getCurrentUser();
```

### React/React Native Integration with Redux

The `OxyProvider` now integrates with Redux for state management.

```typescript
import React from 'react';
import { OxyProvider } from '@oxyhq/services'; // Main provider
import { OxyServices, User } from '@oxyhq/services'; // Core services and types
import { useAppSelector, useAppDispatch } from '@oxyhq/services'; // Redux hooks (assuming path)
import { login as loginAction, logout as logoutAction } from '@oxyhq/services'; // Auth actions (assuming path)

// Initialize OxyServices (typically once)
const oxyServices = new OxyServices({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001',
});

function App() {
  return (
    // OxyProvider now sets up Redux Provider internally
    <OxyProvider oxyServices={oxyServices}>
      <MyComponent />
    </OxyProvider>
  );
}

function MyComponent() {
  // Consume state from Redux store
  const { user, isAuthenticated, isLoading, error } = useAppSelector(state => state.auth);
  const dispatch = useAppDispatch();

  const handleLogin = async () => {
    try {
      // Dispatch login thunk
      // Note: The actual login thunk from authSlice.ts expects more parameters
      // like storage, currentSessions, etc. This is a simplified example.
      // You'd typically call a wrapper function from useOxy() or handle this in a service layer.
      await dispatch(loginAction({
        username: 'user',
        password: 'password',
        oxyServices,
        storage: window.localStorage, // Example for web
        currentSessions: [], // Provide existing sessions if any
        currentActiveSessionId: null // Provide active session ID if any
      })).unwrap(); // .unwrap() to get payload or throw error
      console.log('Login successful');
    } catch (loginError) {
      console.error('Login failed:', loginError);
    }
  };

  const handleLogout = async () => {
    try {
      // Similar to login, logout thunk also needs parameters
      await dispatch(logoutAction({
        oxyServices,
        storage: window.localStorage,
        currentSessions: [], // Provide from store
        currentActiveSessionId: null // Provide from store
      })).unwrap();
      console.log('Logout successful');
    } catch (logoutError) {
      console.error('Logout failed:', logoutError);
    }
  };
  
  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <div>
      {isAuthenticated && user ? (
        <>
          <p>Welcome, {user.username}!</p>
          <button onClick={handleLogout}>Logout</button>
        </>
      ) : (
        <button onClick={handleLogin}>Login</button>
      )}
    </div>
  );
}

// Make sure to expose useAppSelector, useAppDispatch, and actions correctly from the library.
// For example, an index.ts in 'store' or 'hooks' directory.
// import { useAppSelector, useAppDispatch } from '@oxyhq/services/store';
// import { login, logout } from '@oxyhq/services/store/auth';
```

The `useOxy()` hook is still available but its role has shifted. It now primarily provides methods that dispatch Redux actions or interact directly with `OxyServices` for operations not managed by Redux. State itself (like `user`, `isAuthenticated`) should be accessed using `useAppSelector`.

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Your App      │    │  OxyHQServices  │    │    Oxy API      │
│                 │    │                 │    │                 │
│ React/RN/Node   │◄──►│ Client Library  │◄──►│ Auth Server     │
│ + Components    │    │ + Middleware    │    │ + Sessions      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🔑 Key Features

- **🔐 JWT Authentication** - Automatic token management and refresh
- **📱 Cross-Platform** - Works in React Native, React, and Node.js
- **🎨 UI Components** - Pre-built authentication components
- **🔧 Express Middleware** - Easy backend integration
- **📝 TypeScript** - Full type safety and IntelliSense
- **🔄 Session Management** - Device-based session isolation
- **👥 Multi-User** - Support for multiple authenticated users

## 📦 Package Exports

The library provides multiple entry points:

```typescript
// Core services only (Node.js/Express)
import { OxyServices } from '@oxyhq/services';

// UI components only (React/React Native)
import { OxyProvider, Avatar } from '@oxyhq/services/ui';

// Full package (Core + UI)
import { OxyServices, OxyProvider } from '@oxyhq/services/full';
```

## 🛠️ Use Cases

### Frontend Applications
- React/React Native apps with authentication
- User profile management
- Session handling across devices
- Multi-user account switching

### Backend Services
- Express.js API authentication middleware
- Token validation for protected routes
- User session management
- Inter-service authentication

### Full-Stack Integration
- Unified authentication across frontend and backend
- Consistent user experience
- Secure token handling
- Real-time session updates

## 🔧 Configuration

### Environment Variables

```env
# Your Oxy API server URL
OXY_API_URL=http://localhost:3001

# Optional: Custom timeout
OXY_TIMEOUT=5000
```

### Client Configuration

```typescript
const config = {
  baseURL: 'http://localhost:3001',
  timeout: 5000,                    // Request timeout
  autoRefresh: true,                // Auto-refresh tokens
  storage: 'localStorage',          // Token storage method
  retryAttempts: 3                  // Retry failed requests
};

const oxy = new OxyServices(config);
```

## 📋 Requirements

- **Node.js** 16+ (for backend usage)
- **React** 16.8+ (for React components)
- **React Native** 0.60+ (for mobile components)
- **TypeScript** 4.0+ (optional but recommended)

## 🤝 Integration

### Compatible With

- **Oxy API** - The companion authentication server
- **Express.js** - Built-in middleware support
- **Next.js** - SSR/SSG authentication
- **React Native** - Mobile app integration
- **Vite/Webpack** - Modern build tools

### Example Projects

- **my-app** - React Native demo app
- **my-app-backend** - Express.js backend demo
- **Integration examples** - Various use cases

## 🔍 API Overview

### Authentication Methods

```typescript
// Login/logout
await oxy.auth.login({ username, password });
await oxy.auth.logout();

// Token management
oxy.auth.setTokens(accessToken, refreshToken);
oxy.auth.clearTokens();

// Validation
const isValid = await oxy.auth.validate();
const userId = oxy.auth.getCurrentUserId();
```

### User Management

```typescript
// Get user data
const user = await oxy.users.getCurrentUser();

// Update profile
await oxy.users.updateProfile({ email: 'new@example.com' });
```

### Session Management

```typescript
// Device sessions
const session = await oxy.sessions.createSession(deviceFingerprint);
const sessions = await oxy.sessions.getUserSessions();

// Remote logout
await oxy.sessions.logoutSession(sessionId);
await oxy.sessions.logoutAllSessions();
```

## 🎨 UI Components

### Core Components

- **`OxyProvider`** - Authentication context provider
- **`Avatar`** - User avatar with fallbacks
- **`FollowButton`** - Social follow/unfollow button
- **`OxyLogo`** - Brand logo component

### Screens (Internal)

- Sign-in/sign-up screens
- Account management
- Session management
- Multi-user switching

## 🔐 Security Features

- **JWT Token Management** - Secure token storage and refresh
- **Device Fingerprinting** - Unique device identification
- **Session Isolation** - Separate sessions per device
- **Automatic Cleanup** - Expired session removal
- **CSRF Protection** - Built-in CSRF token handling

## 📱 Platform Support

| Platform | Core API | UI Components | Middleware |
|----------|----------|---------------|------------|
| Node.js | ✅ | ❌ | ✅ |
| React | ✅ | ✅ | ❌ |
| React Native | ✅ | ✅ | ❌ |
| Express.js | ✅ | ❌ | ✅ |

## 🆘 Support

For issues and questions:

- **[Troubleshooting Guide](./troubleshooting.md)**
- **[FAQ](./faq.md)**
- **[Examples](./examples/)**
- **[API Reference](./api-reference.md)**
