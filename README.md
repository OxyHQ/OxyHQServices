# Oxy Services Module

A unified client library for the Oxy API featuring enhanced device-based session management, authentication, user management, notifications, payments, analytics, wallet, karma, and file management.

## Table of Contents

- [Overview](#overview)
- [What's New in v5.3.0](#whats-new-in-v530)
- [Installation](#installation)
- [Usage](#usage)
  - [Using in React Native](#using-in-react-native)
  - [Using in Node.js / Express](#using-in-nodejs--express)
  - [Enhanced Device Session Management](#enhanced-device-session-management)
- [Configuration](#configuration)
- [API Reference](#api-reference)
  - [OxyConfig](#oxyconfig)
  - [Class: OxyServices](#class-oxyservices)
- [Models and Types](#models-and-types)
- [UI Components](#ui-components)
- [Examples](#examples)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

The `@oxyhq/services` package provides a simple, promise-based client to interact with the Oxy API. It wraps HTTP calls to endpoints for:

- Authentication (signup, login, token refresh, logout, validation)
- User & profile operations (fetch, update, follow/unfollow)
- Real‑time notifications (list, create, mark read, delete)
- Payments & wallet (process payment, validate method, transfer funds, purchase, withdrawal)
- Analytics & content insights (time‑series data, viewers, follower stats)
- Karma system (leaderboard, rules, award/deduct points)
- File management (upload, download, stream, list, update, delete files using GridFS)

## Models and Types

The package exports TypeScript interfaces for all data models used by the API. These can be used in your application for type safety and better IntelliSense support.

```typescript
// Import specific models directly from main export
import { User, LoginResponse, Notification } from '@oxyhq/services';

// Or import all models as a namespace
import { Models } from '@oxyhq/services';

// For full package usage (includes UI components)
import { Models, User, LoginResponse } from '@oxyhq/services/full';
```

For detailed documentation on using models in your application, see [MODEL_USAGE.md](docs/MODEL_USAGE.md).

## UI Components

This package includes several UI components that can be used in your React or React Native application:

- `OxyProvider`: Context provider for authentication and settings
- `OxySignInButton`: Pre-styled authentication button
- `FollowButton`: Animated button for follow/unfollow interactions
- `Avatar`: User avatar component with fallback options
- `OxyLogo`: Brand logo component

**Import UI Components:**
```javascript
// Import specific UI components
import { OxyProvider, OxySignInButton, Avatar } from '@oxyhq/services/ui';

// Or import from full package
import { OxyProvider, OxySignInButton, Avatar } from '@oxyhq/services/full';
```

For detailed documentation on UI components, see [UI_COMPONENTS.md](UI_COMPONENTS.md).

## What's New in 5.2.0

- **Multi-User Authentication**: Support for signing in with multiple accounts simultaneously
- **Account Switcher**: Built-in UI for switching between authenticated accounts
- **Session Management**: View and manage active sessions across devices with remote logout capabilities
- **Enhanced Security**: Comprehensive session tracking with device information
- **Account Center**: New account management interface with multi-user support

## What's New in 5.1.5

- **Fixed BottomSheet on Native Platforms**: The `OxyProvider` component now correctly displays the authentication UI in a bottom sheet on native platforms.
- **Added Bottom Sheet Controls**: The `OxyProvider` component now provides methods via context (`showBottomSheet`, `hideBottomSheet`) for programmatic control of the bottom sheet.
- **Improved Native Animations**: Enhanced animation and layout behavior for a smoother experience on all platforms.

---

## What's New in v5.3.0

### 🔐 Enhanced Device-Based Session Management

This release introduces a comprehensive device-based session management system that enables:

- **Device Fingerprinting**: Consistent device identification across sessions
- **Multi-User Support**: Multiple users can sign in on shared devices with session isolation
- **Remote Session Management**: View and manage sessions across all devices
- **Enhanced Security**: No PII stored locally, server-side session validation
- **Cross-Platform Support**: Works with both web browsers and React Native apps

```typescript
import { DeviceManager, OxyServices } from '@oxyhq/services';

// Initialize device manager for fingerprinting
const deviceManager = new DeviceManager();
await deviceManager.initialize();

// Enhanced login with device fingerprinting
const oxyServices = new OxyServices(config);
const response = await oxyServices.secureLogin(username, password, {
  deviceFingerprint: await deviceManager.generateFingerprint()
});

// Manage device sessions
const deviceSessions = await oxyServices.getDeviceSessions(sessionId);
await oxyServices.logoutAllDeviceSessions(sessionId);
await oxyServices.updateDeviceName(sessionId, 'My Device');
```

### 🎨 Complete UI Component Suite

All UI components and screens are now fully implemented:

- **Authentication Screens**: SignInScreen, SignUpScreen, SessionManagementScreen
- **Account Management**: AccountCenterScreen, AccountOverviewScreen, AccountSettingsScreen  
- **Karma System**: KarmaCenterScreen, KarmaLeaderboardScreen, KarmaRewardsScreen, KarmaRulesScreen, KarmaAboutScreen, KarmaFAQScreen
- **Utility Components**: OxyIcon, Avatar, FollowButton, OxyLogo, FontLoader

---

## Installation

```bash
# npm
npm install @oxyhq/services

# yarn
yarn add @oxyhq/services
```

## Import Guide

The package provides different entry points for different use cases:

### Node.js/Express (Server-side only)
For server-side applications that only need core services and models:

```javascript
// CommonJS
const { OxyServices, Models } = require('@oxyhq/services');

// ES Modules
import { OxyServices, Models } from '@oxyhq/services';
```

### React/React Native (UI components only)
For client-side applications that only need UI components:

```javascript
// Import UI components
import { 
  OxyProvider, 
  OxySignInButton, 
  OxyLogo, 
  Avatar, 
  FollowButton 
} from '@oxyhq/services/ui';
```

### Full Package (Core + UI)
For applications that need both core services and UI components:

```javascript
// Import everything
import { 
  OxyServices, 
  OxyProvider, 
  OxySignInButton,
  Models 
} from '@oxyhq/services/full';
```

## Usage

This section details how to use the `@oxyhq/services` package in different JavaScript environments.

### Using in React Native

For React Native applications, you can import UI components and core services as needed:

```javascript
// Import core services
import { OxyServices } from '@oxyhq/services';

// Import UI components
import { OxyProvider, OxySignInButton } from '@oxyhq/services/ui';

// Or import everything together
import { OxyServices, OxyProvider, OxySignInButton } from '@oxyhq/services/full';
```

**Required Peer Dependencies:**

If you plan to use UI components that rely on native capabilities, such as the bottom sheet authentication UI, you'll need to install the following peer dependencies:

```bash
# npm
npm install react-native-gesture-handler react-native-reanimated react-native-safe-area-context

# yarn
yarn add react-native-gesture-handler react-native-reanimated react-native-safe-area-context
```

Note: The bottom sheet functionality is managed internally by the package, so you no longer need to install `@gorhom/bottom-sheet` directly.

Refer to the [UI Components](#ui-components) section for more information on available React Native components.

### Using in Node.js / Express

The `@oxyhq/services` package can also be used in Node.js backend environments.

**Installation:**

The installation is the same as for client-side usage:
```bash
# npm
npm install @oxyhq/services

# yarn
yarn add @oxyhq/services
```

**Importing the `OxyServices` class:**

You can import the class using either CommonJS or ES Modules syntax.

*CommonJS:*
```javascript
const { OxyServices } = require('@oxyhq/services');
```

*ES Modules:*
```javascript
import { OxyServices } from '@oxyhq/services';
```

**Initializing `OxyServices`:**

Here's a brief example of how to initialize and use `OxyServices` in a Node.js context:

```javascript
const { OxyServices, OXY_CLOUD_URL } = require('@oxyhq/services'); // Or use import for ES Modules

const oxy = new OxyServices({
  baseURL: OXY_CLOUD_URL, // or your self-hosted Oxy API URL
  // In a Node.js environment, you typically don't use client-side storage for tokens.
  // Token management should be handled per user session or through other server-side mechanisms.
});

async function loginUser() {
  try {
    // Example login - in a real app, credentials would come from a request
    const { accessToken, refreshToken, user } = await oxy.login('testuser', 'password123');
    console.log('Login successful for user:', user.username);
    // IMPORTANT: In a server environment, you would typically not store tokens in the OxyService instance directly.
    // Instead, you would manage them securely, perhaps in an HTTP-only cookie, a session store,
    // or by passing them to the client that initiated the request.
    // The accessToken can then be used to make further API calls on behalf of this user.
  } catch (error) {
    console.error('Login failed:', error.message || error);
  }
}

// Example usage:
// loginUser(); 
// (Call this function based on your application's logic, e.g., in an Express route handler)
```

#### Server Authentication Utilities

For Express.js applications, OxyServices provides built-in authentication middleware and utilities:

```javascript
const { OxyServices } = require('@oxyhq/services');

const oxyServices = new OxyServices({
  baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
});

// Built-in Express middleware for token validation
const authenticateToken = oxyServices.createAuthenticateTokenMiddleware({
  loadFullUser: true, // Load complete user profile
  onError: (error) => {
    // Custom error handling
    console.error('Auth error:', error);
  }
});

// Use middleware to protect routes
app.get('/api/protected', authenticateToken, (req, res) => {
  // req.userId - User ID
  // req.accessToken - Validated token
  // req.user - Full user object (if loadFullUser: true)
  res.json({ message: 'Access granted', user: req.user });
});

// Standalone token validation (for WebSocket, background jobs, etc.)
async function validateToken(token) {
  const result = await oxyServices.authenticateToken(token);
  return result.valid ? result.user : null;
}
```

**📖 For comprehensive server-side authentication examples and advanced configurations, see [SERVER_AUTHENTICATION.md](docs/SERVER_AUTHENTICATION.md)**

**Important Notes for Node.js Usage:**

*   **UI Components Not Available**: The React Native UI components (like `OxyProvider`, `OxySignInButton`, etc.) included in this package are designed for client-side React Native applications and are **not usable** in a Node.js environment.
*   **Buffer File Uploads**: For file uploads, if you are providing data as a `Buffer` (common in Node.js when handling file streams or direct file reads), the package automatically uses `form-data` internally to correctly construct the multipart/form-data request. This ensures seamless file uploads from server-side buffers.

## Multi-User Authentication

The Oxy Services library now supports multi-user authentication, allowing users to sign in with multiple accounts simultaneously and switch between them seamlessly.

### Features

- **Multiple Account Support**: Users can sign in with multiple accounts and switch between them
- **Account Switcher**: Built-in UI component for easy account switching
- **Session Management**: View and manage active sessions across all devices
- **Remote Logout**: Log out from specific sessions remotely
- **Device Tracking**: Track session activity across different devices and platforms

### Usage

```typescript
import { OxyProvider, useOxy } from '@oxyhq/services/full';

// The OxyProvider automatically handles multi-user state
function App() {
  return (
    <OxyProvider oxyServices={oxyServices}>
      <MyApp />
    </OxyProvider>
  );
}

function MyApp() {
  const { 
    user,           // Current active user
    users,          // Array of all authenticated users
    switchUser,     // Switch to a different user
    removeUser,     // Remove a user from the account list
    getUserSessions, // Get sessions for a user
    logoutSession   // Logout from a specific session
  } = useOxy();

  // Switch to a different user
  const handleSwitchUser = async (userId) => {
    await switchUser(userId);
  };

  // Remove a user account
  const handleRemoveUser = async (userId) => {
    await removeUser(userId);
  };

  // Get sessions for current user
  const handleGetSessions = async () => {
    const sessions = await getUserSessions();
    console.log('Active sessions:', sessions);
  };

  return (
    <div>
      <h1>Welcome, {user?.username}</h1>
      <p>You have {users.length} account(s) signed in</p>
      
      {/* Account switcher */}
      {users.length > 1 && (
        <AccountSwitcher 
          users={users}
          currentUser={user}
          onSwitchUser={handleSwitchUser}
        />
      )}
    </div>
  );
}
```

### Built-in UI Components

The library includes several UI components for multi-user functionality:

#### AccountSwitcherScreen
Displays all authenticated accounts and allows switching between them:

```typescript
import { AccountSwitcherScreen } from '@oxyhq/services/full';

// The component is automatically available through OxyProvider navigation
// Access via: showBottomSheet('AccountSwitcher')
```

#### SessionManagementScreen
Shows active sessions across devices with logout capabilities:

```typescript
import { SessionManagementScreen } from '@oxyhq/services/full';

// Access via: showBottomSheet('SessionManagement')
```

#### Enhanced SignInScreen
The sign-in screen now supports adding additional accounts:

```typescript
// When user is already authenticated, the sign-in screen
// automatically switches to "Add Account" mode
const { showBottomSheet } = useOxy();

// Show sign-in screen (will show "Add Account" if user is authenticated)
showBottomSheet('SignIn');
```

### API Reference

#### Multi-User Context Methods

```typescript
interface OxyContextState {
  // Multi-user state
  user: User | null;              // Current active user
  users: AuthenticatedUser[];     // All authenticated users
  
  // Multi-user methods
  switchUser: (userId: string) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
  getUserSessions: (userId?: string) => Promise<SessionData[]>;
  logoutSession: (sessionId: string, userId?: string) => Promise<void>;
  logoutAll: () => Promise<void>; // Logout all users
}
```

#### Session Data Structure

```typescript
interface SessionData {
  id: string;
  deviceInfo: {
    deviceType: string;
    platform: string;m 
    browser?: string;
    os?: string;
    ipAddress: string;
    lastActive: Date;
  };
  createdAt: Date;
  isCurrent: boolean;
}
```

## Package Version Management

## Version Constants

To avoid runtime dependencies on `package.json`, version information is stored in `/src/constants/version.ts`. This ensures compatibility with bundlers and prevents Metro/Webpack resolution issues.

### Updating Version Information

When updating the package version in `package.json`, also update the version constants:

1. Update `package.json` version
2. Update `src/constants/version.ts` with the same version number
3. Run `npm run build` to generate updated library files

### Automatic Version Sync

You can add this script to `package.json` to automatically sync versions:

```json
{
  "scripts": {
    "version": "node scripts/update-version-constants.js && git add src/constants/version.ts"
  }
}
```

Create `scripts/update-version-constants.js`:

```javascript
const fs = require('fs');
const packageJson = require('../package.json');

const versionFile = `/**
 * Package version and metadata constants
 * This file is auto-generated to avoid runtime dependency on package.json
 */

export const packageInfo = {
    name: "${packageJson.name}",
    version: "${packageJson.version}",
    description: "${packageJson.description}",
    main: "${packageJson.main}",
    module: "${packageJson.module}",
    types: "${packageJson.types}"
} as const;

export const { name, version, description } = packageInfo;`;

fs.writeFileSync('src/constants/version.ts', versionFile);
console.log(`Updated version constants to ${packageJson.version}`);
```

This ensures version constants stay in sync with package.json automatically.

## Usage in Components

```tsx
import { packageInfo } from '../../constants/version';

// Display current version
<Text>Version {packageInfo.version}</Text>

// Use in reports or debugging
const appInfo = {
  name: packageInfo.name,
  version: packageInfo.version,
  // ... other info
};
```

## Usage Examples

### File Management

The library provides comprehensive file management capabilities using MongoDB's GridFS system. Here are some examples of how to use these features:

```typescript
import { OxyServices } from '@oxyhq/services';

// Initialize the client
const oxyServices = new OxyServices({ baseURL: 'https://api.example.com' });

// Upload a file
async function uploadProfileImage(file, userId) {
  const response = await oxyServices.uploadFile(file, 'profile.jpg', {
    userId,
    description: 'Profile picture',
    tags: ['profile', 'avatar']
  });
  
  return response.file;
}

// Download a file
function getFileUrl(fileId) {
  return oxyServices.getFileDownloadUrl(fileId);
}

// List user files
async function getUserFiles(userId) {
  const response = await oxyServices.listUserFiles(userId);
  return response.files;
}
```

For more comprehensive examples, see:
- [File Upload Example](examples/FileUploadExample.tsx) - Complete React Native component for file upload and management
- [GridFS Server Example](examples/GridFSServerExample.js) - Server-side implementation using Express and MongoDB

For detailed documentation on file management, see [FILE_MANAGEMENT.md](docs/FILE_MANAGEMENT.md).

### Export Structure

#### 🔧 Public API Components (Exported)
These are available for external use in your applications:

```typescript
// Context & Hooks
import { OxyProvider, OxyContextProvider, useOxy } from '@oxyhq/services';

// UI Components
import { 
  OxySignInButton,
  OxyLogo,
  Avatar,
  FollowButton,
  FontLoader,
  OxyIcon
} from '@oxyhq/services';

// Device Management
import { DeviceManager } from '@oxyhq/services';
import type { DeviceFingerprint, StoredDeviceInfo } from '@oxyhq/services';

// Core Services
import { OxyServices } from '@oxyhq/services';

// Types
import type { 
  OxyContextState, 
  OxyContextProviderProps 
} from '@oxyhq/services';
```

#### 🚪 Internal Screens (Router Use Only)
These screens are used internally by the package router and are **not exported**:

- `SignInScreen`, `SignUpScreen`
- `AccountCenterScreen`, `SessionManagementScreen`
- `AccountOverviewScreen`, `AccountSettingsScreen`
- `KarmaCenterScreen`, `KarmaLeaderboardScreen`, `KarmaRewardsScreen`
- `KarmaRulesScreen`, `KarmaAboutScreen`, `KarmaFAQScreen`
- `AccountSwitcherScreen`, `AppInfoScreen`

> **Note**: Screens are handled internally by the package routing system. Use the exported components and hooks to build your own UI or trigger the built-in screens through the context methods.
