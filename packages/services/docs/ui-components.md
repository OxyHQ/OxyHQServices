# UI Components Guide

This guide covers the React and React Native UI components provided by OxyHQServices.

## Table of Contents

- [Overview](#overview)
- [Setup](#setup)
- [Core Components](#core-components)
- [Component Reference](#component-reference)
- [Styling](#styling)
- [Examples](#examples)
- [Platform Differences](#platform-differences)

## Overview

OxyHQServices provides pre-built UI components for React and React Native applications, including authentication screens, user avatars, and social interaction buttons. All components are fully customizable and follow platform-specific design guidelines.

### Features

- 🎨 **Platform Adaptive**: Automatically adapts to web and mobile platforms
- 🔧 **Customizable**: Full control over styling and behavior
- 🌙 **Theme Support**: Built-in light/dark theme support
- ♿ **Accessible**: Follows accessibility best practices
- 📱 **Responsive**: Works across different screen sizes

## Setup

### Installation

```bash
npm install @oxyhq/services
```

### Basic Setup

Wrap your app with `OxyProvider`:

```tsx
import React from 'react';
import { OxyProvider } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: 'https://your-api-server.com'
});

function App() {
  return (
    <OxyProvider client={oxy}>
      {/* Your app components */}
    </OxyProvider>
  );
}

export default App;
```

### Provider Configuration

The `OxyProvider` accepts several configuration options:

```tsx
<OxyProvider
  client={oxy}
  theme="light" // or "dark" or "auto"
  customFonts={true} // Enable custom Phudu fonts
  debugMode={false} // Enable debug information
>
  <App />
</OxyProvider>
```

## Core Components

### OxyProvider

The authentication context provider that must wrap your app.

```tsx
import { OxyProvider } from '@oxyhq/services/ui';

<OxyProvider client={oxyClient}>
  <YourApp />
</OxyProvider>
```

**Props:**
- `client` (required): OxyServices instance
- `theme`: `"light" | "dark" | "auto"` - Theme mode
- `customFonts`: `boolean` - Enable custom font loading
- `debugMode`: `boolean` - Enable debug information

### Avatar

User avatar component with fallback support.

```tsx
import { Avatar } from '@oxyhq/services/ui';

<Avatar
  user={user}
  size={48}
  onPress={() => console.log('Avatar pressed')}
/>
```

**Props:**
- `user`: User object with `avatar_url`, `username`, `email`
- `size`: `number` - Avatar size in pixels (default: 40)
- `onPress`: `() => void` - Optional press handler
- `style`: Custom styles
- `fallbackIcon`: Custom fallback icon

### FollowButton

Social follow/unfollow button component.

```tsx
import { FollowButton } from '@oxyhq/services/ui';

<FollowButton
  userId="user123"
  onFollowChange={(isFollowing) => console.log('Follow state:', isFollowing)}
/>
```

**Props:**
- `userId` (required): User ID to follow/unfollow
- `onFollowChange`: `(isFollowing: boolean) => void` - Follow state callback
- `style`: Custom styles
- `disabled`: `boolean` - Disable the button

### OxyLogo

Brand logo component.

```tsx
import { OxyLogo } from '@oxyhq/services/ui';

<OxyLogo
  size={120}
  variant="full" // or "icon"
/>
```

**Props:**
- `size`: `number` - Logo size (default: 100)
- `variant`: `"full" | "icon"` - Logo variant
- `style`: Custom styles

## Component Reference

### Authentication Hooks

#### useOxyAuth

Access authentication state and methods:

```tsx
import { useOxyAuth } from '@oxyhq/services/ui';

function ProfileScreen() {
  const { user, login, logout, isAuthenticated } = useOxyAuth();

  if (!isAuthenticated) {
    return <LoginButton onPress={() => login(credentials)} />;
  }

  return (
    <div>
      <h1>Welcome, {user.username}!</h1>
      <button onClick={logout}>Sign Out</button>
    </div>
  );
}
```

#### useOxyUser

Access user-specific data and operations:

```tsx
import { useOxyUser } from '@oxyhq/services/ui';

function UserProfile() {
  const { currentUser, updateProfile, loading } = useOxyUser();

  const handleUpdate = async (data) => {
    await updateProfile(data);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <Avatar user={currentUser} size={80} />
      <h2>{currentUser.username}</h2>
    </div>
  );
}
```

### Utility Components

#### LoadingSpinner

```tsx
import { LoadingSpinner } from '@oxyhq/services/ui';

<LoadingSpinner size="large" color="#007AFF" />
```

#### ErrorBoundary

```tsx
import { ErrorBoundary } from '@oxyhq/services/ui';

<ErrorBoundary fallback={<ErrorFallback />}>
  <YourComponent />
</ErrorBoundary>
```

## Styling

### Theme Customization

Override default theme values:

```tsx
const customTheme = {
  colors: {
    primary: '#007AFF',
    secondary: '#5AC8FA',
    background: '#FFFFFF',
    surface: '#F2F2F7',
    error: '#FF3B30',
    text: '#000000',
    textSecondary: '#8E8E93',
  },
  fonts: {
    regular: 'System',
    medium: 'System-Medium',
    bold: 'System-Bold',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
};

<OxyProvider client={oxy} theme={customTheme}>
  <App />
</OxyProvider>
```

### Custom Fonts

The library includes custom Phudu fonts for branding:

```tsx
import { fontStyles, fontFamilies } from '@oxyhq/services/ui';

const styles = StyleSheet.create({
  title: {
    ...fontStyles.titleLarge,
    color: '#333333',
  },
  customText: {
    fontFamily: fontFamilies.phudu,
    fontSize: 24,
    fontWeight: '600',
  },
});
```

### Platform-Specific Styling

```tsx
import { Platform, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
      web: {
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      },
    }),
  },
});
```

## Examples

### Complete Authentication Flow

```tsx
import React from 'react';
import { 
  OxyProvider, 
  useOxyAuth, 
  Avatar, 
  LoadingSpinner 
} from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: 'https://your-api-server.com'
});

function AuthenticatedApp() {
  const { user, logout, loading } = useOxyAuth();

  if (loading) {
    return <LoadingSpinner size="large" />;
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar user={user} size={48} />
        <div>
          <h2>{user.username}</h2>
          <p>{user.email}</p>
        </div>
      </div>
      <button onClick={logout} style={{ marginTop: 16 }}>
        Sign Out
      </button>
    </div>
  );
}

function LoginForm() {
  const { login } = useOxyAuth();
  const [credentials, setCredentials] = React.useState({
    email: '',
    password: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(credentials);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <input
          type="email"
          placeholder="Email"
          value={credentials.email}
          onChange={(e) => setCredentials(prev => ({
            ...prev,
            email: e.target.value
          }))}
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <input
          type="password"
          placeholder="Password"
          value={credentials.password}
          onChange={(e) => setCredentials(prev => ({
            ...prev,
            password: e.target.value
          }))}
        />
      </div>
      <button type="submit">Sign In</button>
    </form>
  );
}

function App() {
  const { isAuthenticated, loading } = useOxyAuth();

  if (loading) {
    return <LoadingSpinner size="large" />;
  }

  return isAuthenticated ? <AuthenticatedApp /> : <LoginForm />;
}

function Root() {
  return (
    <OxyProvider client={oxy}>
      <App />
    </OxyProvider>
  );
}

export default Root;
```

### Social Features

```tsx
import React from 'react';
import { Avatar, FollowButton } from '@oxyhq/services/ui';

function UserCard({ user }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: 16,
      border: '1px solid #e0e0e0',
      borderRadius: 8,
      gap: 12
    }}>
      <Avatar user={user} size={60} />
      <div style={{ flex: 1 }}>
        <h3>{user.username}</h3>
        <p>{user.bio}</p>
      </div>
      <FollowButton
        userId={user.id}
        onFollowChange={(isFollowing) => {
          console.log(`${isFollowing ? 'Following' : 'Unfollowed'} ${user.username}`);
        }}
      />
    </div>
  );
}
```

## Platform Differences

### React Native vs React Web

The components automatically adapt to the platform:

| Feature | React Native | React Web |
|---------|--------------|-----------|
| Touch Handling | `TouchableOpacity` | `button` with `onClick` |
| Styling | `StyleSheet` | CSS-in-JS |
| Fonts | Platform fonts + custom | Web fonts + custom |
| Navigation | React Navigation | React Router |
| Storage | AsyncStorage | localStorage |

### iOS vs Android

Platform-specific differences are handled automatically:

- **iOS**: Uses iOS-style shadows and animations
- **Android**: Uses Material Design elevation and ripple effects
- **Web**: Uses CSS box-shadows and transitions

### Responsive Design

Components automatically adapt to screen sizes:

```tsx
import { useWindowDimensions } from 'react-native';

function ResponsiveAvatar({ user }) {
  const { width } = useWindowDimensions();
  const size = width < 768 ? 40 : 60; // Smaller on mobile

  return <Avatar user={user} size={size} />;
}
```

## Best Practices

1. **Always wrap your app with OxyProvider**
2. **Use hooks for authentication state**
3. **Customize themes for brand consistency**
4. **Handle loading and error states**
5. **Test on multiple platforms**
6. **Follow accessibility guidelines**

## Troubleshooting

### Common Issues

1. **Components not rendering**: Ensure OxyProvider is wrapping your app
2. **Fonts not loading**: Check that `customFonts` prop is enabled
3. **Theme not applying**: Verify theme object structure
4. **TypeScript errors**: Ensure proper type imports

For more help, see the [Troubleshooting Guide](./troubleshooting.md).

## Related Documentation

- [Core API Reference](./core-api.md)
- [Quick Start Guide](./quick-start.md)
- [Examples](./examples/)
- [Font Implementation Guide](../src/ui/styles/FONTS.md)