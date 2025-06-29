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

- 🔐 **Authentication**: JWT-based auth with automatic token refresh
- 👥 **User Management**: Profile operations and social features
- 🎨 **UI Components**: Pre-built React components for common functionality
- 📱 **Cross-Platform**: Works in React Native and web applications
- 🔧 **TypeScript**: Full type safety and IntelliSense support

## Quick Start

### For React Components (Hook-based API)

```bash
npm install @oxyhq/services
```

```typescript
import { OxyProvider, useAuthFetch } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services/core';

// Setup
const oxyServices = new OxyServices({
  baseURL: 'https://your-api.com'
});

function App() {
  return (
    <OxyProvider oxyServices={oxyServices}>
      <UserProfile />
    </OxyProvider>
  );
}

function UserProfile() {
  const authFetch = useAuthFetch();
  
  const loadProfile = () => authFetch.get('/api/users/me');
  return <button onClick={loadProfile}>Load Profile</button>;
}
```

### For Redux/Non-Component Usage (Core API)

```typescript
import { OxyServices } from '@oxyhq/services/core';
import { createAsyncThunk } from '@reduxjs/toolkit';

// Create service instance
const oxyServices = new OxyServices({
  baseURL: 'https://your-api.com'
});

// Use in Redux thunks
export const loginUser = createAsyncThunk(
  'auth/loginUser',
  async (credentials: { username: string; password: string }) => {
    return await oxyServices.login(credentials.username, credentials.password);
  }
);

// Use in utility functions
export async function getCurrentUser() {
  return await oxyServices.getCurrentUser();
}
```

**📖 For complete non-hook API documentation, see [Non-Hook API Guide](./docs/NON_HOOK_API_GUIDE.md)**

## Documentation

For comprehensive documentation, API reference, and examples:

- [📚 Full Documentation](./docs/README.md)
- [🚀 Quick Start Guide](./docs/quick-start.md)
- [🔐 Authentication Guide](./docs/AUTHENTICATION.md) - Hook-based API for components
- [⚡ Non-Hook API Guide](./docs/NON_HOOK_API_GUIDE.md) - **Core API for Redux, thunks, and utility functions**
- [🔧 Redux Practical Example](./docs/REDUX_PRACTICAL_EXAMPLE.md) - **Complete working example for Redux usage**
- [🔄 Hook vs Core API](./docs/HOOK_VS_CORE_API.md) - Side-by-side comparison with examples
- [🔧 Redux Integration](./docs/redux-integration.md) - Both managed and custom approaches
- [🔗 Core API Reference](./docs/core-api.md)
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

The library automatically includes polyfills for React Native environments that lack native FormData support. The `form-data` package is included as a dependency and will be used as a fallback when native FormData is not available.

**For file uploads in React Native/Expo:**
- The library handles this automatically - no additional setup required
- File uploads will work with both native FormData (when available) and the polyfilled version
- Ensure you're using the latest version of the package

### Additional Dependencies

For React Native projects, you may need to install peer dependencies:

```bash
npm install axios jwt-decode invariant
```

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
