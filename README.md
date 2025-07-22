# OxyHQ Monorepo

This monorepo contains all OxyHQ packages including services and API components, now with **zero-configuration** authentication for seamless frontend/backend integration.

## ✨ Zero-Config Quick Start

### Frontend + Backend in 3 lines of code:

**Frontend (React/Next.js):**
```jsx
import { OxyZeroConfigProvider, useOxyZeroConfig } from '@oxyhq/services/ui';

// 1. Wrap your app
function App() {
  return (
    <OxyZeroConfigProvider>
      <Dashboard />
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

**Backend (Express.js):**
```js
import { createOxyAuth } from '@oxyhq/services/node';

const app = express();

// Zero-config auth - req.user automatically available
app.use('/api', createOxyAuth());

app.get('/api/profile', (req, res) => {
  res.json({ user: req.user }); // req.user populated automatically!
});
```

**That's it!** No configuration files, no manual token management, no complex setup.

## 📦 Packages

### [@oxyhq/services](./packages/services) - Zero-Config Frontend & Backend Library
- **Zero-config authentication** for React/React Native and Express.js
- **Automatic token management** - tokens saved, restored, and refreshed automatically
- **One-line backend integration** - `req.user` available with single middleware
- **Cross-platform support** - Works with React, React Native, Next.js, Express.js
- **Type-safe** - Full TypeScript support with IntelliSense

**New Zero-Config Features:**
- Frontend: `OxyZeroConfigProvider` + `useOxyZeroConfig()` hook
- Backend: `createOxyAuth()` middleware provides automatic `req.user` population
- No manual token handling required anywhere

### [@oxyhq/api](./packages/api) - Authentication API Server
Express.js API server with authentication, user management, real-time features using Socket.IO, and MongoDB integration that powers the zero-config authentication.

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation

```bash
# Install all dependencies for all packages
npm install

# Or install dependencies for all workspaces
npm run install:all
```

### Development

```bash
# Build all packages
npm run build

# Run tests for all packages
npm run test

# Clean all packages
npm run clean
```

### Package-specific Commands

#### Services Package
```bash
# Build services package
npm run services:build

# Test services package  
npm run services:test
```

#### API Package
```bash
# Start API in development mode
npm run api:dev

# Build API
npm run api:build

# Start API in production mode
npm run api:start
```

## 📁 Project Structure

```
├── packages/
│   ├── services/          # @oxyhq/services - Zero-config React Native/Web + Node.js library
│   │   ├── src/
│   │   │   ├── ui/        # React/React Native components and hooks
│   │   │   │   └── zero-config/  # Zero-config provider and hooks
│   │   │   ├── node/      # Express.js middleware and utilities  
│   │   │   └── core/      # Core authentication services
│   │   └── lib/           # Built output
│   └── api/               # @oxyhq/api - Express.js authentication server
│       ├── src/           # Source code
│       └── dist/          # Built output
├── examples/              # Working examples
│   └── zero-config-example/  # Complete React + Express zero-config demo
├── package.json           # Root package.json with workspace configuration  
└── README.md             # This file
```

## 🎯 Live Example

Check out the complete working example in [`examples/zero-config-example/`](./examples/zero-config-example/):

1. **Start the API server:**
   ```bash
   npm run api:dev
   ```

2. **Start the example backend:**
   ```bash
   cd examples/zero-config-example/backend
   npm install && npm start
   ```

3. **Start the example frontend:**
   ```bash
   cd examples/zero-config-example/frontend  
   npm install && npm start
   ```

4. **Visit http://localhost:3000** and see zero-config authentication in action!

## 🔧 Development Workflow

1. **Make changes** to any package in the `packages/` directory
2. **Build** the specific package or all packages
3. **Test** your changes
4. **Commit** using conventional commit format

## 📖 Documentation

### Zero-Config Guides
- [🚀 Zero-Config Setup Guide](./packages/services/docs/zero-config.md) - Complete zero-config documentation
- [📝 Quick Start Guide](./packages/services/docs/quick-start.md) - Get started in 2 minutes

### Package Documentation
- [Services Documentation](./packages/services/README.md) - Frontend/backend library docs
- [API Documentation](./packages/api/README.md) - Authentication server docs

### Migration
- [Migration from Complex Setup](./packages/services/docs/zero-config.md#migration-guide) - Easy migration guide

## ✨ Key Features

### Frontend Zero-Config
- **One provider wrapper:** `<OxyZeroConfigProvider>`
- **One hook:** `useOxyZeroConfig()` for all auth state
- **Automatic token management:** Save/restore/refresh happens automatically
- **Error handling:** Built-in error states and recovery
- **Cross-platform:** Same API for React, React Native, Next.js

### Backend Zero-Config  
- **One middleware:** `createOxyAuth()` provides automatic `req.user`
- **No configuration:** Works with environment variables or defaults
- **Automatic token validation:** JWT validation built-in
- **User data injection:** Full user object available in `req.user`
- **Error handling:** Built-in auth error responses

### Developer Experience
- **Type safety:** Full TypeScript support with IntelliSense
- **Hot reload friendly:** Works with development servers
- **Testing friendly:** Easy to mock and test
- **Documentation:** Comprehensive guides and examples

## 🤝 Contributing

Please read our [Contributing Guide](./packages/services/CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📄 License

This project is licensed under the MIT License - see the individual package LICENSE files for details.

## 🏢 About OxyHQ

Visit [oxy.so](https://oxy.so) to learn more about OxyHQ.
