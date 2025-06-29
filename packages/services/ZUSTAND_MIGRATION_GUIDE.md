# Migration Guide: Redux to Zustand Architecture

This guide helps you migrate from the old Redux-based architecture to the new Zustand-based architecture that eliminates global state corruption and duplicate functions.

## Overview of Changes

### Old Architecture Issues
- ❌ Mixed Redux + Context state management causing sync issues
- ❌ Duplicate hooks (`useFollow`, `useOxyFollow`) with similar functionality
- ❌ Complex Redux setup with multiple slices and thunks
- ❌ Global state corruption due to multiple state sources
- ❌ Unnecessary re-renders from poorly optimized selectors

### New Architecture Benefits
- ✅ Single Zustand store as source of truth
- ✅ Centralized API utilities for consistent backend calls
- ✅ Simplified hooks with clear purpose
- ✅ Better performance with optimized selectors
- ✅ Expo-compatible implementation
- ✅ TypeScript-first design with proper typing

## Migration Steps

### 1. Update Provider Setup

**Before (Redux):**
```tsx
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore, OxyContextProvider } from '@oxyhq/services';

const store = configureStore({
  reducer: {
    ...setupOxyStore(),
    // your reducers
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

**After (Zustand):**
```tsx
import { OxyContextProvider } from '@oxyhq/services/ui/newIndex';

function App() {
  return (
    <OxyContextProvider oxyServices={oxyServices}>
      <YourApp />
    </OxyContextProvider>
  );
}
```

### 2. Update Authentication Usage

**Before:**
```tsx
import { useSelector, useDispatch } from 'react-redux';
import { authSelectors, loginStart } from '@oxyhq/services';
import { useOxy } from '@oxyhq/services';

function AuthComponent() {
  const dispatch = useDispatch();
  const { user, isAuthenticated } = useOxy();
  const isLoading = useSelector(authSelectors.selectIsLoading);
  
  const handleLogin = async () => {
    dispatch(loginStart());
    // complex login logic...
  };
}
```

**After:**
```tsx
import { useOxy } from '@oxyhq/services/ui/newIndex';

function AuthComponent() {
  const { 
    user, 
    isAuthenticated, 
    isLoading, 
    login, 
    logout, 
    error,
    clearError 
  } = useOxy();
  
  const handleLogin = async () => {
    try {
      await login('username', 'password');
    } catch (err) {
      console.error('Login failed:', err);
    }
  };
}
```

### 3. Update Follow Functionality

**Before (Multiple Hooks):**
```tsx
import { useFollow, useOxyFollow } from '@oxyhq/services';

// Single user
function FollowButton({ userId }) {
  const { isFollowing, toggleFollow } = useFollow(userId);
  // or
  const { isFollowing, toggleFollow } = useOxyFollow(userId);
}

// Multiple users
function UserList({ userIds }) {
  const { followData, toggleFollowForUser } = useFollow(userIds);
}
```

**After (Unified Hook):**
```tsx
import { useFollow } from '@oxyhq/services/ui/newIndex';

// Single user
function FollowButton({ userId }) {
  const { isFollowing, toggleFollow } = useFollow(userId);
}

// Multiple users  
function UserList({ userIds }) {
  const { followData, toggleFollowForUser } = useFollow(userIds);
}

// Or use specific hooks for better performance
import { useFollowUser, useFollowMultipleUsers } from '@oxyhq/services/ui/newIndex';

function FollowButton({ userId }) {
  const { isFollowing, toggleFollow } = useFollowUser(userId);
}
```

### 4. Update State Access Patterns

**Before:**
```tsx
import { useSelector } from 'react-redux';
import { authSelectors, followSelectors } from '@oxyhq/services';

function MyComponent() {
  const user = useSelector(authSelectors.selectUser);
  const isFollowing = useSelector(state => followSelectors.selectIsUserFollowed(state, userId));
}
```

**After:**
```tsx
import { useAuthUser, useUserFollowStatus } from '@oxyhq/services/ui/newIndex';

