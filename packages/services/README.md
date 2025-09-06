# OxyHQServices

A comprehensive TypeScript client library for the Oxy API providing authentication, user management, and UI components for React Native, Expo, and Node.js applications.

## 📋 Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage Patterns](#usage-patterns)
  - [Frontend (React/React Native)](#frontend-reactreact-native)
  - [Backend (Node.js)](#backend-nodejs)
  - [Mixed Applications](#mixed-applications)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [UI Components](#ui-components)
- [Troubleshooting](#troubleshooting)
- [Requirements](#requirements)

## ✨ Features

- 🔐 **Zero-Config Authentication**: Automatic token management and refresh
- 📱 **React Native First**: Optimized for React Native and Expo applications
- 🎨 **UI Components**: Pre-built React Native components with built-in bottom sheet
- 🔄 **Cross-Platform**: Works seamlessly in React Native, Expo, and Node.js
- 📱 **Multi-Session Support**: Manage multiple user sessions simultaneously
- 🔧 **TypeScript First**: Full type safety and IntelliSense support
- 🚀 **Performance Optimized**: Automatic caching and state management
- 🛡️ **Production Ready**: Error handling, retry logic, and security best practices

## 📦 Installation

```bash
npm install @oxyhq/services
```

### Peer dependencies
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

## 🚀 Quick Start

### React Native/Expo

```typescript
import { OxyProvider, useOxy } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://cloud.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}

function UserProfile() {
  const { oxyServices, user, isAuthenticated } = useOxy();
  
  if (!isAuthenticated) {
    return <Text>Please sign in</Text>;
  }
  
  return <Text>Welcome, {user?.name}!</Text>;
}
```

### Backend (Node.js / Express)

```typescript
// Prefer the core-only entry on the backend
import { oxyClient, OxyServices } from '@oxyhq/services/core';

// Quick Express example
import express from 'express';

const app = express();
app.use(express.json());

// Optional: create your own client (e.g., different baseURL per env)
const services = new OxyServices({ baseURL: process.env.OXY_CLOUD_URL || 'https://cloud.oxy.so' });

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const session = await oxyClient.signIn(username, password);
    res.json(session);
  } catch (err: any) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await services.getUserById(req.params.id);
    res.json(user);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

app.listen(3000);
```

## 📖 Usage Patterns

### React Native/Expo

#### 1. **OxyProvider + useOxy Hook (Recommended)**

This pattern provides full React Native integration with automatic state management, UI components, and authentication flow.

```typescript
import { OxyProvider, useOxy } from '@oxyhq/services';

// App.tsx - Setup the provider
function App() {
  return (
    <OxyProvider 
      baseURL="https://cloud.oxy.so"
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
  const { 
    oxyServices,    // OxyServices instance
    user,           // Current user data
    isAuthenticated, // Authentication state
    login,          // Login method
    logout,         // Logout method
    showBottomSheet // UI methods
  } = useOxy();

  const handleLogin = async () => {
    try {
      await login('username', 'password');
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const openSignIn = () => {
    showBottomSheet('SignIn');
  };

  return (
    <View>
      {isAuthenticated ? (
        <View>
          <Text style={styles.title}>Welcome, {user?.name}!</Text>
          <TouchableOpacity onPress={logout} style={styles.button}>
            <Text>Sign Out</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={openSignIn} style={styles.button}>
          <Text>Sign In</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
```

#### 2. **Direct Import (Non-React Files)**

For utility functions, services, or non-React Native files:

```typescript
import { oxyClient } from '@oxyhq/services';

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

### Backend (Node.js)

#### 1. **Pre-configured Client (Recommended)**

Use the pre-configured `oxyClient` for immediate access:

```typescript
import { oxyClient } from '@oxyhq/services/core';

// routes/auth.ts
export const signIn = async (req, res) => {
  try {
    const { username, password } = req.body;
    const response = await oxyClient.signIn(username, password);
    res.json(response);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
};

// routes/users.ts
export const getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await oxyClient.getUserById(userId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// routes/profiles.ts
export const getProfileByUsername = async (req, res) => {
  try {
    const { username } = req.params;
    const profile = await oxyClient.getProfileByUsername(username);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// routes/social.ts
export const getFollowers = async (req, res) => {
  try {
    const { userId } = req.params;
    const followers = await oxyClient.getUserFollowers(userId);
    res.json(followers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
```

#### 2. **Custom Configuration**

Create your own instance with custom settings:

```typescript
import { OxyServices, OXY_CLOUD_URL } from '@oxyhq/services';

const oxy = new OxyServices({ 
  baseURL: process.env.OXY_API_URL || OXY_CLOUD_URL 
});

export { oxy };
```

### Mixed Applications (React Native + Backend)

You can use both patterns in the same application:

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
import { oxyClient } from '@oxyhq/services';

export const apiUtils = {
  async fetchData() {
    return await oxyClient.getCurrentUser();
  }
};

// Component.tsx - React Native hook
import { useOxy } from '@oxyhq/services';

function Component() {
  const { oxyServices } = useOxy();
  // Both oxyServices and oxyClient share the same tokens!
}
```

## 🔧 API Reference

### Core Exports

```typescript
import { 
  OxyServices,           // Main service class
  oxyClient,            // Pre-configured instance
  OXY_CLOUD_URL,        // Default API URL
  OxyAuthenticationError,
  OxyAuthenticationTimeoutError
} from '@oxyhq/services';
```

### React Native Exports

```typescript
import { 
  OxyProvider,          // Context provider
  useOxy,              // React Native hook
  OxySignInButton,     // UI components
  Avatar,
  FollowButton
} from '@oxyhq/services';
```

### OxyServices Methods

```typescript
// Authentication
await oxyClient.signIn(username, password);
await oxyClient.signUp(username, email, password);
await oxyClient.logout();

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
const fileData = await oxyClient.uploadFile(file);               // Upload file
const file = await oxyClient.getFile('file123');                 // Get file info
await oxyClient.deleteFile('file123');                           // Delete file
const downloadUrl = oxyClient.getFileDownloadUrl('file123');     // Get download URL
const streamUrl = oxyClient.getFileStreamUrl('file123');         // Get stream URL
const userFiles = await oxyClient.listUserFiles('user123');      // List user files

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
  
  // Authentication methods
  login,
  logout,
  signUp,
  
  // Session management
  sessions,
  activeSessionId,
  switchSession,
  removeSession,
  
  // UI methods
  showBottomSheet,
  hideBottomSheet
} = useOxy();
```

## ⚙️ Configuration

### OxyProvider Props

```typescript
<OxyProvider
  baseURL="https://cloud.oxy.so"           // API base URL
  storageKeyPrefix="oxy_session"          // Storage key prefix
  onAuthStateChange={(user) => {}}        // Auth state callback
  onError={(error) => {}}                 // Error callback
  bottomSheetRef={bottomSheetRef}         // Bottom sheet ref
>
  {children}
</OxyProvider>
```

### Environment Variables

```bash
# .env
OXY_API_URL=https://cloud.oxy.so
NODE_ENV=production
```

### Custom Configuration

```typescript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: process.env.OXY_API_URL || 'https://cloud.oxy.so'
});
```

## 🔐 Authentication

### Automatic Token Management

The library handles authentication automatically:

- **Token Storage**: Secure storage across sessions
- **Token Refresh**: Automatic refresh before expiration
- **Session Management**: Multi-session support
- **Error Handling**: Graceful handling of auth errors

### Manual Token Management

```typescript
import { oxyClient } from '@oxyhq/services';

// Set tokens manually
oxyClient.setTokens(accessToken, refreshToken);

// Clear tokens
oxyClient.clearTokens();

// Check authentication
const isAuthenticated = oxyClient.hasValidToken();
```

## 🎨 UI Components

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

### Bottom Sheet Integration

```typescript
import { useOxy } from '@oxyhq/services';

function MyComponent() {
  const { showBottomSheet } = useOxy();
  
  const openSignIn = () => {
    showBottomSheet('SignIn');
  };
  
  const openProfile = () => {
    showBottomSheet('Profile');
  };
  
  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={openSignIn} style={styles.button}>
        <Text>Sign In</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={openProfile} style={styles.button}>
        <Text>Profile</Text>
      </TouchableOpacity>
    </View>
  );
}
```

## 🛠️ Troubleshooting

### Common Issues

#### 1. **"useOxy must be used within an OxyContextProvider"**

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

#### 2. **FormData Issues in React Native/Expo**

**Solution**: Add polyfill import at the very top of your entry file

```javascript
// index.js or App.js (very first line)
import 'react-native-url-polyfill/auto';
```

**Why needed**: Your app uses file uploads which require `FormData`. React Native with Hermes engine doesn't include `FormData` natively, so it needs to be polyfilled.

#### 3. **Authentication Not Persisting**

**Solution**: Check storage configuration

```typescript
<OxyProvider 
  baseURL="https://cloud.oxy.so"
  storageKeyPrefix="my_app_oxy"  // Custom storage key
>
  {children}
</OxyProvider>
```

### Error Handling

```typescript
import { OxyAuthenticationError } from '@oxyhq/services';

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

## 📋 Requirements

- **Node.js**: 16+ (for backend usage)
- **React Native**: 0.60+ (for mobile components)
- **Expo**: 44+ (recommended)
- **TypeScript**: 4.0+ (optional but recommended)

### Peer Dependencies

For React Native/Expo projects:

```bash
npm install axios jwt-decode invariant
```

**Note**: `react-native-url-polyfill` is already included as a dependency in this package.

## 📚 Examples

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

### Complete Backend API

```typescript
// server.ts
import express from 'express';
import { oxyClient } from '@oxyhq/services';

const app = express();
app.use(express.json());

// Auth routes
app.post('/api/auth/signin', async (req, res) => {
  try {
    const { username, password } = req.body;
    const response = await oxyClient.signIn(username, password);
    res.json(response);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// User routes
app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await oxyClient.getUserById(userId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Social routes
app.get('/api/users/:userId/followers', async (req, res) => {
  try {
    const { userId } = req.params;
    const followers = await oxyClient.getUserFollowers(userId);
    res.json(followers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
