# OxyHQ Services

A comprehensive monorepo for the Oxy ecosystem including authentication, user management, cross-platform services, and API infrastructure.

## 📚 Documentation

All documentation is organized in the [docs/](docs/) folder:

- **[Cross-Domain Authentication](docs/CROSS_DOMAIN_AUTH.md)** - Web SSO with FedCM guide
- **[Expo 54 Universal Apps](docs/EXPO_54_GUIDE.md)** - iOS, Android, Web with one codebase
- **[Font Migration](docs/FONT_MIGRATION.md)** - Inter font migration summary
- **[Services Package](packages/services/README.md)** - Main package documentation
- **[Typography Guide](packages/services/FONTS.md)** - Inter font usage

## 📦 Packages

### [@oxyhq/services](packages/services/)
Main TypeScript client library for Oxy API with:
- Zero-config authentication
- Cross-domain SSO
- Universal provider (iOS, Android, Web)
- UI components
- Inter font (default Oxy ecosystem typography)

### [@oxyhq/api](packages/api/)
Node.js/Express API server with:
- User management
- Session handling
- FedCM identity provider
- Asset management

## 🚀 Quick Start

### Install Services Package

```bash
npm install @oxyhq/services
```

### Use in Your App

```typescript
import { OxyProvider, useAuth } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

See [packages/services/README.md](packages/services/README.md) for complete documentation.

## 🎨 Typography

Inter is the default font for all Oxy ecosystem apps. It's included in `@oxyhq/services` and loads automatically.

See [packages/services/FONTS.md](packages/services/FONTS.md) for usage guide.

## 📄 License

MIT © OxyHQ
