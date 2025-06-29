# Redux Integration Guide - Complete Architecture

The @oxyhq/services module provides both a framework-agnostic, tree-shakable Redux integration and direct access to the core OxyServices API for custom implementations.

## Two Approaches for Redux Integration

### 1. Managed Redux Integration (Recommended for most apps)
Use the built-in Redux slices and reducers provided by the module.

### 2. Custom Redux Integration (For advanced use cases)  
Use the core OxyServices API directly in your own Redux setup.

## Approach 1: Managed Redux Integration

### Migration from Internal Store

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

## Approach 2: Custom Redux Integration with Core OxyServices

For advanced use cases where you need full control over your Redux architecture, use the core OxyServices API directly.

### Setting up Core API for Redux

```typescript
// services/oxyServices.ts
import { OxyServices } from '@oxyhq/services/core';

// Create singleton instance
class OxyServicesSingleton {
  private static instance: OxyServices | null = null;
  
  public static getInstance(): OxyServices {
    if (!OxyServicesSingleton.instance) {
      OxyServicesSingleton.instance = new OxyServices({
        baseURL: process.env.REACT_APP_API_URL || 'https://api.yourapp.com'
      });
    }
    return OxyServicesSingleton.instance;
  }
}

export default OxyServicesSingleton.getInstance();
```

### Custom Auth Slice with Core API

```typescript
// store/authSlice.ts
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import oxyServices from '../services/oxyServices';

interface AuthState {
  user: any | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
}

const initialState: AuthState = {
  user: null,
  isLoading: false,
  error: null,
  isAuthenticated: false,
};

// Async thunks using core API
export const loginUser = createAsyncThunk(
  'auth/loginUser',
  async (credentials: { username: string; password: string }, { rejectWithValue }) => {
    try {
      const response = await oxyServices.login(credentials.username, credentials.password);
      return response;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const fetchCurrentUser = createAsyncThunk(
  'auth/fetchCurrentUser',
  async (_, { rejectWithValue }) => {
    try {
      const user = await oxyServices.getCurrentUser();
      return user;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const logoutUser = createAsyncThunk(
  'auth/logoutUser',
  async (_, { rejectWithValue }) => {
    try {
      await oxyServices.logout();
      return null;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const updateUserProfile = createAsyncThunk(
  'auth/updateUserProfile',
  async (profileData: any, { rejectWithValue }) => {
    try {
      const updatedUser = await oxyServices.updateProfile(profileData);
      return updatedUser;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

// Slice definition
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setAuthenticated: (state, action: PayloadAction<boolean>) => {
      state.isAuthenticated = action.payload;
    },
    clearAuth: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      state.error = null;
      oxyServices.clearTokens();
    },
  },
  extraReducers: (builder) => {
    builder
      // Login
      .addCase(loginUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.isAuthenticated = true;
        state.error = null;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
        state.isAuthenticated = false;
      })
      // Fetch user
      .addCase(fetchCurrentUser.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload;
        state.isAuthenticated = true;
      })
      .addCase(fetchCurrentUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      // Logout
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null;
        state.isAuthenticated = false;
        state.error = null;
      })
      // Update profile
      .addCase(updateUserProfile.fulfilled, (state, action) => {
        state.user = action.payload;
      });
  },
});

export const { clearError, setAuthenticated, clearAuth } = authSlice.actions;
export default authSlice.reducer;
```

### Custom Social Features Slice

```typescript
// store/socialSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import oxyServices from '../services/oxyServices';

interface SocialState {
  followingStatus: Record<string, boolean>;
  followers: Record<string, any[]>;
  following: Record<string, any[]>;
  isLoading: boolean;
  error: string | null;
}

const initialState: SocialState = {
  followingStatus: {},
  followers: {},
  following: {},
  isLoading: false,
  error: null,
};

// Follow/unfollow user
export const toggleFollowUser = createAsyncThunk(
  'social/toggleFollowUser',
  async (userId: string, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { social: SocialState };
      const isCurrentlyFollowing = state.social.followingStatus[userId];
      
      if (isCurrentlyFollowing) {
        await oxyServices.unfollowUser(userId);
      } else {
        await oxyServices.followUser(userId);
      }
      
      return { userId, isFollowing: !isCurrentlyFollowing };
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

// Fetch follow status
export const fetchFollowStatus = createAsyncThunk(
  'social/fetchFollowStatus',
  async (userId: string, { rejectWithValue }) => {
    try {
      const status = await oxyServices.getFollowStatus(userId);
      return { userId, ...status };
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

// Fetch followers
export const fetchUserFollowers = createAsyncThunk(
  'social/fetchUserFollowers',
  async ({ userId, limit = 20, offset = 0 }: { userId: string; limit?: number; offset?: number }, { rejectWithValue }) => {
    try {
      const response = await oxyServices.getUserFollowers(userId, limit, offset);
      return { userId, ...response };
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

// Fetch following
export const fetchUserFollowing = createAsyncThunk(
  'social/fetchUserFollowing',
  async ({ userId, limit = 20, offset = 0 }: { userId: string; limit?: number; offset?: number }, { rejectWithValue }) => {
    try {
      const response = await oxyServices.getUserFollowing(userId, limit, offset);
      return { userId, ...response };
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

const socialSlice = createSlice({
  name: 'social',
  initialState,
  reducers: {
    clearSocialError: (state) => {
      state.error = null;
    },
    clearUserSocialData: (state, action) => {
      const userId = action.payload;
      delete state.followingStatus[userId];
      delete state.followers[userId];
      delete state.following[userId];
    },
  },
  extraReducers: (builder) => {
    builder
      // Toggle follow
      .addCase(toggleFollowUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(toggleFollowUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.followingStatus[action.payload.userId] = action.payload.isFollowing;
      })
      .addCase(toggleFollowUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      // Fetch follow status
      .addCase(fetchFollowStatus.fulfilled, (state, action) => {
        state.followingStatus[action.payload.userId] = action.payload.isFollowing;
      })
      // Fetch followers
      .addCase(fetchUserFollowers.fulfilled, (state, action) => {
        state.followers[action.payload.userId] = action.payload.followers;
      })
      // Fetch following
      .addCase(fetchUserFollowing.fulfilled, (state, action) => {
        state.following[action.payload.userId] = action.payload.following;
      });
  },
});

export const { clearSocialError, clearUserSocialData } = socialSlice.actions;
export default socialSlice.reducer;
```

