# OxyHQ Services Documentation

Complete documentation for the Oxy ecosystem: identity, authentication, and services.

## 📚 Documentation Index

### Architecture (Start Here)
- **[Architecture Overview](ARCHITECTURE.md)** - Complete system architecture, identity vs auth, user linking

### Getting Started
- **[Main README](../README.md)** - Project overview and quick start
- **[Services Package](../packages/services/README.md)** - Main @oxyhq/services package docs

### Authentication
- **[Cross-Domain Authentication](CROSS_DOMAIN_AUTH.md)** - Web SSO using FedCM, popup, and redirect flows
- **[Public Key Authentication](../packages/services/docs/PUBLIC_KEY_AUTHENTICATION.md)** - Cryptographic identity system

### Platform Guides
- **[Expo 54 Universal Guide](EXPO_54_GUIDE.md)** - Building universal apps (iOS, Android, Web) with Expo 54
- **[Platform Guide](../packages/services/PLATFORM_GUIDE.md)** - Platform-specific usage

### Typography & Design
- **[Font Migration Guide](FONT_MIGRATION.md)** - Phudu → Inter migration complete summary
- **[Services Typography](../packages/services/FONTS.md)** - Complete Inter font usage guide

### API & Backend
- **[API Package](../packages/api/README.md)** - Backend API documentation
- **[Services Changelog](../packages/services/CHANGELOG.md)** - Version history and breaking changes

## 🎯 Quick Links by Use Case

### Understanding the Architecture
1. Start with [Architecture Overview](ARCHITECTURE.md) to understand:
   - Identity vs Authentication separation
   - How the phone IS the password
   - User linking (multiple auth methods → one account)

### Building a New App
1. Read [Architecture Overview](ARCHITECTURE.md) for system design
2. Follow [Expo 54 Guide](EXPO_54_GUIDE.md) for universal apps
3. Check [Services Package](../packages/services/README.md) for API usage

### Adding SSO to Existing Web App
1. Read [Cross-Domain Auth](CROSS_DOMAIN_AUTH.md)
2. Install `@oxyhq/services`
3. Use `<WebOxyProvider>` for pure React/Next.js apps

### Implementing Identity (Accounts App Only)
1. Read [Public Key Authentication](../packages/services/docs/PUBLIC_KEY_AUTHENTICATION.md)
2. Use `@oxyhq/services/crypto` for KeyManager, SignatureService
3. Store identity using expo-secure-store (native only)

## 📖 Documentation Structure

```
OxyHQServices/
├── README.md                          # Main project readme
├── docs/                              # 📁 Central documentation
│   ├── README.md                      # This file (documentation index)
│   ├── ARCHITECTURE.md               # 🏗️ Complete architecture guide
│   ├── CROSS_DOMAIN_AUTH.md          # Cross-domain SSO guide
│   ├── EXPO_54_GUIDE.md              # Expo 54 universal app guide
│   └── FONT_MIGRATION.md             # Font migration summary
├── packages/
│   ├── accounts/                      # 🔐 Identity wallet (native only)
│   ├── services/                      # 📦 @oxyhq/services package
│   │   ├── README.md                  # Package documentation
│   │   ├── docs/                      # Detailed package docs
│   │   │   ├── ARCHITECTURE.md        # Package architecture
│   │   │   └── PUBLIC_KEY_AUTHENTICATION.md  # Crypto docs
│   │   └── src/
│   │       ├── core/                  # API client, AuthManager
│   │       ├── web/                   # WebOxyProvider (no RN deps)
│   │       ├── native/                # OxyProvider (Expo/RN)
│   │       ├── crypto/                # Signing (NOT key storage)
│   │       └── shared/                # Platform-agnostic utils
│   └── api/                           # 🖥️ Backend API server
│       └── README.md                  # API documentation
```

## 🔑 Key Concepts

| Concept | Location | Description |
|---------|----------|-------------|
| Identity | accounts app only | Private key storage (device = password) |
| AuthManager | @oxyhq/services/core | Token management, session handling |
| SignatureService | @oxyhq/services/crypto | Sign/verify (NOT key storage) |
| User Linking | api.oxy.so | Multiple auth methods → one account |
| FedCM | @oxyhq/services/web | Browser-native SSO |

## 🤝 Contributing

See individual package READMEs for contribution guidelines.

## 📄 License

MIT © OxyHQ
