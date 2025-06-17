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

## Documentation

For comprehensive documentation, API reference, and examples:

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
