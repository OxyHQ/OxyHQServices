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
- ✨ **Simple API**: All functionality in one unified class - no need to manage multiple service instances

## Quick Start

```bash
npm install @oxyhq/services
```

### Simple & Unified API

The new OxyServices provides all functionality in one simple class:

```typescript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({ baseURL: 'https://api.example.com' });

// Authentication
await oxy.signIn('username', 'password');
await oxy.signUp('username', 'email', 'password');

// User operations
const user = await oxy.getCurrentUser();
await oxy.updateProfile({ name: 'John Doe' });
await oxy.followUser('user123');

// Social features
const followers = await oxy.getUserFollowers('user123');
const notifications = await oxy.getNotifications();

// File uploads
const fileData = await oxy.uploadFile(file);

// Payments
const payment = await oxy.createPayment(paymentData);

// Location services
await oxy.updateLocation(40.7128, -74.0060);
const nearby = await oxy.getNearbyUsers();

// Analytics
await oxy.trackEvent('user_action', { action: 'click' });

// Everything in one place - no more managing multiple service instances!
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

### Simple & Unified API

```typescript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: 'http://localhost:3000'
});

// Authentication
const response = await oxy.signIn('username', 'password');

// User operations
const user = await oxy.getCurrentUser();
await oxy.updateProfile({ name: 'John Doe' });
await oxy.followUser('user123');

// Social features
const followers = await oxy.getUserFollowers('user123');
const notifications = await oxy.getNotifications();

// File operations
const fileData = await oxy.uploadFile(file);
const downloadUrl = oxy.getFileDownloadUrl(fileId);

// Everything is available directly on the oxy instance!
```

## Documentation

This package provides a TypeScript client library for the Oxy API with authentication, user management, and UI components.

## UI Components

Import and use pre-built React components:

```typescript
import { OxyProvider, Avatar, FollowButton } from '@oxyhq/services/ui';
```

## Package Exports

The library provides a unified API:

```typescript
// Unified OxyServices class (recommended)
import { OxyServices } from '@oxyhq/services';

// All functionality is available directly on the OxyServices instance
const oxy = new OxyServices({ baseURL: 'https://api.example.com' });

// UI components (React/React Native)
import { OxyProvider, Avatar } from '@oxyhq/services/ui';
```



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
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
