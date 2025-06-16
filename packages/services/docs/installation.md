# Installation Guide

This guide covers installing and configuring OxyHQServices for different platforms and use cases.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Package Installation](#package-installation)
- [Platform-Specific Setup](#platform-specific-setup)
- [Configuration](#configuration)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- **Node.js** 16 or higher
- **npm** 7+ or **yarn** 1.22+
- **TypeScript** 4.0+ (optional but recommended)

### Platform Requirements

#### For React Web Applications
- **React** 16.8 or higher
- Modern browser with ES2018 support

#### For React Native Applications
- **React Native** 0.60 or higher
- **React** 16.8 or higher
- **react-native-gesture-handler** 2.16.1+
- **react-native-reanimated** 3.16.0+
- **react-native-safe-area-context** 5.4.0+
- **react-native-svg** 13.0.0+

#### For Node.js/Express Applications
- **Node.js** 16 or higher
- **Express.js** 4.0+ (for middleware usage)

## Package Installation

### npm

```bash
npm install @oxyhq/services
```

### yarn

```bash
yarn add @oxyhq/services
```

### pnpm

```bash
pnpm add @oxyhq/services
```

## Platform-Specific Setup

### React Web Applications

For React web applications, no additional setup is required. The package works out of the box:

```tsx
import { OxyServices } from '@oxyhq/services';
import { OxyProvider } from '@oxyhq/services/ui';

// Initialize the client
const oxy = new OxyServices({
  baseURL: 'https://your-api-server.com'
});

function App() {
  return (
    <OxyProvider client={oxy}>
      {/* Your app components */}
    </OxyProvider>
  );
}
```

### React Native Applications

#### Expo Projects

For Expo projects, install additional dependencies:

```bash
# Install required peer dependencies
expo install react-native-gesture-handler react-native-reanimated react-native-safe-area-context react-native-svg

# For AsyncStorage (token persistence)
expo install @react-native-async-storage/async-storage
```

Add to your `app.json` or `expo.json`:

```json
{
  "expo": {
    "plugins": [
      "react-native-reanimated/plugin"
    ]
  }
}
```

#### Bare React Native Projects

Install peer dependencies:

```bash
npm install react-native-gesture-handler react-native-reanimated react-native-safe-area-context react-native-svg @react-native-async-storage/async-storage
```

#### iOS Setup

Add to your `ios/Podfile`:

```ruby
pod 'RNSVG', :path => '../node_modules/react-native-svg'
```

Run:

```bash
cd ios && pod install
```

#### Android Setup

For React Native 0.60+, auto-linking should handle most configuration. If you encounter issues, refer to the specific library documentation.

### Node.js/Express Applications

For backend-only usage (no UI components):

```bash
npm install @oxyhq/services
```

Example Express.js setup:

```typescript
import express from 'express';
import { OxyServices } from '@oxyhq/services';

const app = express();
const oxy = new OxyServices({
  baseURL: 'https://your-api-server.com'
});

// Use middleware for protected routes
app.use('/api/protected', oxy.middleware());

app.listen(3000);
```

## Configuration

### Environment Variables

Create a `.env` file in your project root:

```env
# Required: Your Oxy API server URL
OXY_API_URL=https://your-api-server.com

# Optional: Client configuration
OXY_TIMEOUT=5000
OXY_DEBUG=false
OXY_AUTO_REFRESH=true
```

### TypeScript Configuration

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "jsx": "react-jsx"
  }
}
```

### Metro Configuration (React Native)

Add to your `metro.config.js`:

```javascript
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add resolver for proper module resolution
config.resolver.alias = {
  '@oxyhq/services': require.resolve('@oxyhq/services'),
};

module.exports = config;
```

## Verification

### Test Installation

Create a simple test file to verify installation:

```typescript
// test-installation.ts
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: 'https://httpbin.org'  // Test endpoint
});

console.log('OxyHQServices installed successfully!');
console.log('Client initialized:', oxy.getConfig());
```

Run with:

```bash
npx ts-node test-installation.ts
```

### Test UI Components (React/React Native)

```tsx
// test-ui.tsx
import React from 'react';
import { OxyProvider } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: 'https://your-api-server.com'
});

function TestApp() {
  return (
    <OxyProvider client={oxy}>
      <div>UI components working!</div>
    </OxyProvider>
  );
}

export default TestApp;
```

## Troubleshooting

### Common Issues

#### Peer Dependency Warnings

If you see peer dependency warnings, install the missing packages:

```bash
# Check what's missing
npm ls

# Install missing peer dependencies
npm install <missing-package>
```

#### Metro Resolution Issues (React Native)

If modules aren't resolving correctly:

1. Clear Metro cache:
   ```bash
   npx react-native start --reset-cache
   ```

2. Clean and rebuild:
   ```bash
   cd android && ./gradlew clean && cd ..
   cd ios && xcodebuild clean && cd ..
   ```

#### TypeScript Errors

Ensure you have the correct TypeScript version:

```bash
npm install --save-dev typescript@^5.3.0
```

#### Build Errors with Expo

If you encounter build errors:

1. Clear Expo cache:
   ```bash
   expo r -c
   ```

2. Update Expo SDK:
   ```bash
   expo install --fix
   ```

### Platform-Specific Issues

#### iOS Simulator Issues

- Ensure Xcode is up to date
- Reset iOS Simulator: Device → Erase All Content and Settings

#### Android Emulator Issues

- Ensure Android SDK is properly configured
- Try running on a physical device if emulator fails

### Getting Help

If you encounter issues:

1. Check the [Troubleshooting Guide](./troubleshooting.md)
2. Search existing [GitHub Issues](https://github.com/oxyhq/oxyhqservices/issues)
3. Create a new issue with:
   - Platform and version details
   - Complete error messages
   - Minimal reproduction example

## Next Steps

After successful installation:

1. Read the [Quick Start Guide](./quick-start.md)
2. Explore [API Documentation](./core-api.md)
3. Check out [UI Components Guide](./ui-components.md)
4. View [Examples](./examples/)