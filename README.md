# OxyHQ Monorepo

This monorepo contains all OxyHQ packages including services and API components.

## 📦 Packages

### [@oxyhq/services](./packages/services)
Reusable OxyHQ module to handle authentication, user management, karma system, device-based session management and more for React Native and Web applications.

### [@oxyhq/api](./packages/api)
Express.js API server with authentication, user management, real-time features using Socket.IO, and MongoDB integration.

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
│   ├── services/          # @oxyhq/services - React Native/Web library
│   │   ├── src/          # Source code
│   │   ├── lib/          # Built output
│   │   └── package.json  # Package configuration
│   └── api/              # @oxyhq/api - Express.js API server
│       ├── src/          # Source code
│       ├── dist/         # Built output
│       └── package.json  # Package configuration
├── package.json          # Root package.json with workspace configuration
└── README.md            # This file
```

## 🔧 Development Workflow

1. **Make changes** to any package in the `packages/` directory
2. **Build** the specific package or all packages
3. **Test** your changes
4. **Commit** using conventional commit format

## 📚 Documentation

- [Services Documentation](./packages/services/README.md)
- [API Documentation](./packages/api/README.md)

## 🤝 Contributing

Please read our [Contributing Guide](./packages/services/CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📄 License

This project is licensed under the MIT License - see the individual package LICENSE files for details.

## 🏢 About OxyHQ

Visit [oxy.so](https://oxy.so) to learn more about OxyHQ.
