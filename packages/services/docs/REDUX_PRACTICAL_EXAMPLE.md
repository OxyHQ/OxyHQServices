# Practical Example: Using OxyServices in Redux

This example shows exactly how to use the OxyServices core API (non-hook) in Redux reducers, thunks, and other non-component files.

## Problem Statement

**Q: "I know useAuthFetch works, but what is the correct way to use the non-hook API utility in Redux reducers and other non-component files?"**

**A: Use the `OxyServices` class directly. Here's exactly how:**

## Complete Working Example

### 1. Create OxyServices Instance (Singleton)

```typescript
// services/oxyApi.ts
import { OxyServices } from '@oxyhq/services/core';

// Create a singleton instance to use throughout your app
class OxyApiSingleton {
  private static instance: OxyServices | null = null;
  
  public static getInstance(): OxyServices {
    if (!OxyApiSingleton.instance) {
      OxyApiSingleton.instance = new OxyServices({
        baseURL: process.env.REACT_APP_API_URL || 'https://api.oxy.so'
      });
    }
    return OxyApiSingleton.instance;
  }
}

export const oxyApi = OxyApiSingleton.getInstance();
export default oxyApi;
```

### 2. Redux Store Setup

```typescript
// store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import userReducer from './userSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    user: userReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

### 3. Auth Slice with OxyServices

```typescript
// store/authSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import oxyApi from '../services/oxyApi';

// Define state interface
interface AuthState {
  user: any | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
};

// Async thunks using OxyServices (this is the answer to your question!)
export const loginUser = createAsyncThunk(
  'auth/loginUser',
  async (credentials: { username: string; password: string }, { rejectWithValue }) => {
    try {
      // This is how you use the non-hook API in Redux!
      const response = await oxyApi.login(credentials.username, credentials.password);
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
      // Using OxyServices directly in a thunk
      const user = await oxyApi.getCurrentUser();
      return user;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const logoutUser = createAsyncThunk(
  'auth/logoutUser',
  async () => {
    // Direct API call without hooks
    await oxyApi.logout();
    return null;
  }
);

// Slice with reducers
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    // Synchronous action that also uses OxyServices
    clearAuth: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      state.error = null;
      // Direct call in a reducer action
      oxyApi.clearTokens();
    },
  },
  extraReducers: (builder) => {
    builder
      // Login cases
      .addCase(loginUser.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.isLoading = false;
        state.user = action.payload.user;
        state.isAuthenticated = true;
        // The tokens are automatically stored in oxyApi instance
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
        state.isAuthenticated = false;
      })
      // Fetch user cases
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.user = action.payload;
        state.isAuthenticated = true;
      })
      // Logout cases
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null;
        state.isAuthenticated = false;
      });
  },
});

export const { clearError, clearAuth } = authSlice.actions;
export default authSlice.reducer;
```

### 4. User Management Slice

```typescript
// store/userSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import oxyApi from '../services/oxyApi';

interface UserState {
  profile: any | null;
  followers: any[];
  following: any[];
  isLoading: boolean;
  error: string | null;
}

const initialState: UserState = {
  profile: null,
  followers: [],
  following: [],
  isLoading: false,
  error: null,
};

