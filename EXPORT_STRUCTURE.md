# Export Structure Guide

This document explains the export structure of the `@oxyhq/services` package and how to import components correctly.

## Package Export Paths

The package provides three main export paths:

### 1. Main Export (`@oxyhq/services`)
**Purpose**: Server-side usage (Node.js, Express)  
**Contents**: Core services and models only

```javascript
// CommonJS
const { OxyServices, Models } = require('@oxyhq/services');

// ES Modules
import { OxyServices, Models, User, LoginResponse } from '@oxyhq/services';
```

**Available exports:**
- `OxyServices` - Main service class
- `Models` - All TypeScript interfaces as namespace
- Individual model interfaces: `User`, `LoginResponse`, `Notification`, etc.

### 2. UI Export (`@oxyhq/services/ui`)
**Purpose**: Client-side UI components (React/React Native)  
**Contents**: UI components, context providers, and hooks

```javascript
import { 
  OxyProvider, 
  OxySignInButton, 
  OxyLogo, 
  Avatar, 
  FollowButton,
  useOxy,
  OxyContextProvider 
} from '@oxyhq/services/ui';
```

**Available exports:**
- `OxyProvider` - Main authentication provider
- `OxySignInButton` - Pre-styled sign-in button
- `OxyLogo` - Brand logo component
- `Avatar` - User avatar component
- `FollowButton` - Follow/unfollow button
- `FontLoader` - Font loading utilities
- `useOxy` - Authentication hook
- `OxyContextProvider` - Context provider
- Screen components: `SignInScreen`, `SignUpScreen`, `AccountCenterScreen`, etc.

### 3. Full Export (`@oxyhq/services/full`)
**Purpose**: Applications needing both core services and UI  
**Contents**: Everything from both main and UI exports

```javascript
import { 
  OxyServices,     // Core service
  OxyProvider,     // UI component
  Models,          // TypeScript models
  User             // Individual model
} from '@oxyhq/services/full';
```

## Migration Guide

If you were previously importing from `@oxyhq/services` and need UI components, update your imports:

### Before
```javascript
import { OxyProvider, OxySignInButton } from '@oxyhq/services';
```

### After
```javascript
// Option 1: UI only
import { OxyProvider, OxySignInButton } from '@oxyhq/services/ui';

// Option 2: Full package
import { OxyProvider, OxySignInButton } from '@oxyhq/services/full';
```

## Package.json Configuration

The export paths are configured in package.json:

```json
{
  "main": "lib/commonjs/node/index.js",
  "module": "lib/module/node/index.js",
  "types": "lib/typescript/node/index.d.ts",
  "exports": {
    ".": {
      "import": "./lib/module/node/index.js",
      "require": "./lib/commonjs/node/index.js",
      "types": "./lib/typescript/node/index.d.ts"
    },
    "./ui": {
      "import": "./lib/module/ui/index.js",
      "require": "./lib/commonjs/ui/index.js",
      "types": "./lib/typescript/ui/index.d.ts"
    },
    "./full": {
      "import": "./lib/module/index.js",
      "require": "./lib/commonjs/index.js",
      "types": "./lib/typescript/index.d.ts"
    }
  }
}
```

## Usage Examples

### Server-side (Express.js)
```javascript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
```

### React Native App
```javascript
import { OxyProvider, useOxy } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

function App() {
  return (
    <OxyProvider oxyServices={oxy}>
      <MyAppContent />
    </OxyProvider>
  );
}
```

### Full Stack App
```javascript
import { OxyServices, OxyProvider, Models } from '@oxyhq/services/full';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
```