function MyComponent() {
  const user = useAuthUser();
  const { isFollowing } = useUserFollowStatus(userId);
}
```

### 5. Remove Redux Dependencies

**Before (package.json):**
```json
{
  "dependencies": {
    "@reduxjs/toolkit": "^2.8.2",
    "react-redux": "^9.2.0"
  }
}
```

**After (package.json):**
```json
{
  "dependencies": {
    "zustand": "^4.4.0"
  }
}
```

## API Reference

### Core Hooks

#### `useOxy()`
Main hook that provides all authentication and follow functionality:

```tsx
const {
  // Auth state
  user,
  isAuthenticated,
  isLoading,
  error,
  sessions,
  
  // Auth actions
  login,
  logout,
  signUp,
  updateProfile,
  
  // Follow state
  followingUsers,
  loadingUsers,
  followErrors,
  
  // Follow actions
  toggleFollow,
  followUser,
  unfollowUser,
  
  // OxyServices access
  oxyServices
} = useOxy();
```

#### `useAuth()`
Focused hook for authentication only:

```tsx
const {
  user,
  isAuthenticated,
  isLoading,
  login,
  logout,
  signUp
} = useAuth();
```

#### `useFollow(userId | userIds)`
Unified follow hook that handles both single and multiple users:

```tsx
// Single user
const { isFollowing, toggleFollow } = useFollow(userId);

// Multiple users
const { followData, toggleFollowForUser } = useFollow(userIds);
```

### Optimized Hooks

For better performance, use these specific hooks that only re-render when their specific data changes:

```tsx
// Auth-specific
const user = useAuthUser();
const isAuthenticated = useIsAuthenticated();
const isLoading = useAuthLoading();

// Follow-specific
const { isFollowing, isLoading, error } = useUserFollowStatus(userId);
const statuses = useMultipleFollowStatuses(userIds);
```

## Breaking Changes

1. **No Redux dependency**: Remove `@reduxjs/toolkit` and `react-redux`
2. **Different import paths**: Import from `@oxyhq/services/ui/newIndex` instead of `@oxyhq/services`
3. **Simplified provider**: No need for Redux Provider wrapper
4. **Hook signatures**: Some hooks have slightly different return values
5. **Error handling**: Errors are now returned in state instead of thrown globally

## Performance Improvements

The new architecture provides several performance benefits:

1. **Smaller bundle size**: Zustand is much smaller than Redux
2. **Fewer re-renders**: Optimized selectors prevent unnecessary updates
3. **Better tree shaking**: Only import what you need
4. **Simpler state updates**: Direct mutations with Immer-like syntax
5. **No action dispatching overhead**: Direct function calls

## Backward Compatibility

During the migration period, you can gradually adopt the new system:

1. Keep existing Redux code working
2. Start using new hooks in new components
3. Gradually migrate existing components
4. Remove Redux when migration is complete

The old system will continue to work until you're ready to fully migrate.

## Testing

Test your migrated components with the provided test utilities:

```tsx
import { TestApp } from '@oxyhq/services/ui/__tests__/TestApp';

// Use TestApp to verify your integration works correctly
```

## Troubleshooting

### Common Issues

1. **Store not initialized**: Make sure to wrap your app with `OxyContextProvider`
2. **API calls fail**: Ensure `oxyServices` is properly configured
3. **State not updating**: Check that you're using the hooks correctly
4. **TypeScript errors**: Update your type imports

### Getting Help

If you encounter issues during migration:

1. Check the examples in the test app
2. Review the API reference above
3. Look at the source code for implementation details
4. File an issue with specific error details

## Example: Complete Migration

Here's a complete example showing before and after:

**Before:**
```tsx
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore, OxyContextProvider, useOxy, useFollow } from '@oxyhq/services';

const store = configureStore({
  reducer: {
    ...setupOxyStore(),
  },
});

function FollowButton({ userId }) {
  const { isFollowing, toggleFollow } = useFollow(userId);
  return (
    <button onClick={toggleFollow}>
      {isFollowing ? 'Unfollow' : 'Follow'}
    </button>
  );
}

function App() {
  return (
    <Provider store={store}>
      <OxyContextProvider oxyServices={oxyServices}>
        <FollowButton userId="123" />
      </OxyContextProvider>
    </Provider>
  );
}
```

**After:**
```tsx
import React from 'react';
import { OxyContextProvider, useFollow } from '@oxyhq/services/ui/newIndex';

function FollowButton({ userId }) {
  const { isFollowing, toggleFollow } = useFollow(userId);
  return (
    <button onClick={toggleFollow}>
      {isFollowing ? 'Unfollow' : 'Follow'}
    </button>
  );
}

function App() {
  return (
    <OxyContextProvider oxyServices={oxyServices}>
      <FollowButton userId="123" />
    </OxyContextProvider>
  );
}
```

The new version is much simpler, more performant, and easier to maintain!