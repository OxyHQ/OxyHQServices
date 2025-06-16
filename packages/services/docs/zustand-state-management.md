# Zustand State Management Guide

This guide explains how OxyHQServices now uses Zustand for state management with full Expo compatibility across web, Android, and iOS platforms.

## Overview

OxyHQServices has been updated to use [Zustand](https://zustand-demo.pmnd.rs/) as the underlying state management solution while maintaining the existing API surface. This change provides:

- **Better Performance**: Zustand's optimized updates reduce unnecessary re-renders
- **Built-in Persistence**: Automatic state persistence across app restarts
- **DevTools Support**: Enhanced debugging capabilities with Redux DevTools
- **Type Safety**: Full TypeScript support with better type inference
- **Expo Compatibility**: Seamless operation on web, Android, and iOS

## Migration Impact

**Good news**: If you're already using `useOxy()` hook, **no code changes are required**! The API remains exactly the same.

### Before (React Context)
```typescript
import { useOxy } from '@oxyhq/services/ui';

function MyComponent() {
  const { user, login, logout, isAuthenticated } = useOxy();
  // ... component logic
}
```

### After (Zustand-powered)
```typescript
import { useOxy } from '@oxyhq/services/ui';

function MyComponent() {
  const { user, login, logout, isAuthenticated } = useOxy();
  // ... same component logic, no changes needed!
}
```

## Advanced Usage

### Direct Store Access

For advanced use cases, you can access the Zustand store directly:

```typescript
import { useOxyStore } from '@oxyhq/services/ui';

function AdvancedComponent() {
  // Access specific store slices for better performance
  const user = useOxyStore(state => state.user);
  const isLoading = useOxyStore(state => state.isLoading);
  const login = useOxyStore(state => state.login);
  
  // Or access the entire store
  const store = useOxyStore();
}
```

### Selective Subscriptions

Zustand allows you to subscribe to specific parts of the state to optimize performance:

```typescript
import { useOxyStore } from '@oxyhq/services/ui';

function UserProfile() {
  // Only re-render when user data changes
  const user = useOxyStore(state => state.user);
  
  return (
    <div>
      <h1>{user?.username}</h1>
      <img src={user?.avatar} alt="Avatar" />
    </div>
  );
}

function LoadingSpinner() {
  // Only re-render when loading state changes
  const isLoading = useOxyStore(state => state.isLoading);
  
  return isLoading ? <div>Loading...</div> : null;
}
```

## Platform-Specific Features

### Expo Web Support
```typescript
// Automatically uses localStorage on web
const store = useOxyStore();
// State persists across browser sessions
```

### React Native (Android/iOS) Support
```typescript
// Automatically uses AsyncStorage on mobile
const store = useOxyStore();
// State persists across app restarts
```

### Cross-Platform Storage

The store automatically detects the platform and uses the appropriate storage:

- **Web**: Uses `localStorage` for persistence
- **React Native**: Uses `@react-native-async-storage/async-storage`
- **Expo**: Compatible with Expo's managed workflow

## DevTools Integration

In development mode, you can use Redux DevTools to inspect state changes:

1. Install Redux DevTools browser extension
2. The store automatically connects in development
3. View state changes, time-travel debug, and inspect actions

## Performance Benefits

### Reduced Re-renders
```typescript
// Before: Component re-renders on any context change
const { user, sessions, isLoading, error } = useOxy();

// After: Component only re-renders when user changes
const user = useOxyStore(state => state.user);
```

### Optimized Updates
```typescript
// Multiple state updates are batched automatically
const { login } = useOxyStore();

await login(username, password); // Updates user, sessions, isLoading in one batch
```

## API Reference

### Store State

The Zustand store maintains the same state structure as the original context:

```typescript
interface OxyStoreState {
  // Authentication state
  user: User | null;
  minimalUser: MinimalUserData | null;
  sessions: SecureClientSession[];
  activeSessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Services reference
  oxyServices: OxyServices | null;
  bottomSheetRef?: React.RefObject<any>;
}
```

### Store Actions

All methods from the original context are available:

```typescript
interface OxyStoreActions {
  // Authentication
  login(username: string, password: string, deviceName?: string): Promise<User>;
  logout(targetSessionId?: string): Promise<void>;
  logoutAll(): Promise<void>;
  signUp(username: string, email: string, password: string): Promise<User>;

  // Session management
  switchSession(sessionId: string): Promise<void>;
  removeSession(sessionId: string): Promise<void>;
  refreshSessions(): Promise<void>;

  // Device management
  getDeviceSessions(): Promise<any[]>;
  logoutAllDeviceSessions(): Promise<void>;
  updateDeviceName(deviceName: string): Promise<void>;

  // UI controls
  showBottomSheet?(config?: string | { screen: string; props?: Record<string, any> }): void;
  hideBottomSheet?(): void;
}
```

## Setup and Configuration

### Basic Setup (No Changes Required)

If you're already using `OxyProvider`, no changes are needed:

```typescript
import { OxyProvider } from '@oxyhq/services/ui';

function App() {
  return (
    <OxyProvider oxyServices={oxyServices}>
      <YourAppContent />
    </OxyProvider>
  );
}
```

### Advanced Configuration

For advanced use cases, you can configure the store:

```typescript
import { useOxyStore } from '@oxyhq/services/ui';

// Access store outside of React components
const store = useOxyStore.getState();

// Subscribe to changes outside React
const unsubscribe = useOxyStore.subscribe(
  (state) => console.log('State changed:', state)
);

// Clean up subscription
unsubscribe();
```

## Best Practices

### 1. Use Selective Subscriptions
```typescript
// Good: Only subscribe to what you need
const user = useOxyStore(state => state.user);

// Avoid: Subscribing to entire store when not needed
const store = useOxyStore(); // Only use when you need multiple values
```

### 2. Memoize Selectors for Complex Computations
```typescript
import { useMemo } from 'react';

function UserStats() {
  const sessions = useOxyStore(state => state.sessions);
  
  const sessionCount = useMemo(() => sessions.length, [sessions]);
  const activeSessions = useMemo(
    () => sessions.filter(s => s.lastActive > Date.now() - 86400000),
    [sessions]
  );
  
  return <div>Active sessions: {activeSessions.length}</div>;
}
```

### 3. Handle Async Operations Properly
```typescript
function LoginForm() {
  const login = useOxyStore(state => state.login);
  const isLoading = useOxyStore(state => state.isLoading);
  
  const handleLogin = async () => {
    try {
      await login(username, password);
      // Login successful, state automatically updated
    } catch (error) {
      // Error automatically stored in state
      console.error('Login failed:', error);
    }
  };
  
  return (
    <button onClick={handleLogin} disabled={isLoading}>
      {isLoading ? 'Logging in...' : 'Login'}
    </button>
  );
}
```

## Troubleshooting

### Storage Issues
If you encounter storage-related issues:

1. **Web**: Check if localStorage is available and not disabled
2. **React Native**: Ensure `@react-native-async-storage/async-storage` is properly installed
3. **Expo**: Verify Expo SDK compatibility

### Performance Issues
If you notice performance problems:

1. Use selective subscriptions instead of accessing the entire store
2. Memoize complex computations
3. Check if you're subscribing to frequently changing values unnecessarily

### Type Issues
For TypeScript errors:

1. Ensure you're importing types correctly: `import type { OxyStore } from '@oxyhq/services/ui'`
2. Use the provided type definitions for better IntelliSense
3. Check that your TypeScript version is compatible (>= 4.5)

## Migration Checklist

- [x] ✅ Zustand integrated as dependency
- [x] ✅ Store implementation with cross-platform persistence
- [x] ✅ Existing `useOxy()` API preserved
- [x] ✅ Expo compatibility ensured
- [x] ✅ TypeScript support maintained
- [x] ✅ Performance optimizations enabled
- [x] ✅ Documentation provided

## Support

If you encounter any issues or need help with the migration:

1. Check this documentation for common patterns
2. Review the TypeScript types for API reference
3. Test on your target platforms (web, Android, iOS) with Expo
4. Open an issue if you find platform-specific problems

The Zustand integration maintains full backward compatibility while providing enhanced performance and developer experience across all Expo-supported platforms.