# OxyHQServices

🚀 **Zero-config authentication and user management** for React, React Native, and Node.js applications. No manual token handling, no interceptor setup, no middleware configuration required.

## ✨ Quick Start (Zero Config)

### Frontend (React/React Native)

```tsx
import React from 'react';
import { AuthProvider, useAuth } from '@oxyhq/services';

// 1. Wrap your app (that's it for setup!)
function App() {
  return (
    <AuthProvider baseURL="https://api.oxy.so">
      <MainApp />
    </AuthProvider>
  );
}

// 2. Use authentication anywhere
function MainApp() {
  const { isAuthenticated, user, login, logout } = useAuth();
  
  if (!isAuthenticated) {
    return <button onClick={() => login('user', 'pass')}>Login</button>;
  }
  
  return (
    <div>
      <h1>Welcome {user?.username}!</h1>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### Backend (Express.js)

```typescript
import express from 'express';
import { authenticateRequest, OxyRequest } from '@oxyhq/services/api';

const app = express();

// Zero-config authentication - just add the middleware
app.get('/profile', authenticateRequest(), (req: OxyRequest, res) => {
  // req.user is automatically populated!
  res.json({ 
    message: `Hello ${req.user!.username}!`,
    user: req.user 
  });
});
```

That's it! 🎉 Authentication is now fully automated with:
- ✅ Automatic token management and refresh
- ✅ Secure storage across app restarts  
- ✅ Built-in error handling and retry logic
- ✅ Cross-platform support (React Native + Web)
- ✅ TypeScript support throughout

## 📖 Documentation

- **[🚀 Zero-Config Authentication Guide](./packages/services/ZERO_CONFIG_AUTH.md)** - Complete setup guide
- **[🔧 Migration Guide](./packages/services/ZERO_CONFIG_AUTH.md#migration-from-legacy-authentication)** - Upgrade from legacy auth
- **[📚 Examples](./packages/services/examples/)** - Complete integration examples
- **[🔐 API Reference](./packages/services/ZERO_CONFIG_AUTH.md#complete-api-reference)** - All components and hooks

## Table of Contents

- [Legacy Features](#features)
- [Legacy Quick Start](#quick-start)
- [Package Exports](#package-exports)
- [Requirements](#requirements)
- [Development](#development)
- [Integration](#integration)
- [License](#license)

---

## Legacy Features (Still Supported)

A TypeScript client library for the Oxy API providing authentication, user management, and UI components for React and React Native applications.

- 🔐 **Authentication**: JWT-based auth with automatic token refresh
- 👥 **User Management**: Profile operations and social features  
- 🎨 **UI Components**: Pre-built React components for common functionality
- 📱 **Cross-Platform**: Works in React Native and web applications
- 🔧 **TypeScript**: Full type safety and IntelliSense support

## Legacy Quick Start

```bash
npm install @oxyhq/services
```

```typescript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: 'http://localhost:3000'
});

// Authenticate
const response = await oxy.auth.login({
  email: 'user@example.com',
  password: 'password'
});

// Get current user
const user = await oxy.users.getCurrentUser();
```

- [📚 Full Documentation](./docs/README.md)
- [🚀 Quick Start Guide](./docs/quick-start.md)
- [🔐 Core API Reference](./docs/core-api.md)
- [💼 Integration Examples](./docs/examples/)

## UI Components

Import and use pre-built React components:

```typescript
import { OxyProvider, Avatar, FollowButton } from '@oxyhq/services/ui';
```

## Package Exports

The library provides multiple entry points:

```typescript
// Core services only (Node.js/Express)
import { OxyServices } from '@oxyhq/services';

// UI components only (React/React Native)
import { OxyProvider, Avatar } from '@oxyhq/services/ui';

// Full package (Core + UI)
import { OxyServices, OxyProvider } from '@oxyhq/services/full';
```

## Zero-Config Express Router

Quickly mount authentication routes in any Express app:

```typescript
import express from 'express';
import { createAuth } from '@oxyhq/services/core';

const app = express();
app.use('/auth', createAuth({ baseURL: 'http://localhost:3000' }).middleware());
```

This automatically provides sign-up, login, logout, refresh, and session management endpoints.

## Requirements

- **Node.js** 16+ (for backend usage)
- **React** 16.8+ (for React components)
- **React Native** 0.60+ (for mobile components)
- **TypeScript** 4.0+ (optional but recommended)

## Troubleshooting

### FormData Issues in React Native/Expo

If you encounter `ReferenceError: Property 'FormData' doesn't exist` when using Expo with Hermes engine:

**For file uploads in React Native/Expo:**
- The library handles this automatically - no additional setup required
- File uploads will work with both native FormData (when available) and the polyfilled version
- Ensure you're using the latest version of the package

### Additional Dependencies

For React Native projects, you may need to install peer dependencies:

```bash
npm install axios jwt-decode invariant
```

## Important for React Native Hermes Users

If you use this package in a React Native app with the Hermes engine, you must add the following import as the very first line of your app's entry file (e.g., App.js or index.js):

```js
import 'react-native-url-polyfill/auto';
```

This ensures that FormData and other web APIs are polyfilled before any dependencies are loaded. If you do not do this, you may see errors like:

```
ReferenceError: Property 'FormData' doesn't exist, js engine: hermes
```

---

## Development

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run tests
npm test

# Development mode
npm run dev
```

## Integration

This library works with:
- **[Oxy API](../oxy-api/)** - The companion authentication server
- **Express.js** - Built-in middleware support
- **React/React Native** - UI components and hooks
- **Next.js** - SSR/SSG authentication

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
