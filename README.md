# Oxy Services Module

A unified client library for the Oxy API (authentication, user management, notifications, payments, analytics, wallet, karma, and file management).

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Usage](#usage)
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
// Import specific models directly
import { User, LoginResponse, Notification } from '@oxyhq/services';

// Or import all models as a namespace
import { Models } from '@oxyhq/services';
```

For detailed documentation on using models in your application, see [MODEL_USAGE.md](docs/MODEL_USAGE.md).

## UI Components

This package includes several UI components that can be used in your React or React Native application:

- `OxyProvider`: Context provider for authentication and settings
- `OxySignInButton`: Pre-styled authentication button
- `FollowButton`: Animated button for follow/unfollow interactions
- `Avatar`: User avatar component with fallback options
- `OxyLogo`: Brand logo component

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

### Required Peer Dependencies

For React Native applications using the bottom sheet authentication UI:

```bash
# npm
npm install react-native-gesture-handler react-native-reanimated react-native-safe-area-context

# yarn
yarn add react-native-gesture-handler react-native-reanimated react-native-safe-area-context
```

Note: The bottom sheet is now managed internally by the package, so you no longer need to install `@gorhom/bottom-sheet` directly.

## Examples

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