// More examples of using OxyServices in thunks
export const updateUserProfile = createAsyncThunk(
  'user/updateProfile',
  async (profileData: any, { rejectWithValue }) => {
    try {
      const updatedUser = await oxyApi.updateProfile(profileData);
      return updatedUser;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const followUser = createAsyncThunk(
  'user/followUser',
  async (userId: string, { rejectWithValue }) => {
    try {
      await oxyApi.followUser(userId);
      return userId;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const unfollowUser = createAsyncThunk(
  'user/unfollowUser',
  async (userId: string, { rejectWithValue }) => {
    try {
      await oxyApi.unfollowUser(userId);
      return userId;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const fetchUserFollowers = createAsyncThunk(
  'user/fetchFollowers',
  async (userId: string, { rejectWithValue }) => {
    try {
      const response = await oxyApi.getUserFollowers(userId, 50, 0);
      return response.followers;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    clearUserError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(updateUserProfile.fulfilled, (state, action) => {
        state.profile = action.payload;
      })
      .addCase(fetchUserFollowers.fulfilled, (state, action) => {
        state.followers = action.payload;
      });
  },
});

export const { clearUserError } = userSlice.actions;
export default userSlice.reducer;
```

### 5. Utility Functions (Non-Component Files)

```typescript
// utils/userUtils.ts
import oxyApi from '../services/oxyApi';

// These are utility functions using the non-hook API
export class UserUtils {
  // Check if a username is available
  static async isUsernameAvailable(username: string): Promise<boolean> {
    try {
      const result = await oxyApi.checkUsernameAvailability(username);
      return result.available;
    } catch (error) {
      console.error('Username check failed:', error);
      return false;
    }
  }
  
  // Get user statistics
  static async getUserStats(userId: string) {
    try {
      const [user, followers, following] = await Promise.all([
        oxyApi.getUserById(userId),
        oxyApi.getUserFollowers(userId, 1, 0), // Just get count
        oxyApi.getUserFollowing(userId, 1, 0)  // Just get count
      ]);
      
      return {
        user,
        followerCount: followers.total,
        followingCount: following.total,
      };
    } catch (error) {
      console.error('Failed to get user stats:', error);
      throw error;
    }
  }
  
  // Batch follow multiple users
  static async batchFollowUsers(userIds: string[]): Promise<string[]> {
    const successful: string[] = [];
    
    for (const userId of userIds) {
      try {
        await oxyApi.followUser(userId);
        successful.push(userId);
      } catch (error) {
        console.error(`Failed to follow user ${userId}:`, error);
      }
    }
    
    return successful;
  }
}

// Simple utility functions
export async function getCurrentUserId(): Promise<string | null> {
  return oxyApi.getCurrentUserId();
}

export async function validateCurrentSession(): Promise<boolean> {
  try {
    return await oxyApi.validate();
  } catch {
    return false;
  }
}

export async function refreshTokenIfNeeded(): Promise<boolean> {
  try {
    await oxyApi.refreshTokens();
    return true;
  } catch {
    return false;
  }
}
```

### 6. Background Service Example

```typescript
// services/backgroundSync.ts
import oxyApi from './oxyApi';

export class BackgroundSyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  
  startSyncing() {
    this.syncInterval = setInterval(async () => {
      await this.syncUserData();
    }, 60000); // Sync every minute
  }
  
  stopSyncing() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
  
  private async syncUserData() {
    try {
      // Check if user is still authenticated
      const isValid = await oxyApi.validate();
      if (!isValid) {
        console.log('Session expired, stopping sync');
        this.stopSyncing();
        return;
      }
      
      // Sync notifications
      const notifications = await oxyApi.getNotifications();
      console.log(`Synced ${notifications.length} notifications`);
      
      // Mark old notifications as read
      await oxyApi.markAllNotificationsAsRead();
      
    } catch (error) {
      console.error('Background sync failed:', error);
    }
  }
}

export const backgroundSync = new BackgroundSyncService();
```

### 7. Using in React Components

```typescript
// components/UserDashboard.tsx
import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../store';
import { fetchCurrentUser, loginUser } from '../store/authSlice';
import { updateUserProfile } from '../store/userSlice';
import { UserUtils } from '../utils/userUtils';

export function UserDashboard() {
  const dispatch = useDispatch<AppDispatch>();
  const { user, isAuthenticated, isLoading } = useSelector((state: RootState) => state.auth);
  
  useEffect(() => {
    if (isAuthenticated) {
      dispatch(fetchCurrentUser());
    }
  }, [dispatch, isAuthenticated]);
  
  const handleLogin = () => {
    dispatch(loginUser({
      username: 'testuser',
      password: 'password'
    }));
  };
  
  const handleUpdateProfile = () => {
    dispatch(updateUserProfile({
      name: 'Updated Name'
    }));
  };
  
  const handleCheckUsername = async () => {
    // Using utility function that uses OxyServices
    const isAvailable = await UserUtils.isUsernameAvailable('newusername');
    console.log('Username available:', isAvailable);
  };
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  return (
    <div>
      {isAuthenticated ? (
        <div>
          <h1>Welcome {user?.username}</h1>
          <button onClick={handleUpdateProfile}>Update Profile</button>
          <button onClick={handleCheckUsername}>Check Username</button>
        </div>
      ) : (
        <button onClick={handleLogin}>Login</button>
      )}
    </div>
  );
}
```

### 8. Express.js Middleware Example

```typescript
// middleware/authMiddleware.ts (for backend usage)
import { Request, Response, NextFunction } from 'express';
import { OxyServices } from '@oxyhq/services/core';

const oxyApi = new OxyServices({
  baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
});

export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  try {
    // Using OxyServices for token validation in Express middleware
    const result = await oxyApi.authenticateToken(token);
    
    if (result.valid) {
      req.user = result.user;
      req.userId = result.userId;
      next();
    } else {
      res.status(403).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Token validation failed' });
  }
}
```

## Key Points (TL;DR)

1. **Import the core API**: `import { OxyServices } from '@oxyhq/services/core'`

2. **Create a singleton instance**: Use the same instance throughout your app

3. **Use in Redux thunks**: Call `oxyApi.methodName()` directly in `createAsyncThunk`

4. **Use in utility functions**: Call `oxyApi.methodName()` directly in any function

5. **Don't use hooks**: `useAuthFetch` only works in React components, not in Redux or utility files

6. **Token management is automatic**: OxyServices handles storing and refreshing tokens

This is the complete, correct way to use the non-hook OxyServices API in Redux reducers, thunks, and other non-component files. The key is using the `OxyServices` class directly instead of the `useAuthFetch` hook.