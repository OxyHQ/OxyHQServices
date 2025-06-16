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
- ⚡ **Zustand State Management**: High-performance state management with Expo compatibility
- 💾 **Automatic Persistence**: Cross-platform state persistence (web & mobile)

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
- [⚡ Zustand State Management Guide](./docs/zustand-state-management.md)
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

- **Node.js** 18+ (for backend usage)
- **React** 16.8+ (for React components)
- **React Native** 0.60+ (for mobile components)
- **TypeScript** 5.0+ (optional but recommended)

### Optional Dependencies

Some UI components require additional peer dependencies. These are optional and the library provides fallbacks:

- **@expo/vector-icons** - For icons (falls back to emoji icons)
- **@gorhom/bottom-sheet** - For bottom sheet components (falls back to modal)
- **sonner** / **sonner-native** - For toast notifications (falls back to console logging)

Install them if you want the enhanced experience:

```bash
# For React Native with Expo
npm install @expo/vector-icons @gorhom/bottom-sheet sonner-native

# For React web
npm install sonner

# React Native without Expo (requires additional setup)
npm install @gorhom/bottom-sheet react-native-svg react-native-reanimated
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
- **[Oxy API](../api/)** - The companion authentication server
- **Express.js** - Built-in middleware support
- **React/React Native** - UI components and hooks
- **Next.js** - SSR/SSG authentication

## Troubleshooting

### Build Issues

**Icons not working?**
- Install `@expo/vector-icons` or the library will use emoji fallbacks
- For React Native without Expo, use a compatible icon library

**Bottom sheet not working?**
- Install `@gorhom/bottom-sheet` or the library will use Modal fallbacks
- Ensure react-native-reanimated and react-native-gesture-handler are properly linked

**TypeScript errors?**
- Ensure TypeScript 5.0+ is installed
- Add `@types/react` and `@types/react-native` to devDependencies

### Common Issues

**"Buffer is not defined" errors:**
- This is expected in web environments - the library handles this gracefully

**Missing peer dependencies warnings:**
- These are optional - the library provides fallbacks for better developer experience

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
