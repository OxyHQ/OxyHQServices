# @oxyhq/services

A comprehensive TypeScript UI library for the Oxy API providing authentication, user management, and UI components for React Native and Expo applications.

> **For web apps (Vite, Next.js, CRA):** Use [`@oxyhq/auth`](../auth) for authentication and [`@oxyhq/core`](../core) for types and services.
>
> **For backend / Node.js:** Use [`@oxyhq/core`](../core) only.
>
> **For the full platform guide:** See [PLATFORM_GUIDE.md](./PLATFORM_GUIDE.md).

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Typography - Inter Font](#typography---inter-font)
- [Usage Patterns](#usage-patterns)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [UI Components](#ui-components)
- [Internationalization (i18n)](#internationalization-i18n)
- [Troubleshooting](#troubleshooting)
- [Requirements](#requirements)

## Features

- **Zero-Config Authentication**: Automatic token management and refresh
- **Cross-Domain SSO**: Sign in once, authenticated everywhere (FedCM, popup, redirect)
- **Universal Provider**: Single `OxyProvider` works on iOS, Android, and Expo Web
- **UI Components**: Pre-built components for auth, profiles, and more
- **Inter Font Included**: Default Oxy ecosystem font with automatic loading
- **Cross-Platform**: Works in Expo and React Native (iOS, Android, Web)
- **Multi-Session Support**: Manage multiple user sessions simultaneously
- **TypeScript First**: Full type safety and IntelliSense support
- **Performance Optimized**: Automatic caching with TanStack Query
- **Production Ready**: Error handling, retry logic, and security best practices

## Architecture

The OxyHQ SDK is split into three packages:

| Package | Use Case | Dependencies |
|---------|----------|--------------|
| `@oxyhq/services` | Expo / React Native apps | Full (RN, Expo) |
| `@oxyhq/auth` | Web apps (Vite, Next.js) | React only |
| `@oxyhq/core` | All platforms (types, API client, crypto) | None |

This package (`@oxyhq/services`) is for **Expo and React Native** applications. It provides `OxyProvider`, UI components, screens, bottom sheet routing, fonts, and hooks.

See [PLATFORM_GUIDE.md](./PLATFORM_GUIDE.md) for the complete architecture guide.

## Installation

```bash
npm install @oxyhq/services @oxyhq/core
```

### Peer Dependencies

To avoid duplicate native modules and ensure smooth integration across apps, install (or ensure your app already includes) the following peer dependencies:

- react: >=18, react-native: >=0.76
- react-native-reanimated: >=3.16, react-native-gesture-handler: >=2.16
- react-native-safe-area-context: ^5.4.0, react-native-svg: >=13
- Expo projects: expo, expo-font, expo-image, expo-linear-gradient
- Navigation (if you use the provided screens): @react-navigation/native


Example for Expo:
```bash
npm i react-native-reanimated react-native-gesture-handler react-native-safe-area-context react-native-svg \
  expo expo-font expo-image expo-linear-gradient @react-navigation/native
```

### React Native/Expo Setup

For React Native and Expo projects, add the polyfill import at the very top of your entry file:

```javascript
// index.js or App.js (very first line)
import 'react-native-url-polyfill/auto';
```

**Note**: This polyfill is already included in the package dependencies, but you need to import it to activate it.

## Quick Start

### Expo Apps (Native + Web)

```typescript
import { OxyProvider, useAuth } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}

function UserProfile() {
  const { user, isAuthenticated, signIn, signOut } = useAuth();

  if (!isAuthenticated) {
    return <Button onPress={() => signIn()} title="Sign In" />;
  }

  return (
    <View>
      <Text>Welcome, {user?.username}!</Text>
      <Button onPress={signOut} title="Sign Out" />
    </View>
  );
}
```

`OxyProvider` handles iOS, Android, and Expo web. Always use `OxyProvider` in Expo apps.

## Typography - Inter Font

**Inter is the default font for all Oxy ecosystem apps.** This package includes the Inter font family and provides automatic font loading for both web and native platforms.

### Automatic Loading

**If you are using `OxyProvider`, fonts are loaded automatically.** No additional setup needed:

```typescript
import { OxyProvider } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourAppContent />
    </OxyProvider>
  );
}
```

### Using Font Constants

```typescript
import { fontFamilies, fontStyles } from '@oxyhq/services';

const styles = StyleSheet.create({
  title: {
    ...fontStyles.titleLarge,  // Pre-defined style (54px, Bold)
    color: '#000000',
  },
  customText: {
    fontFamily: fontFamilies.interSemiBold,  // Cross-platform font family
    fontSize: 18,
  },
});
```

### Available Exports

- **`setupFonts()`** - Function to manually load fonts (called automatically by OxyProvider)
- **`fontFamilies`** - Object with all Inter weight variants (inter, interLight, interMedium, interSemiBold, interBold, interExtraBold, interBlack)
- **`fontStyles`** - Pre-defined text styles (titleLarge, titleMedium, titleSmall, buttonText)

See [FONTS.md](./FONTS.md) for the complete typography guide, including detailed usage examples, all available font weights, platform-specific handling, best practices, and migration guide.

## Usage Patterns

### 1. OxyProvider + useAuth Hook (Recommended)

`OxyProvider` works on all platforms (iOS, Android, Web). Use `useAuth` for authentication.

```typescript
import { OxyProvider, useAuth, OxySignInButton } from '@oxyhq/services';

// App.tsx - Setup the provider
function App() {
  return (
    <OxyProvider
      baseURL="https://api.oxy.so"
      onAuthStateChange={(user) => {
        console.log('Auth state changed:', user ? 'logged in' : 'logged out');
      }}
    >
      <YourApp />
    </OxyProvider>
  );
}

// Component.tsx - Use the hook
function UserProfile() {
  const { user, isAuthenticated, signIn, signOut, isLoading } = useAuth();

  if (isLoading) return <ActivityIndicator />;

  if (!isAuthenticated) {
    return (
      <View>
        <Text>Welcome! Please sign in.</Text>
        <OxySignInButton />
        {/* Or use signIn() directly: */}
        <Button onPress={() => signIn()} title="Sign In" />
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.title}>Welcome, {user?.username}!</Text>
      <Button onPress={signOut} title="Sign Out" />
    </View>
  );
}
```

### 2. Direct Import (Non-React Files)

For utility functions, services, or non-React Native files:

```typescript
import { oxyClient } from '@oxyhq/core';

// utils/api.ts
export const userUtils = {
  async fetchUserById(userId: string) {
    return await oxyClient.getUserById(userId);
  },

  async fetchProfileByUsername(username: string) {
    return await oxyClient.getProfileByUsername(username);
  },

  async updateUserProfile(updates: any) {
    return await oxyClient.updateProfile(updates);
  }
};
```

### 3. Mixed Usage (Hooks + Direct Client)

You can use both hooks and the direct client in the same Expo app:

```typescript
// App.tsx - React Native setup
import { OxyProvider } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://cloud.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}

// utils/api.ts - Direct import
import { oxyClient } from '@oxyhq/core';

export const apiUtils = {
  async fetchData() {
    return await oxyClient.getCurrentUser();
  }
};

// Component.tsx - React Native hook
import { useOxy } from '@oxyhq/services';

function Component() {
  const { oxyServices } = useOxy();
  // Both oxyServices and oxyClient share the same tokens
}
```

## API Reference

### Core Exports (from @oxyhq/core)

```typescript
import {
  OxyServices,           // Main service class
  oxyClient,            // Pre-configured instance
  OXY_CLOUD_URL,        // Default API URL
  OxyAuthenticationError,
  OxyAuthenticationTimeoutError,
  KeyManager,
  SignatureService,
  RecoveryPhraseService
} from '@oxyhq/core';
```

### React Native Exports (from @oxyhq/services)

```typescript
import {
  OxyProvider,          // Context provider
  useOxy,              // React Native hook
  useAuth,             // Auth hook
  OxySignInButton,     // UI components
  Avatar,
  FollowButton
} from '@oxyhq/services';
```

### OxyServices Methods

```typescript
// Authentication (Public Key Based)
await oxyClient.register(publicKey, username, signature, timestamp, email?);
await oxyClient.requestChallenge(publicKey);
await oxyClient.verifyChallenge(publicKey, challenge, signature, timestamp, deviceName?, deviceFingerprint?);
await oxyClient.checkPublicKeyRegistered(publicKey);
await oxyClient.getUserByPublicKey(publicKey);

// User Management
const user = await oxyClient.getCurrentUser();                    // Get current user
const userById = await oxyClient.getUserById('user123');          // Get user by ID
const profileByUsername = await oxyClient.getProfileByUsername('john_doe'); // Get profile by username
await oxyClient.updateProfile({ name: 'John Doe' });             // Update current user
await oxyClient.updateUser('user123', { name: 'John' });         // Update user by ID (admin)

// Session Management
const userBySession = await oxyClient.getUserBySession('session123'); // Get user by session
const sessions = await oxyClient.getSessionsBySessionId('session123'); // Get all sessions
await oxyClient.logoutSession('session123');                     // Logout specific session
await oxyClient.logoutAllSessions('session123');                 // Logout all sessions

// Social Features
await oxyClient.followUser('user123');                           // Follow user
await oxyClient.unfollowUser('user123');                         // Unfollow user
const followStatus = await oxyClient.getFollowStatus('user123'); // Check follow status
const followers = await oxyClient.getUserFollowers('user123');   // Get user followers
const following = await oxyClient.getUserFollowing('user123');   // Get user following

// Notifications
const notifications = await oxyClient.getNotifications();        // Get notifications
const unreadCount = await oxyClient.getUnreadCount();            // Get unread count
await oxyClient.markNotificationAsRead('notification123');       // Mark as read
await oxyClient.markAllNotificationsAsRead();                    // Mark all as read
await oxyClient.deleteNotification('notification123');           // Delete notification

// File Management
const fileData = await oxyClient.uploadFile(file);                     // Upload file
const file = await oxyClient.getFile('file123');                       // Get file info
await oxyClient.deleteFile('file123');                                 // Delete file
const downloadUrl = oxyClient.getFileDownloadUrl('file123', 'thumb'); // Get download/stream URL
const userFiles = await oxyClient.listUserFiles('user123');            // List user files

// Payments
const payment = await oxyClient.createPayment(paymentData);      // Create payment
const paymentInfo = await oxyClient.getPayment('payment123');    // Get payment info
const userPayments = await oxyClient.getUserPayments();          // Get user payments

// Karma System
const karma = await oxyClient.getUserKarma('user123');           // Get user karma
await oxyClient.giveKarma('user123', 10, 'helpful comment');     // Give karma
const karmaTotal = await oxyClient.getUserKarmaTotal('user123'); // Get karma total
const karmaHistory = await oxyClient.getUserKarmaHistory('user123'); // Get karma history
const leaderboard = await oxyClient.getKarmaLeaderboard();       // Get leaderboard
const rules = await oxyClient.getKarmaRules();                   // Get karma rules

// Location Services
await oxyClient.updateLocation(40.7128, -74.0060);              // Update location
const nearby = await oxyClient.getNearbyUsers(1000);             // Get nearby users

// Analytics
await oxyClient.trackEvent('user_action', { action: 'click' });  // Track event
const analytics = await oxyClient.getAnalytics('2024-01-01', '2024-01-31'); // Get analytics

// Device Management
await oxyClient.registerDevice(deviceData);                      // Register device
const devices = await oxyClient.getUserDevices();                // Get user devices
await oxyClient.removeDevice('device123');                       // Remove device
const deviceSessions = await oxyClient.getDeviceSessions('session123'); // Get device sessions
await oxyClient.logoutAllDeviceSessions('session123');           // Logout device sessions
await oxyClient.updateDeviceName('session123', 'iPhone 15');     // Update device name

// Utilities
const metadata = await oxyClient.fetchLinkMetadata('https://example.com'); // Fetch link metadata
```

### useOxy Hook

```typescript
const {
  // Service instance
  oxyServices,

  // Authentication state
  user,
  isAuthenticated,
  isLoading,
  error,

  // Identity management (Public Key Authentication)
  createIdentity,     // Create new identity with recovery phrase
  importIdentity,     // Import identity from recovery phrase
  signIn,             // Sign in with stored identity
  hasIdentity,        // Check if identity exists on device
  getPublicKey,       // Get stored public key

  // Session management
  logout,

  // Session management
  sessions,
  activeSessionId,
  switchSession,
  removeSession
} = useOxy();
```

## Configuration

### OxyProvider Props

```typescript
<OxyProvider
  baseURL="https://api.oxy.so"           // API base URL
  storageKeyPrefix="oxy_session"          // Storage key prefix
  onAuthStateChange={(user) => {}}        // Auth state callback
  onError={(error) => {}}                 // Error callback
>
  {children}
</OxyProvider>
```

### Environment Variables

```bash
# .env
EXPO_PUBLIC_API_URL=https://api.oxy.so
```

### Custom Configuration

```typescript
import { OxyServices } from '@oxyhq/core';

const oxy = new OxyServices({
  baseURL: process.env.OXY_API_URL || 'https://cloud.oxy.so'
});
```

## Authentication

Oxy supports **public/private key cryptography** (ECDSA secp256k1) as the primary identity system, with optional password-based accounts for the web gateway. Users manage their cryptographic identity in the **Oxy Accounts** app, and other apps can integrate "Sign in with Oxy" for seamless authentication.

### Public Key Authentication

```typescript
import { useOxy } from '@oxyhq/services';

function AuthScreen() {
  const { createIdentity, importIdentity, signIn, hasIdentity } = useOxy();

  // Create new identity (in Oxy Accounts app)
  const handleCreate = async () => {
    const { user, recoveryPhrase } = await createIdentity('username', 'email');
    // Show recoveryPhrase to user - they must save it!
  };

  // Import existing identity
  const handleImport = async (phrase: string) => {
    const user = await importIdentity(phrase, 'username', 'email');
  };

  // Sign in with stored identity
  const handleSignIn = async () => {
    const user = await signIn();
  };

  // Check if identity exists
  const hasStoredIdentity = await hasIdentity();
}
```

### Password Authentication (Web Gateway)

For web-only or legacy flows, Oxy also supports password sign-in (email/username + password). Use the auth gateway (`/login`, `/signup`, `/recover`) for browser-based flows, or call the API directly:

```typescript
import { oxyClient } from '@oxyhq/core';

const session = await oxyClient.signUp('username', 'email@example.com', 'password');
const session2 = await oxyClient.signIn('username-or-email', 'password');
```

### Cross-App Authentication (Sign in with Oxy)

For third-party apps that want to allow users to sign in with their Oxy identity:

```typescript
import { OxySignInButton } from '@oxyhq/services';

function LoginScreen() {
  return <OxySignInButton variant="contained" />;
}
```

This displays:
- A QR code that users can scan with Oxy Accounts
- A button to open Oxy Accounts directly via deep link

Web fallback: send users to the auth gateway at `https://accounts.oxy.so/authorize?token=...` to approve the session.

### Documentation

See [Complete Public Key Authentication Guide](./docs/PUBLIC_KEY_AUTHENTICATION.md) for architecture, concepts, user flows, developer integration, crypto module API reference, security best practices, and migration from password auth.

## UI Components

### Built-in Components

```typescript
import {
  OxySignInButton,
  Avatar,
  FollowButton,
  OxyLogo
} from '@oxyhq/services';

function MyComponent() {
  return (
    <View style={styles.container}>
      <OxyLogo />
      <Avatar userId="user123" size={40} />
      <FollowButton userId="user123" />
      <OxySignInButton />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
});
```

### Bottom Sheet Routing System

The bottom sheet routing system provides a clean, professional way to display authentication screens, account management, and other UI flows within a modal bottom sheet.

**Quick Example:**

```typescript
import { useOxy } from '@oxyhq/services';

function MyComponent() {
  const { showBottomSheet } = useOxy();

  return (
    <Button
      onPress={() => showBottomSheet('OxyAuth')}
      title="Sign in with Oxy"
    />
  );
}
```

**Features:**
- Full navigation history with back button support
- Step-based screen navigation (multi-step flows)
- Keyboard-aware (automatically adjusts for keyboard)
- Dynamic sizing (fits content automatically)
- Type-safe route names
- 25+ pre-built screens available

**Available Screens:**
- `OxyAuth` (Sign in with Oxy - for third-party apps)
- `AccountOverview`, `AccountSettings`, `AccountCenter`
- `Profile`, `SessionManagement`, `PaymentGateway`
- And many more...

**Documentation:**
For complete documentation, see [Bottom Sheet Routing Guide](./docs/BOTTOM_SHEET_ROUTING.md).

### Using OxyRouter in Your Own UI (Legacy)

> The legacy bottom sheet component has been removed. Use the new `showBottomSheet()` API instead (see above).

```typescript
import { Modal } from 'react-native';
import { useOxy, OxyRouter } from '@oxyhq/services';

function AuthModal({ visible, onRequestClose }: { visible: boolean; onRequestClose: () => void }) {
  const { oxyServices } = useOxy();

  if (!visible || !oxyServices) return null;

  return (
    <Modal visible onRequestClose={onRequestClose} animationType="slide">
      <OxyRouter
        oxyServices={oxyServices}
        initialScreen="OxyAuth"
        onClose={onRequestClose}
        onAuthenticated={onRequestClose}
        theme="light"
        containerWidth={360}
      />
    </Modal>
  );
}
```

## Internationalization (i18n)

OxyHQ Services includes built-in language selection and storage. The selected language can be accessed and synced with your app's i18n system.

### Getting Current Language

```typescript
import { useOxy } from '@oxyhq/services';

function MyComponent() {
  const {
    currentLanguage,           // 'en-US'
    currentLanguageName,       // 'English'
    currentNativeLanguageName, // 'Espanol' (if Spanish is selected)
    currentLanguageMetadata    // Full metadata object
  } = useOxy();

  return <Text>Current language: {currentLanguageName}</Text>;
}
```

### Syncing with Your i18n Library

To integrate with react-i18next, i18n-js, next-intl, or other i18n libraries, see the comprehensive guide:

See [Complete i18n Integration Guide](./I18N_INTEGRATION.md) for step-by-step integration with popular i18n libraries, bidirectional sync between services and your i18n system, language code format conversion utilities, and complete working examples.

### Using OxyServices (Non-React)

```typescript
import { OxyServices } from '@oxyhq/core';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Get current language code
const languageCode = await oxy.getCurrentLanguage();

// Get language name
const languageName = await oxy.getCurrentLanguageName();

// Get full metadata
const metadata = await oxy.getCurrentLanguageMetadata();
```

### Language Utilities

```typescript
import {
  SUPPORTED_LANGUAGES,
  getLanguageName,
  getLanguageMetadata
} from '@oxyhq/services';

// Get all supported languages
const languages = SUPPORTED_LANGUAGES;

// Get language name from code
const name = getLanguageName('es-ES'); // 'Spanish'

// Get full metadata
const metadata = getLanguageMetadata('es-ES');
// { id: 'es-ES', name: 'Spanish', nativeName: 'Espanol', flag: '...', ... }
```

## Troubleshooting

### Common Issues

#### 1. "useOxy must be used within an OxyContextProvider"

**Solution**: Wrap your app with `OxyProvider`

```typescript
import { OxyProvider } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://cloud.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

#### 2. FormData Issues in React Native/Expo

**Solution**: Add polyfill import at the very top of your entry file

```javascript
// index.js or App.js (very first line)
import 'react-native-url-polyfill/auto';
```

**Why needed**: Your app uses file uploads which require `FormData`. React Native with Hermes engine does not include `FormData` natively, so it needs to be polyfilled.

#### 3. Authentication Not Persisting

**Solution**: Check storage configuration

```typescript
<OxyProvider
  baseURL="https://api.oxy.so"
  storageKeyPrefix="my_app_oxy"  // Custom storage key
>
  {children}
</OxyProvider>
```

### Error Handling

```typescript
import { OxyAuthenticationError } from '@oxyhq/core';

try {
  await oxyClient.getCurrentUser();
} catch (error) {
  if (error instanceof OxyAuthenticationError) {
    // Handle authentication errors
    console.log('Auth error:', error.message);
  } else {
    // Handle other errors
    console.log('Other error:', error.message);
  }
}
```

## Requirements

- **React Native**: 0.76+ (for mobile components)
- **Expo**: 54+ (recommended)
- **TypeScript**: 4.0+ (optional but recommended)

### Peer Dependencies

For React Native/Expo projects:

```bash
npm install axios jwt-decode invariant
```

**Note**: `react-native-url-polyfill` is already included as a dependency in this package.

## Examples

### Complete React Native App

```typescript
// App.tsx
import { OxyProvider } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://cloud.oxy.so">
      <UserDashboard />
    </OxyProvider>
  );
}

// UserDashboard.tsx
import { useOxy } from '@oxyhq/services';
import { View, Text, StyleSheet } from 'react-native';

function UserDashboard() {
  const { user, isAuthenticated, oxyServices } = useOxy();

  const [followers, setFollowers] = useState([]);

  useEffect(() => {
    if (isAuthenticated && user) {
      oxyServices.getUserFollowers(user.id).then(setFollowers);
    }
  }, [isAuthenticated, user]);

  if (!isAuthenticated) {
    return <Text>Please sign in</Text>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome, {user?.name}!</Text>
      <Text>Followers: {followers.length}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
});
```

---

## Documentation

Comprehensive documentation is available in the `/docs` directory:

- **[Getting Started](./GET_STARTED.md)** - Quick start guide for new developers
- **[Platform Guide](./PLATFORM_GUIDE.md)** - Platform-specific setup guide
- **[CROSS_DOMAIN_AUTH.md](../../CROSS_DOMAIN_AUTH.md)** - SSO deep dive

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
