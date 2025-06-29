# Hook vs Non-Hook API: Side-by-Side Examples

This document shows practical examples comparing the hook-based API (`useAuthFetch`) with the non-hook core API (`OxyServices`) for common use cases.

## When to Use Each Approach

| Use Case | Hook API (`useAuthFetch`) | Core API (`OxyServices`) |
|----------|-------------------------|-------------------------|
| React Components | ✅ **Recommended** | ❌ Not suitable |
| Redux Thunks | ❌ Cannot use hooks | ✅ **Required** |
| Utility Functions | ❌ Cannot use hooks | ✅ **Required** |
| Server-Side Code | ❌ No React context | ✅ **Required** |
| Background Tasks | ❌ Cannot use hooks | ✅ **Required** |
| Event Handlers in Components | ✅ **Recommended** | ⚠️ Possible but not ideal |

## Side-by-Side Examples

### Example 1: User Profile Management

#### Hook API (in React Component)
```typescript
import React, { useState } from 'react';
import { useAuthFetch } from '@oxyhq/services/ui';

function UserProfile() {
  const authFetch = useAuthFetch();
  const [profile, setProfile] = useState(null);
  
  const loadProfile = async () => {
    try {
      const user = await authFetch.get('/api/users/me');
      setProfile(user);
    } catch (error) {
      console.error('Failed to load profile:', error);
    }
  };
  
  const updateProfile = async (newData) => {
    try {
      const updated = await authFetch.put('/api/users/me', newData);
      setProfile(updated);
    } catch (error) {
      console.error('Failed to update profile:', error);
    }
  };
  
  return (
    <div>
      <button onClick={loadProfile}>Load Profile</button>
      <button onClick={() => updateProfile({ name: 'John' })}>
        Update Name
      </button>
    </div>
  );
}
```

#### Core API (in Redux Thunk)
```typescript
import { createAsyncThunk } from '@reduxjs/toolkit';
import { OxyServices } from '@oxyhq/services/core';

const oxyServices = new OxyServices({
  baseURL: 'https://api.yourapp.com'
});

export const loadUserProfile = createAsyncThunk(
  'user/loadProfile',
  async (_, { rejectWithValue }) => {
    try {
      const user = await oxyServices.getCurrentUser();
      return user;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

export const updateUserProfile = createAsyncThunk(
  'user/updateProfile',
  async (profileData: any, { rejectWithValue }) => {
    try {
      const updated = await oxyServices.updateProfile(profileData);
      return updated;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);
```

### Example 2: User Authentication

#### Hook API (in React Component)
```typescript
import React, { useState } from 'react';
import { useAuthFetch } from '@oxyhq/services/ui';

function LoginForm() {
  const authFetch = useAuthFetch();
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      await authFetch.login(credentials.username, credentials.password);
      console.log('Logged in successfully');
    } catch (error) {
      console.error('Login failed:', error);
    }
  };
  
  const handleLogout = async () => {
    try {
      await authFetch.logout();
      console.log('Logged out successfully');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };
  
  return (
    <form onSubmit={handleLogin}>
      <input 
        value={credentials.username}
        onChange={(e) => setCredentials({...credentials, username: e.target.value})}
        placeholder="Username"
      />
      <input 
        type="password"
        value={credentials.password}
        onChange={(e) => setCredentials({...credentials, password: e.target.value})}
        placeholder="Password"
      />
      <button type="submit">Login</button>
      <button type="button" onClick={handleLogout}>Logout</button>
    </form>
  );
}
```

#### Core API (in Redux Thunk)
```typescript
import { createAsyncThunk } from '@reduxjs/toolkit';
import { OxyServices } from '@oxyhq/services/core';

const oxyServices = new OxyServices({
  baseURL: 'https://api.yourapp.com'
});

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
```

### Example 3: Social Features (Following Users)

#### Hook API (in React Component)
```typescript
import React, { useState, useEffect } from 'react';
import { useAuthFetch } from '@oxyhq/services/ui';

function FollowButton({ userId }) {
  const authFetch = useAuthFetch();
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    checkFollowStatus();
  }, [userId]);
  
  const checkFollowStatus = async () => {
    try {
      const status = await authFetch.get(`/api/users/${userId}/following-status`);
      setIsFollowing(status.isFollowing);
    } catch (error) {
      console.error('Failed to check follow status:', error);
    }
  };
  
  const toggleFollow = async () => {
    setLoading(true);
    try {
      if (isFollowing) {
        await authFetch.delete(`/api/users/${userId}/follow`);
      } else {
        await authFetch.post(`/api/users/${userId}/follow`);
      }
      setIsFollowing(!isFollowing);
    } catch (error) {
      console.error('Failed to toggle follow:', error);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <button onClick={toggleFollow} disabled={loading}>
      {loading ? 'Loading...' : isFollowing ? 'Unfollow' : 'Follow'}
    </button>
  );
}
```

#### Core API (in Redux Thunk)
```typescript
import { createAsyncThunk } from '@reduxjs/toolkit';
import { OxyServices } from '@oxyhq/services/core';

const oxyServices = new OxyServices({
  baseURL: 'https://api.yourapp.com'
});

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

export const toggleFollowUser = createAsyncThunk(
  'social/toggleFollowUser',
  async (userId: string, { getState, rejectWithValue }) => {
    try {
      const state = getState() as any;
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
```

