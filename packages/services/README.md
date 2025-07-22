# OxyHQServices

A TypeScript client library for the Oxy API providing authentication, user management, and UI components for React and React Native applications.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [UI Components](#ui-components)
- [Package Exports](#package-exports)
- [Requirements](#requirements)
- [Development](#development)
- [Integration](#integration)
- [License](#license)

## Features

- 🔐 **Streamlined Authentication**: Zero-config authentication with automatic token management
- 🔄 **Auto Token Refresh**: Seamless token lifecycle management behind the scenes
- 👥 **User Management**: Profile operations and social features
- 🎨 **UI Components**: Pre-built React components for common functionality
- 📱 **Cross-Platform**: Works in React Native and web applications
- 🔧 **TypeScript**: Full type safety and IntelliSense support
- 🚀 **Performance**: Optimized with automatic caching and state management

## Quick Start

```bash
npm install @oxyhq/services
```

### Streamlined Authentication (Recommended)

```typescript
import { OxyProvider, useOxy } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://api.example.com">
      <YourApp />
    </OxyProvider>
  );
}

function UserProfile() {
  const { oxyServices } = useOxy();
  
  const fetchData = async () => {
    // No manual authentication needed - everything is automatic!
    const user = await oxyServices.getCurrentUser();
    const notifications = await oxyServices.getNotifications();
  };
}
```

### With Built-in Bottom Sheet

The OxyProvider now includes a built-in gorhom bottom sheet - no manual setup required!

```typescript
import { OxyProvider, useOxy, OxySignInButton } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider 
      baseURL="https://api.example.com"
      initialScreen="SignIn"
      theme="light"
    >
      <YourApp />
    </OxyProvider>
  );
}

function Component() {
  const { showBottomSheet } = useOxy();
  
  const openSignIn = () => {
    showBottomSheet('SignIn'); // Works automatically!
  };
  
  return (
    <div>
      <button onClick={openSignIn}>Sign In</button>
      <OxySignInButton /> {/* Also works automatically! */}
    </div>
  );
}
```

### Traditional Usage

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

## Documentation

For comprehensive documentation, API reference, and examples:

- [📚 Full Documentation](./docs/README.md)
- [🚀 Quick Start Guide](./docs/quick-start.md)
- [🔐 Core API Reference](./docs/core-api.md)
- [⚡ Streamlined Authentication](./docs/core-api.md#streamlined-authentication) - **NEW!**
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
