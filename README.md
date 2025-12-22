# OxyHQ Monorepo

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/OxyHQ/OxyHQServices)

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
│   ├── accounts/          # Oxy Accounts - Identity wallet app (React Native/Expo)
│   │   ├── app/          # App screens and navigation
│   │   ├── components/   # UI components
│   │   └── lib/          # Identity management logic
│   ├── services/          # @oxyhq/services - SDK for authentication & API access
│   │   ├── src/
│   │   │   ├── core/     # Core API client (platform-agnostic)
│   │   │   ├── crypto/   # Cryptographic operations (ECDSA, signatures)
│   │   │   ├── node/     # Node.js-specific exports (for backends)
│   │   │   └── ui/       # React Native UI components
│   │   ├── lib/          # Built output
│   │   └── docs/         # Documentation
│   ├── api/              # @oxyhq/api - Express.js backend
│   │   ├── src/
│   │   │   ├── controllers/  # Request handlers
│   │   │   ├── models/       # MongoDB models
│   │   │   ├── routes/       # API routes
│   │   │   └── services/     # Business logic
│   │   └── dist/         # Built output
│   └── test-app/         # Test application for SDK integration
├── package.json          # Root package.json with workspace configuration
└── README.md            # This file
```

## 🏗️ Architecture Overview

### Oxy Accounts (Identity Wallet)
The **Oxy Accounts** app is a self-custodial identity wallet built with React Native/Expo. It:
- Generates and securely stores ECDSA secp256k1 key pairs
- Never shares the private key (stored in device secure storage)
- Signs authentication challenges when users log into other apps
- Manages identity backup and recovery

**Key principle**: The user's private key never leaves their device.

### Oxy Services (SDK)
The **@oxyhq/services** package provides:
- **Core API Client**: Network communication with the Oxy backend
- **Crypto Module**: Shared cryptographic utilities (signature verification, key validation)
- **UI Components**: Pre-built components for "Sign in with Oxy" flows
- **Node.js Support**: Optimized exports for backend use

Third-party apps integrate this SDK to enable passwordless authentication via Oxy Accounts.

### Oxy API (Backend)
The **API** server handles:
- Challenge-response authentication (generates challenges, verifies signatures)
- User profile and session management
- Real-time updates via Socket.IO
- File storage and social features

The backend uses the shared crypto module from `@oxyhq/services/node` to ensure signature verification is consistent across the ecosystem.

## 🔐 Authentication Flow

1. **Third-party app** displays "Sign in with Oxy" button (QR code + deep link)
2. **User** scans QR or taps link, opening Oxy Accounts app
3. **Oxy Accounts** shows the requesting app and prompts user to approve
4. **User approves** → Accounts app signs a challenge with the private key
5. **API** verifies the signature and creates a session
6. **Third-party app** receives authentication confirmation and user data

This flow ensures the private key stays secure while enabling seamless cross-app authentication.

## 📁 Project Structure

```
├── packages/
│   ├── accounts/          # Oxy Accounts - Identity wallet app (React Native/Expo)
│   │   ├── app/          # App screens and navigation
│   │   ├── components/   # UI components
│   │   └── lib/          # Identity management logic
│   ├── services/          # @oxyhq/services - SDK for authentication & API access
│   │   ├── src/
│   │   │   ├── core/     # Core API client (platform-agnostic)
│   │   │   ├── crypto/   # Cryptographic operations (ECDSA, signatures)
│   │   │   ├── node/     # Node.js-specific exports (for backends)
│   │   │   └── ui/       # React Native UI components
│   │   ├── lib/          # Built output
│   │   └── docs/         # Documentation
│   ├── api/              # @oxyhq/api - Express.js backend
│   │   ├── src/
│   │   │   ├── controllers/  # Request handlers
│   │   │   ├── models/       # MongoDB models
│   │   │   ├── routes/       # API routes
│   │   │   └── services/     # Business logic
│   │   └── dist/         # Built output
│   └── test-app/         # Test application for SDK integration
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
