# OxyHQServices

A TypeScript client library for the Oxy API providing **zero-config** authentication, user management, and UI components for React and React Native applications.

## ✨ Zero-Config Quick Start

### Frontend (React/Next.js) - 2 lines of code:

```jsx
import { OxyZeroConfigProvider, useOxyZeroConfig } from '@oxyhq/services/ui';

// 1. Wrap your app
function App() {
  return (
    <OxyZeroConfigProvider>
      <YourApp />
    </OxyZeroConfigProvider>
  );
}

// 2. Use authentication anywhere
function Dashboard() {
  const { user, login, logout, isAuthenticated } = useOxyZeroConfig();
  
  if (isAuthenticated) {
    return <div>Welcome {user.username}! <button onClick={logout}>Logout</button></div>;
  }
  
  return <button onClick={() => login('user', 'password')}>Login</button>;
}
```

### Backend (Express.js) - 1 line of code:

```js
import express from 'express';
import { createOxyAuth } from '@oxyhq/services/node';

const app = express();

// Zero-config auth - req.user automatically available
app.use('/api', createOxyAuth());

app.get('/api/profile', (req, res) => {
  res.json({ user: req.user }); // req.user populated automatically!
});
```

**That's it!** No complex configuration, no manual token management, no middleware setup.

## Table of Contents

