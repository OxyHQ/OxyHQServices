# Zustand Implementation Example

This example demonstrates how the Zustand store works in practice with the OxyHQServices library.

## Basic Usage (No Code Changes Required)

If you're already using the `useOxy()` hook, your code continues to work exactly the same:

```typescript
import React from 'react';
import { useOxy } from '@oxyhq/services/ui';

function LoginButton() {
  const { user, login, logout, isLoading, isAuthenticated } = useOxy();
  
  const handleAuth = async () => {
    if (isAuthenticated) {
      await logout();
    } else {
      await login('username', 'password');
    }
  };
  
  return (
    <button onClick={handleAuth} disabled={isLoading}>
      {isLoading ? 'Loading...' : isAuthenticated ? 'Logout' : 'Login'}
    </button>
  );
}

function UserProfile() {
  const { user } = useOxy();
  
  if (!user) return <div>Please log in</div>;
  
  return (
    <div>
      <h1>Welcome, {user.username}!</h1>
      <img src={user.avatar?.url} alt="Avatar" />
    </div>
  );
}
```

## Advanced Usage with Direct Store Access

For performance optimization, you can use the Zustand store directly:

```typescript
import React from 'react';
import { useOxyStore } from '@oxyhq/services/ui';

// Only re-render when user changes
function OptimizedUserProfile() {
  const user = useOxyStore(state => state.user);
  
  if (!user) return <div>Please log in</div>;
  
  return (
    <div>
      <h1>Welcome, {user.username}!</h1>
      <img src={user.avatar?.url} alt="Avatar" />
    </div>
  );
}

// Only re-render when loading state changes
function LoadingIndicator() {
  const isLoading = useOxyStore(state => state.isLoading);
  
  return isLoading ? <div>Loading...</div> : null;
}

// Access multiple related values efficiently
function AuthControls() {
  const { user, login, logout, isLoading } = useOxyStore(state => ({
    user: state.user,
    login: state.login,
    logout: state.logout,
    isLoading: state.isLoading
  }));
  
  const handleAuth = async () => {
    if (user) {
      await logout();
    } else {
      await login('username', 'password');
    }
  };
  
  return (
    <button onClick={handleAuth} disabled={isLoading}>
      {isLoading ? 'Loading...' : user ? 'Logout' : 'Login'}
    </button>
  );
}
```

## Provider Setup

The provider setup remains exactly the same:

```typescript
import React from 'react';
import { OxyProvider } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services';

const oxyServices = new OxyServices({
  baseURL: 'https://your-api.com'
});

function App() {
  return (
    <OxyProvider 
      oxyServices={oxyServices}
      storageKeyPrefix="my_app"
      onAuthStateChange={(user) => {
        console.log('Auth state changed:', user);
      }}
    >
      <YourAppContent />
    </OxyProvider>
  );
}
```

## Expo Compatibility

The implementation automatically handles platform differences:

### Web (React)
```typescript
// Automatically uses localStorage
import { useOxy } from '@oxyhq/services/ui';

function WebComponent() {
  const { user, login } = useOxy();
  // State persists across browser sessions
  return <div>User: {user?.username}</div>;
}
```

### React Native / Expo
```typescript
// Automatically uses AsyncStorage
import { useOxy } from '@oxyhq/services/ui';

function MobileComponent() {
  const { user, login } = useOxy();
  // State persists across app restarts
  return <Text>User: {user?.username}</Text>;
}
```

## Session Management

The same session management API is available:

```typescript
import { useOxyStore } from '@oxyhq/services/ui';

function SessionSwitcher() {
  const { sessions, activeSessionId, switchSession } = useOxyStore(state => ({
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    switchSession: state.switchSession
  }));
  
  return (
    <div>
      <h3>Active Sessions</h3>
      {sessions.map(session => (
        <button
          key={session.sessionId}
          onClick={() => switchSession(session.sessionId)}
          disabled={session.sessionId === activeSessionId}
        >
          {session.username} - {session.deviceId}
        </button>
      ))}
    </div>
  );
}
```

## Performance Benefits

### Before (React Context)
```typescript
// Component re-renders on ANY context change
function UserDisplay() {
  const { user, sessions, isLoading, error } = useOxy();
  
  // This re-renders even when sessions, isLoading, or error change
  return <div>{user?.username}</div>;
}
```

### After (Zustand with selective subscription)
```typescript
// Component only re-renders when user changes
function OptimizedUserDisplay() {
  const user = useOxyStore(state => state.user);
  
  // This only re-renders when user actually changes
  return <div>{user?.username}</div>;
}
```

## Type Safety

Full TypeScript support is maintained:

```typescript
import type { OxyStore, User } from '@oxyhq/services/ui';

// Access store outside React components
const store = useOxyStore.getState();
const user: User | null = store.user;

// Subscribe to changes outside React
const unsubscribe = useOxyStore.subscribe(
  (state: OxyStore) => {
    console.log('User changed:', state.user);
  }
);

// Clean up subscription
unsubscribe();
```

## Error Handling

Error handling works the same way:

```typescript
function LoginForm() {
  const { login, error, isLoading } = useOxy();
  
  const handleLogin = async () => {
    try {
      await login(username, password);
      // Success - user state automatically updated
    } catch (err) {
      // Error automatically stored in store.error
      console.error('Login failed:', err);
    }
  };
  
  return (
    <div>
      {error && <div style={{color: 'red'}}>{error}</div>}
      <button onClick={handleLogin} disabled={isLoading}>
        Login
      </button>
    </div>
  );
}
```

## Key Benefits

1. **Zero Breaking Changes**: Existing code using `useOxy()` continues to work
2. **Better Performance**: Selective subscriptions reduce unnecessary re-renders
3. **Automatic Persistence**: State persists across app restarts/browser sessions
4. **Cross-Platform**: Works seamlessly on web, Android, and iOS with Expo
5. **Type Safety**: Full TypeScript support maintained
6. **DevTools**: Redux DevTools integration for debugging
7. **Single Source of Truth**: All state management centralized in Zustand store

The migration provides all the benefits of modern state management while maintaining complete backward compatibility.