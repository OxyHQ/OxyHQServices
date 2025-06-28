# Redux Integration Guide - New Architecture

The @oxyhq/services module now provides a framework-agnostic, tree-shakable Redux integration that can be easily installed in any Oxy app without conflicts.

## Migration from Internal Store

### Before (Old Architecture)
```tsx
import { OxyProvider } from '@oxyhq/services';

// The module used its own internal Redux store
function App() {
  return (
    <OxyProvider oxyServices={oxyServices}>
      <YourApp />
    </OxyProvider>
  );
}
```

### After (New Architecture)
```tsx
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore } from '@oxyhq/services';
import { Provider } from 'react-redux';
import { OxyContextProvider } from '@oxyhq/services';

// Create your app's store with Oxy reducers
const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    // Your app-specific reducers
    appSpecificReducer,
    userSettings: userSettingsReducer,
  },
});

function App() {
  return (
    <Provider store={store}>
      <OxyContextProvider oxyServices={oxyServices}>
        <YourApp />
      </OxyContextProvider>
    </Provider>
  );
}
```

## Quick Start

### 1. Basic Integration

```tsx
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore } from '@oxyhq/services';

const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    // Add your app reducers here
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

### 2. Tree-Shakable Integration

If you only need specific features, use the tree-shakable approach:

```tsx
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore } from '@oxyhq/services';

// Only include auth functionality
const store = configureStore({
  reducer: {
    ...setupOxyStore.pick('auth'),
    // Your app reducers
  },
});

// Or include specific features
const store = configureStore({
  reducer: {
    ...setupOxyStore.pick('auth', 'follow'),
    // Your app reducers
  },
});
```

### 3. Individual Reducers

For maximum control, import individual reducers:

```tsx
import { configureStore } from '@reduxjs/toolkit';
import { authReducer, followReducer } from '@oxyhq/services';

const store = configureStore({
  reducer: {
    auth: authReducer,
    follow: followReducer,
    // Custom placement and naming
    oxyAuth: authReducer, // Custom key name
    // Your app reducers
  },
});
```

## Available Exports

### Store Setup
- `setupOxyStore()` - Returns all Oxy reducers
- `setupOxyStore.pick('auth', 'follow')` - Tree-shakable selector
- `oxyReducers` - Object with individual reducers

### Auth Slice
- `authSlice` - The complete slice
- `authReducer` - Just the reducer
- `authActions` - All action creators
- `authSelectors` - Selector functions
- `loginStart`, `loginSuccess`, `loginFailure`, `logout` - Individual actions

### Follow Slice
- `followSlice` - The complete slice
- `followReducer` - Just the reducer
- `followActions` - All action creators
- `followSelectors` - Selector functions
- `followThunks` - Async thunk actions
- `setFollowingStatus`, `clearFollowError`, `resetFollowState` - Sync actions
- `fetchFollowStatus`, `toggleFollowUser` - Async actions

### Hooks
- `useOxyFollow(userId)` - Works with any store containing Oxy reducers
- `useFollow(userId)` - Backward compatibility alias

### Types
- `AuthState` - Auth state interface
- `FollowState` - Follow state interface

## Usage Examples

### Using Auth State
```tsx
import { useSelector, useDispatch } from 'react-redux';
import { authSelectors, loginStart } from '@oxyhq/services';

function AuthComponent() {
  const user = useSelector(authSelectors.selectUser);
  const isAuthenticated = useSelector(authSelectors.selectIsAuthenticated);
  const dispatch = useDispatch();

  const handleLogin = () => {
    dispatch(loginStart());
    // ... login logic
  };

  return (
    <div>
      {isAuthenticated ? `Hello ${user?.name}` : 'Please login'}
      <button onClick={handleLogin}>Login</button>
    </div>
  );
}
```

### Using Follow Functionality
```tsx
import { useOxyFollow } from '@oxyhq/services';

function FollowButton({ userId }: { userId: string }) {
  const { isFollowing, isLoading, toggleFollow } = useOxyFollow(userId);

  return (
    <button 
      onClick={toggleFollow}
      disabled={isLoading}
    >
      {isLoading ? 'Loading...' : isFollowing ? 'Unfollow' : 'Follow'}
    </button>
  );
}
```

### Multiple Users
```tsx
import { useOxyFollow } from '@oxyhq/services';

function UserList({ userIds }: { userIds: string[] }) {
  const { followData, toggleFollowForUser } = useOxyFollow(userIds);

  return (
    <div>
      {userIds.map(userId => (
        <div key={userId}>
          <span>User {userId}</span>
          <button onClick={() => toggleFollowForUser(userId)}>
            {followData[userId]?.isFollowing ? 'Unfollow' : 'Follow'}
          </button>
        </div>
      ))}
    </div>
  );
}
```

## Framework Compatibility

### React Native with Expo
```tsx
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore } from '@oxyhq/services';

const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    navigation: navigationReducer,
  },
});
```

### Next.js
```tsx
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore } from '@oxyhq/services';

const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    ui: uiReducer,
  },
});
```

### Vanilla React
```tsx
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore } from '@oxyhq/services';

const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    app: appReducer,
  },
});
```

## Breaking Changes

1. **Internal store removed**: The module no longer creates its own Redux store
2. **Provider changes**: Use `OxyContextProvider` instead of `OxyProvider` for context-only functionality
3. **Hook naming**: `useOxyFollow` is the new recommended hook name (though `useFollow` still works)

## Backward Compatibility

For existing applications, the old `store` export is still available but deprecated:

```tsx
// Still works but deprecated
import { store } from '@oxyhq/services';

// Use this instead
import { setupOxyStore } from '@oxyhq/services';
const store = configureStore({
  reducer: setupOxyStore()
});
```

## Benefits

1. **Framework-agnostic**: Works with any React app
2. **Tree-shakable**: Include only the features you need
3. **No conflicts**: Integrates cleanly with existing Redux stores
4. **Type-safe**: Full TypeScript support
5. **Consistent**: Single source of truth for state across your app ecosystem
6. **Clean**: Clear separation of concerns