- [Zero-Config Guide](#-zero-config-quick-start)  
- [Features](#features)
- [Installation](#installation)
- [Complete Examples](#complete-examples)
- [Advanced Usage](#advanced-usage)
- [Documentation](#documentation)
- [Migration Guide](#migration-guide)

## Features

- 🚀 **Zero-Config**: Get authentication working in 2-3 lines of code
- 🔐 **Automatic Token Management**: Tokens saved, restored, and refreshed automatically
- 👥 **User Management**: Profile operations and social features
- 🎨 **UI Components**: Pre-built React components for common functionality  
- 📱 **Cross-Platform**: Works in React Native and web applications
- 🔧 **TypeScript**: Full type safety and IntelliSense support
- 🔄 **Auto Backend Integration**: Frontend automatically sends tokens to backend
- 📦 **Express Middleware**: One-line backend authentication with `req.user` support

## Installation

```bash
npm install @oxyhq/services
```

## Complete Examples

### React Application

**App.js**
```jsx
import React from 'react';
import { OxyZeroConfigProvider } from '@oxyhq/services/ui';
import Dashboard from './Dashboard';

export default function App() {
  return (
    <OxyZeroConfigProvider>
      <Dashboard />
    </OxyZeroConfigProvider>
  );
}
```

**Dashboard.js**
```jsx
import React from 'react';
import { useOxyZeroConfig } from '@oxyhq/services/ui';

export default function Dashboard() {
  const { user, login, logout, isAuthenticated, isLoading } = useOxyZeroConfig();

  if (isLoading) return <div>Loading...</div>;

  if (!isAuthenticated) {
    return (
      <div>
        <h1>Please log in</h1>
        <button onClick={() => login('demo', 'password')}>Login</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Welcome, {user.username}!</h1>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### Express.js Backend

**server.js**
```js
import express from 'express';
import { createOxyAuth } from '@oxyhq/services/node';

const app = express();
app.use(express.json());

// Public routes
app.get('/', (req, res) => {
  res.json({ message: 'Public endpoint' });
});

// Protected routes - zero config!
app.use('/api', createOxyAuth());

// req.user is automatically available
app.get('/api/profile', (req, res) => {
  res.json({ 
    message: `Hello ${req.user.username}!`,
    user: req.user 
  });
});

app.listen(3000, () => console.log('Server running on port 3000'));
```

### Next.js Full-Stack

**pages/_app.js**
```jsx
import { OxyZeroConfigProvider } from '@oxyhq/services/ui';

export default function App({ Component, pageProps }) {
  return (
    <OxyZeroConfigProvider>
      <Component {...pageProps} />
    </OxyZeroConfigProvider>
  );
}
```

**pages/api/user.js**
```js
import { createOxyAuth } from '@oxyhq/services/node';

const auth = createOxyAuth();

export default async function handler(req, res) {
  // Apply authentication
  await new Promise((resolve, reject) => {
    auth(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // req.user is now available
  res.json({ user: req.user });
}
```

## Advanced Usage

### Configuration Options

**Frontend**
```jsx
<OxyZeroConfigProvider
  apiUrl="https://your-api.com"
  onAuthChange={(user) => console.log('Auth changed:', user)}
>
  <App />
</OxyZeroConfigProvider>
```

**Backend**
```js
app.use('/api', createOxyAuth({
  baseURL: 'https://your-oxy-api.com',
  loadUser: true,
  publicPaths: ['/api/health'],
  onError: (error, req, res) => {
    res.status(error.status).json({ error: error.message });
  }
}));
```

### Direct API Access

```jsx
import { useOxyApi } from '@oxyhq/services/ui';

function ProfileForm() {
  const api = useOxyApi();

  const updateProfile = async (data) => {
    const user = await api.updateProfile(data);
    // Token automatically included in request
  };

  return <button onClick={() => updateProfile({ name: 'New Name' })}>Update</button>;
}
```

### Optional Authentication

```js
import { createOptionalOxyAuth } from '@oxyhq/services/node';

// Works with or without authentication
app.use('/api/content', createOptionalOxyAuth());

app.get('/api/content', (req, res) => {
  if (req.user) {
    res.json({ content: 'personalized', user: req.user });
  } else {
    res.json({ content: 'public' });
  }
});
```

## Documentation

### Zero-Config Guide
- **[🚀 Zero-Config Setup Guide](./docs/zero-config.md)** - Complete guide with examples

### Advanced Documentation  
- **[📚 Full Documentation](./docs/README.md)** - Complete system documentation
- **[🚀 Quick Start Guide](./docs/quick-start.md)** - Traditional setup guide
- **[🔐 Core API Reference](./docs/core-api.md)** - Detailed API documentation
- **[💼 Integration Examples](./docs/examples/)** - More integration examples

### UI Components
- **[🎨 UI Components Guide](./docs/ui-components.md)** - React/RN component usage

## Migration Guide

### From Complex Setup

**Before (complex setup):**
```jsx
import { OxyProvider, useOxy } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({ baseURL: 'http://localhost:3001' });

function App() {
  return (
    <OxyProvider oxyServices={oxy}>
      <Dashboard />
    </OxyProvider>
  );
}
```

**After (zero-config):**
```jsx
import { OxyZeroConfigProvider, useOxyZeroConfig } from '@oxyhq/services/ui';

function App() {
  return (
    <OxyZeroConfigProvider>
      <Dashboard />
    </OxyZeroConfigProvider>
  );
}
```

Just change the provider and hook names - the API is nearly identical!

### Package Exports

The library provides multiple entry points for different use cases:

```typescript
// Zero-config frontend
import { OxyZeroConfigProvider, useOxyZeroConfig } from '@oxyhq/services/ui';

// Zero-config backend
import { createOxyAuth } from '@oxyhq/services/node';

// Core services only (traditional)
import { OxyServices } from '@oxyhq/services';

// Full package (Core + UI + Node)
import { OxyServices, OxyProvider, createOxyAuth } from '@oxyhq/services/full';
```

## Requirements

- **Node.js** 16+ (for backend usage)
- **React** 16.8+ (for React components)  
- **React Native** 0.60+ (for mobile components)
- **TypeScript** 4.0+ (optional but recommended)

## Troubleshooting

### Common Issues

**"useOxyZeroConfig must be used within an OxyZeroConfigProvider"**
- Make sure your component is wrapped with `<OxyZeroConfigProvider>`

**"req.user is undefined"**
- Ensure the middleware is applied: `app.use('/api', createOxyAuth())`
- Check that the client sends `Authorization: Bearer <token>` header

**FormData Issues in React Native/Expo**  
Add this import as the first line of your app entry file:
```js
import 'react-native-url-polyfill/auto';
```

### Getting Help

1. Check the [Zero-Config Guide](./docs/zero-config.md) for complete examples
2. Review [Troubleshooting Guide](./docs/troubleshooting.md) for common issues  
3. Open an issue on [GitHub](https://github.com/oxyhq/services/issues)

## Development

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run tests  
npm test
```

## Integration

This library works with:
- **[Oxy API](../api/)** - The companion authentication server
- **Express.js** - Built-in zero-config middleware support  
- **React/React Native** - Zero-config UI components and hooks
- **Next.js** - SSR/SSG authentication support

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