### Store Configuration with Custom Slices

```typescript
// store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import socialReducer from './socialSlice';
import { setupOxyStore } from '@oxyhq/services'; // Optional: mix with managed slices

export const store = configureStore({
  reducer: {
    // Custom slices using core API
    auth: authReducer,
    social: socialReducer,
    
    // Optional: Add managed slices for other features
    ...setupOxyStore.pick('notifications'), // Use managed notifications
    
    // Your other app slices
    ui: uiReducer,
    app: appReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

### Using Custom Redux with Core API

```typescript
// components/UserProfile.tsx
import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../store';
import { fetchCurrentUser, updateUserProfile } from '../store/authSlice';
import { toggleFollowUser, fetchFollowStatus } from '../store/socialSlice';

interface UserProfileProps {
  userId: string;
}

export function UserProfile({ userId }: UserProfileProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { user, isLoading } = useSelector((state: RootState) => state.auth);
  const { followingStatus } = useSelector((state: RootState) => state.social);
  
  const isFollowing = followingStatus[userId] || false;
  
  useEffect(() => {
    dispatch(fetchCurrentUser());
    dispatch(fetchFollowStatus(userId));
  }, [dispatch, userId]);
  
  const handleFollow = () => {
    dispatch(toggleFollowUser(userId));
  };
  
  const handleUpdateProfile = (newData: any) => {
    dispatch(updateUserProfile(newData));
  };
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  return (
    <div>
      <h2>{user?.username}</h2>
      <button onClick={handleFollow}>
        {isFollowing ? 'Unfollow' : 'Follow'}
      </button>
    </div>
  );
}
```

### Advanced Middleware Integration

```typescript
// middleware/apiMiddleware.ts
import { Middleware } from '@reduxjs/toolkit';
import oxyServices from '../services/oxyServices';

// Middleware to handle automatic token refresh
export const tokenRefreshMiddleware: Middleware = (store) => (next) => async (action) => {
  // Check for specific actions that might fail due to expired tokens
  if (action.type.includes('/pending')) {
    try {
      const token = oxyServices.getAccessToken();
      if (token) {
        const isValid = await oxyServices.validate();
        if (!isValid) {
          await oxyServices.refreshTokens();
        }
      }
    } catch (error) {
      // Handle token refresh failure
      store.dispatch({ type: 'auth/clearAuth' });
    }
  }
  
  return next(action);
};

// Middleware to sync authentication state
export const authSyncMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);
  
  // Sync authentication state after login/logout actions
  if (action.type.includes('auth/loginUser/fulfilled')) {
    const { accessToken, refreshToken } = action.payload;
    oxyServices.setTokens(accessToken, refreshToken);
  } else if (action.type.includes('auth/logoutUser') || action.type.includes('auth/clearAuth')) {
    oxyServices.clearTokens();
  }
  
  return result;
};

// Add to store configuration
export const store = configureStore({
  reducer: {
    // your reducers
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(tokenRefreshMiddleware, authSyncMiddleware),
});
```

## Comparison: Managed vs Custom Redux Integration

| Feature | Managed Integration | Custom Integration |
|---------|-------------------|-------------------|
| **Setup Complexity** | Low - Use provided slices | Medium - Write own slices |
| **Customization** | Limited to provided features | Full control over state shape |
| **Maintenance** | Updates with package | Manual updates needed |
| **Bundle Size** | Includes all features | Only what you use |
| **Best For** | Standard use cases | Custom requirements |

## Which Approach to Choose?

### Use Managed Integration When:
- You need standard authentication and social features
- You want minimal setup and maintenance
- Your requirements align with provided features
- You prefer convention over configuration

### Use Custom Integration When:
- You have specific state management requirements
- You need custom business logic in reducers
- You want fine-grained control over API calls
- You're building complex, domain-specific features

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