### Example 4: File Upload

#### Hook API (in React Component)
```typescript
import React, { useState } from 'react';
import { useAuthFetch } from '@oxyhq/services/ui';

function FileUpload() {
  const authFetch = useAuthFetch();
  const [uploading, setUploading] = useState(false);
  
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    setUploading(true);
    try {
      // Note: useAuthFetch doesn't have direct file upload methods
      // You'd use the raw fetch with FormData
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await authFetch('/api/files/upload', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      console.log('File uploaded:', result);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };
  
  return (
    <div>
      <input type="file" onChange={handleFileUpload} disabled={uploading} />
      {uploading && <p>Uploading...</p>}
    </div>
  );
}
```

#### Core API (in Redux Thunk or Utility Function)
```typescript
import { createAsyncThunk } from '@reduxjs/toolkit';
import { OxyServices } from '@oxyhq/services/core';

const oxyServices = new OxyServices({
  baseURL: 'https://api.yourapp.com'
});

export const uploadFile = createAsyncThunk(
  'files/uploadFile',
  async (fileData: { file: File; filename: string; metadata?: any }, { rejectWithValue }) => {
    try {
      const result = await oxyServices.uploadFile(
        fileData.file,
        fileData.filename,
        fileData.metadata
      );
      return result;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

// Or as a utility function
export async function uploadUserFile(file: File, filename: string, metadata?: any) {
  try {
    return await oxyServices.uploadFile(file, filename, metadata);
  } catch (error) {
    console.error('File upload failed:', error);
    throw error;
  }
}
```

### Example 5: Utility Functions

#### Hook API - NOT POSSIBLE
```typescript
// ❌ This doesn't work - hooks can only be used in React components
import { useAuthFetch } from '@oxyhq/services/ui';

// This will cause "hooks can only be called inside React components" error
export async function getUserUtils() {
  const authFetch = useAuthFetch(); // ❌ ERROR!
  return await authFetch.get('/api/users/me');
}
```

#### Core API (Utility Functions)
```typescript
import { OxyServices } from '@oxyhq/services/core';

const oxyServices = new OxyServices({
  baseURL: 'https://api.yourapp.com'
});

// ✅ This works perfectly
export async function getUserProfile(userId: string) {
  try {
    return await oxyServices.getUserById(userId);
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw error;
  }
}

export async function getCurrentUserNotifications() {
  try {
    return await oxyServices.getNotifications();
  } catch (error) {
    console.error('Failed to fetch notifications:', error);
    throw error;
  }
}

export async function markAllNotificationsAsRead() {
  try {
    await oxyServices.markAllNotificationsAsRead();
    return true;
  } catch (error) {
    console.error('Failed to mark notifications as read:', error);
    return false;
  }
}

export class UserService {
  static async searchUsers(query: string, limit = 10) {
    return await oxyServices.searchProfiles(query, limit);
  }
  
  static async getUserFollowers(userId: string, limit = 20, offset = 0) {
    const response = await oxyServices.getUserFollowers(userId, limit, offset);
    return response.followers;
  }
  
  static async getUserStats(userId: string) {
    const [user, followers, following] = await Promise.all([
      oxyServices.getUserById(userId),
      oxyServices.getUserFollowers(userId, 1, 0), // Just get count
      oxyServices.getUserFollowing(userId, 1, 0)   // Just get count
    ]);
    
    return {
      user,
      followerCount: followers.total,
      followingCount: following.total
    };
  }
}
```

## Integration Example: Using Both Together

You can use both approaches in the same application:

```typescript
// Redux store with core API
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './store/authSlice'; // Uses core API

const store = configureStore({
  reducer: {
    auth: authReducer
  }
});

// React component with hook API
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useAuthFetch } from '@oxyhq/services/ui';
import { loginUser } from './store/authSlice';

function App() {
  const dispatch = useDispatch();
  const authFetch = useAuthFetch();
  const { user, isAuthenticated } = useSelector(state => state.auth);
  
  // Use Redux thunk for login (core API)
  const handleLogin = (credentials) => {
    dispatch(loginUser(credentials));
  };
  
  // Use hook API for quick data fetching in component
  const loadQuickData = async () => {
    const notifications = await authFetch.get('/api/notifications');
    console.log('Notifications:', notifications);
  };
  
  return (
    <div>
      {isAuthenticated ? (
        <div>
          <h1>Welcome {user?.username}</h1>
          <button onClick={loadQuickData}>Load Notifications</button>
        </div>
      ) : (
        <LoginForm onLogin={handleLogin} />
      )}
    </div>
  );
}
```

## Summary

- **Hook API (`useAuthFetch`)**: Perfect for React components, easy to use, integrates with React patterns
- **Core API (`OxyServices`)**: Essential for Redux, utility functions, server-side code, and any non-component context
- **Both together**: Use hooks in components for UI interactions, core API in Redux for state management
- **Choose based on context**: Hooks for components, core API for everything else

The key is understanding that **hooks can only be used in React components**, while the **core API can be used anywhere in your JavaScript/TypeScript code**.