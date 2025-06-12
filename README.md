# OxyHQServices

A TypeScript client library for the Oxy API providing authentication, user management, and UI components for React and React Native applications.

## Features

- 🔐 **Authentication**: JWT-based auth with automatic token refresh
- 👥 **User Management**: Profile operations and social features
- 🎨 **UI Components**: Pre-built React components for common functionality
- 📱 **Cross-Platform**: Works in React Native and web applications
- 🔧 **TypeScript**: Full type safety and IntelliSense support

## Quick Start

```bash
npm install @oxyhq/services
```

```typescript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: 'http://localhost:3000'
});

// Authenticate
const response = await oxy.auth.login({
  email: 'user@example.com',
  password: 'password'
});

// Get current user
const user = await oxy.users.getCurrentUser();
```

## Documentation

For comprehensive documentation, API reference, and examples, visit the main project documentation:

- [📚 Full Documentation](../docs/README.md)
- [🚀 Quick Start Guide](../docs/quick-start.md)
- [🔐 Authentication Guide](../docs/authentication.md)
- [📖 OxyHQServices Guide](../docs/oxyhq-services.md)

## UI Components

Import and use pre-built React components:

```typescript
import { OxyProvider, Avatar, FollowButton } from '@oxyhq/services/ui';

function App() {
  return (
    <OxyProvider config={{ baseURL: 'http://localhost:3000' }}>
      <Avatar userId="123" size={40} />
      <FollowButton targetUserId="456" />
    </OxyProvider>
  );
}
- **Remote Session Management**: View and manage sessions across all devices
- **Enhanced Security**: No PII stored locally, server-side session validation
- **Cross-Platform Support**: Works with both web browsers and React Native apps

```typescript
import { DeviceManager, OxyServices } from '@oxyhq/services';

// Initialize device manager for fingerprinting
const deviceManager = new DeviceManager();
await deviceManager.initialize();

// Enhanced login with device fingerprinting
const oxyServices = new OxyServices(config);
const response = await oxyServices.secureLogin(username, password, {
  deviceFingerprint: await deviceManager.generateFingerprint()
});

// Manage device sessions
const deviceSessions = await oxyServices.getDeviceSessions(sessionId);
await oxyServices.logoutAllDeviceSessions(sessionId);
```

## Development

### Building the Library

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run tests
npm test
```

### Package Structure

```
src/
├── core/           # Core authentication and API client
├── ui/            # React components
├── models/        # TypeScript interfaces and types
├── utils/         # Utility functions
└── constants/     # Configuration constants
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Support

For issues, questions, or contributions, please refer to the main project documentation:

- [📚 Main Documentation](../docs/README.md)
- [❓ Troubleshooting Guide](../docs/troubleshooting.md)
- [🤝 Contributing Guidelines](../docs/contributing.md)
