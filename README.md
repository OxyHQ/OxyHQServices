# Oxy Services Module

A unified client library for the Oxy API (authentication, user management, notifications, payments, analytics, wallet, karma, and file management).

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Usage](#usage)
  - [Using in React Native](#using-in-react-native)
  - [Using in Node.js / Express](#using-in-nodejs--express)
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

## What's New in 5.1.5

- **Fixed BottomSheet on Native Platforms**: The `OxyProvider` component now correctly displays the authentication UI in a bottom sheet on native platforms.
- **Added Bottom Sheet Controls**: The `OxyProvider` component now provides methods via context (`showBottomSheet`, `hideBottomSheet`) for programmatic control of the bottom sheet.
- **Improved Native Animations**: Enhanced animation and layout behavior for a smoother experience on all platforms.

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

**Important Notes for Node.js Usage:**

*   **UI Components Not Available**: The React Native UI components (like `OxyProvider`, `OxySignInButton`, etc.) included in this package are designed for client-side React Native applications and are **not usable** in a Node.js environment.
*   **Buffer File Uploads**: For file uploads, if you are providing data as a `Buffer` (common in Node.js when handling file streams or direct file reads), the package automatically uses `form-data` internally to correctly construct the multipart/form-data request. This ensures seamless file uploads from server-side buffers.

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
