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

### React/React Native Integration

```typescript
import { OxyProvider, useOxy } from '@oxyhq/services/ui';

function App() {
  return (
    <OxyProvider config={{ baseURL: 'http://localhost:3001' }}>
      <MyComponent />
    </OxyProvider>
  );
}

function MyComponent() {
  const { user, login, logout } = useOxy();
  
  return (
    <div>
      {user ? (
        <p>Welcome, {user.username}!</p>
      ) : (
        <button onClick={() => login('user', 'pass')}>
          Login
        </button>
      )}
    </div>
  );
}
```

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
