# OxyHQ Services

[![npm version](https://badge.fury.io/js/%40oxyhq%2Fservices.svg)](https://badge.fury.io/js/%40oxyhq%2Fservices)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reusable OxyHQ module to handle authentication, user management, karma system, device-based session management and more. Updated for improved API compatibility and performance 🚀

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
- 🎯 **Karma System**: Award and deduct karma points
- 💰 **Wallet & Payments**: Manage digital wallet and transactions
- 📁 **File Management**: Upload and manage files with metadata
- 📊 **Analytics & Notifications**: Track user analytics and receive notifications

## Quick Start

### Installation

```bash
npm install @oxyhq/services
# or
yarn add @oxyhq/services
```

### Basic Usage

```typescript
import OxyServices from '@oxyhq/services';

// Initialize with your API configuration
const oxy = new OxyServices({
  baseURL: 'https://api.oxy.so'
});

// User registration
const signUpResult = await oxy.signUp('username', 'email@example.com', 'password');
console.log('User registered:', signUpResult.user);

// User login
const loginResult = await oxy.login('username', 'password');
console.log('User logged in:', loginResult.user);

// Get current user profile
const profile = await oxy.getCurrentUser();
console.log('Current user:', profile);

// Follow a user
await oxy.followUser('user-id');
console.log('User followed successfully');

// Upload a file
const file = new File(['content'], 'document.txt', { type: 'text/plain' });
const fileMetadata = await oxy.uploadFile(file, 'document.txt', {
  description: 'My document',
  tags: ['document', 'text']
});
console.log('File uploaded:', fileMetadata);
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
