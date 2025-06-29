# Non-Hook API Guide: Using OxyServices in Redux, Thunks, and Utility Files

This guide explains how to use the OxyServices core API directly in non-component contexts like Redux reducers, thunks, utility functions, and other non-React contexts.

## Overview

While `useAuthFetch` hook is perfect for React components, you need the core OxyServices API for:
- Redux reducers and thunks
- Utility functions
- Node.js/server-side code
- Background tasks
- Non-React contexts

## Quick Start

### 1. Installation and Setup

```typescript
import { OxyServices } from '@oxyhq/services/core';

// Create a singleton instance
const oxyServices = new OxyServices({
  baseURL: 'https://your-api.com'
});

export default oxyServices;
```

### 2. Basic Usage in Utility Files

```typescript
// utils/api.ts
import oxyServices from './oxyServices';

export async function getUserProfile(userId: string) {
  try {
    const user = await oxyServices.getUserById(userId);
    return user;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw error;
  }
}

export async function updateUserProfile(profileData: any) {
  try {
    const updatedUser = await oxyServices.updateProfile(profileData);
    return updatedUser;
  } catch (error) {
    console.error('Failed to update profile:', error);
    throw error;
  }
}
```

## Redux Integration

### Using OxyServices in Redux Thunks

```typescript
// store/authSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import oxyServices from '../utils/oxyServices';

// Async thunk for login
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

// Async thunk for fetching user profile
export const fetchUserProfile = createAsyncThunk(
  'auth/fetchUserProfile',
  async (_, { rejectWithValue }) => {
    try {
      const user = await oxyServices.getCurrentUser();
      return user;
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

// Async thunk for updating profile
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

// Auth slice
const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    isLoading: false,
    error: null,
    isAuthenticated: false,
  },
  reducers: {
    logout: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      oxyServices.clearTokens(); // Clear tokens from service
    },
    clearError: (state) => {
      state.error = null;
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
        // Tokens are automatically stored in oxyServices
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
        state.isAuthenticated = false;
      })
      // Profile fetch cases
      .addCase(fetchUserProfile.fulfilled, (state, action) => {
        state.user = action.payload;
      })
      // Profile update cases
      .addCase(updateUserProfile.fulfilled, (state, action) => {
        state.user = action.payload;
      });
  },
});

export const { logout, clearError } = authSlice.actions;
export default authSlice.reducer;
```

### Complex Redux Thunk Example

```typescript
// store/userSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import oxyServices from '../utils/oxyServices';

// Thunk for following a user
export const followUser = createAsyncThunk(
  'users/followUser',
  async (userId: string, { getState, dispatch, rejectWithValue }) => {
    try {
      const result = await oxyServices.followUser(userId);
      
      // Optionally fetch updated user data
      const updatedUser = await oxyServices.getUserById(userId);
      
      return { userId, result, updatedUser };
    } catch (error: any) {
      return rejectWithValue(error.message);
    }
  }
);

// Thunk for batch operations
export const fetchUserData = createAsyncThunk(
  'users/fetchUserData',
  async (userId: string, { dispatch }) => {
    try {
      // Fetch multiple pieces of data concurrently
      const [user, followStatus, followers] = await Promise.all([
        oxyServices.getUserById(userId),
        oxyServices.getFollowStatus(userId),
        oxyServices.getUserFollowers(userId, 10, 0)
      ]);
      
      return {
        user,
        followStatus,
        followers: followers.followers
      };
    } catch (error: any) {
      throw error;
    }
  }
);
```

## Sharing OxyServices Instance

### Method 1: Singleton Pattern (Recommended)

```typescript
// utils/oxyServices.ts
import { OxyServices } from '@oxyhq/services/core';

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
  
  public static setApiUrl(url: string): void {
    const instance = OxyServicesSingleton.getInstance();
    instance.setBaseURL(url);
  }
  
  public static authenticate(accessToken: string, refreshToken: string): void {
    const instance = OxyServicesSingleton.getInstance();
    instance.setTokens(accessToken, refreshToken);
  }
}

export default OxyServicesSingleton.getInstance();
export { OxyServicesSingleton };
```

### Method 2: Dependency Injection

```typescript
// services/apiService.ts
import { OxyServices } from '@oxyhq/services/core';

export class ApiService {
  constructor(private oxyServices: OxyServices) {}
  
  async getUserProfile(userId: string) {
    return await this.oxyServices.getUserById(userId);
  }
  
  async updateProfile(data: any) {
    return await this.oxyServices.updateProfile(data);
  }
  
  async followUser(userId: string) {
    return await this.oxyServices.followUser(userId);
  }
}

// Initialize service
const oxyServices = new OxyServices({
  baseURL: 'https://api.yourapp.com'
});

export const apiService = new ApiService(oxyServices);
export { oxyServices };
```

## Utility Functions

### Authentication Utilities

```typescript
// utils/auth.ts
import oxyServices from './oxyServices';

export async function initializeAuth(): Promise<boolean> {
  try {
    // Check if we have stored tokens
    const token = oxyServices.getAccessToken();
    if (!token) return false;
    
    // Validate token with server
    const isValid = await oxyServices.validate();
    return isValid;
  } catch (error) {
    console.error('Auth initialization failed:', error);
    return false;
  }
}

export async function refreshAuthToken(): Promise<boolean> {
  try {
    await oxyServices.refreshTokens();
    return true;
  } catch (error) {
    console.error('Token refresh failed:', error);
    // Clear invalid tokens
    oxyServices.clearTokens();
    return false;
  }
}

export function getCurrentUserId(): string | null {
  return oxyServices.getCurrentUserId();
}

export async function getCurrentUser() {
  try {
    return await oxyServices.getCurrentUser();
  } catch (error) {
    console.error('Failed to get current user:', error);
    return null;
  }
}
```

### API Wrapper Utilities

```typescript
// utils/apiWrapper.ts
import oxyServices from './oxyServices';

export class ApiWrapper {
  // User operations
  static async getUser(userId: string) {
    return await oxyServices.getUserById(userId);
  }
  
  static async updateUser(userId: string, data: any) {
    return await oxyServices.updateUser(userId, data);
  }
  
  static async searchUsers(query: string, limit = 10) {
    return await oxyServices.searchProfiles(query, limit);
  }
  
  // Follow operations
  static async followUser(userId: string) {
    return await oxyServices.followUser(userId);
  }
  
  static async unfollowUser(userId: string) {
    return await oxyServices.unfollowUser(userId);
  }
  
  static async getFollowStatus(userId: string) {
    return await oxyServices.getFollowStatus(userId);
  }
  
  static async getFollowers(userId: string, limit = 20, offset = 0) {
    return await oxyServices.getUserFollowers(userId, limit, offset);
  }
  
  static async getFollowing(userId: string, limit = 20, offset = 0) {
    return await oxyServices.getUserFollowing(userId, limit, offset);
  }
  
  // Notification operations
  static async getNotifications() {
    return await oxyServices.getNotifications();
  }
  
  static async markNotificationRead(notificationId: string) {
    return await oxyServices.markNotificationAsRead(notificationId);
  }
  
  static async markAllNotificationsRead() {
    return await oxyServices.markAllNotificationsAsRead();
  }
  
  // File operations
  static async uploadFile(file: File, filename: string, metadata?: any) {
    return await oxyServices.uploadFile(file, filename, metadata);
  }
  
  static async deleteFile(fileId: string) {
    return await oxyServices.deleteFile(fileId);
  }
  
  static async getUserFiles(userId: string, limit = 20, offset = 0) {
    return await oxyServices.listUserFiles(userId, limit, offset);
  }
}
```

## Background Tasks and Workers

### Web Worker Example

```typescript
// workers/apiWorker.ts
import { OxyServices } from '@oxyhq/services/core';

// Initialize OxyServices in worker
const oxyServices = new OxyServices({
  baseURL: 'https://api.yourapp.com'
});

// Listen for messages from main thread
self.onmessage = async (event) => {
  const { type, data, tokens } = event.data;
  
  // Set authentication tokens if provided
  if (tokens) {
    oxyServices.setTokens(tokens.accessToken, tokens.refreshToken);
  }
  
  try {
    let result;
    
    switch (type) {
      case 'FETCH_USER':
        result = await oxyServices.getUserById(data.userId);
        break;
        
      case 'UPDATE_PROFILE':
        result = await oxyServices.updateProfile(data.profileData);
        break;
        
      case 'FETCH_NOTIFICATIONS':
        result = await oxyServices.getNotifications();
        break;
        
      case 'UPLOAD_FILE':
        result = await oxyServices.uploadFile(data.file, data.filename, data.metadata);
        break;
        
      default:
        throw new Error(`Unknown action type: ${type}`);
    }
    
    // Send success response
    self.postMessage({
      type: 'SUCCESS',
      requestType: type,
      data: result
    });
    
  } catch (error: any) {
    // Send error response
    self.postMessage({
      type: 'ERROR',
      requestType: type,
      error: error.message
    });
  }
};
```

### Background Sync Example

```typescript
// utils/backgroundSync.ts
import oxyServices from './oxyServices';

interface PendingAction {
  id: string;
  type: string;
  data: any;
  timestamp: number;
  retryCount: number;
}

export class BackgroundSync {
  private pendingActions: PendingAction[] = [];
  private isOnline = navigator.onLine;
  
  constructor() {
    this.setupEventListeners();
    this.loadPendingActions();
  }
  
  private setupEventListeners() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.processPendingActions();
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }
  
  async addAction(type: string, data: any) {
    const action: PendingAction = {
      id: Date.now().toString(),
      type,
      data,
      timestamp: Date.now(),
      retryCount: 0
    };
    
    if (this.isOnline) {
      await this.executeAction(action);
    } else {
      this.pendingActions.push(action);
      this.savePendingActions();
    }
  }
  
  private async executeAction(action: PendingAction) {
    try {
      switch (action.type) {
        case 'FOLLOW_USER':
          await oxyServices.followUser(action.data.userId);
          break;
          
        case 'UPDATE_PROFILE':
          await oxyServices.updateProfile(action.data);
          break;
          
        case 'MARK_NOTIFICATION_READ':
          await oxyServices.markNotificationAsRead(action.data.notificationId);
          break;
          
        default:
          console.warn(`Unknown action type: ${action.type}`);
      }
      
      // Remove successful action from pending list
      this.removePendingAction(action.id);
      
    } catch (error) {
      console.error(`Failed to execute action ${action.type}:`, error);
      
      action.retryCount++;
      if (action.retryCount < 3) {
        // Retry later
        setTimeout(() => this.executeAction(action), 5000);
      } else {
        // Give up after 3 retries
        this.removePendingAction(action.id);
      }
    }
  }
  
  private async processPendingActions() {
    const actions = [...this.pendingActions];
    for (const action of actions) {
      await this.executeAction(action);
    }
  }
  
  private removePendingAction(id: string) {
    this.pendingActions = this.pendingActions.filter(action => action.id !== id);
    this.savePendingActions();
  }
  
  private savePendingActions() {
    localStorage.setItem('pendingActions', JSON.stringify(this.pendingActions));
  }
  
  private loadPendingActions() {
    const stored = localStorage.getItem('pendingActions');
    if (stored) {
      this.pendingActions = JSON.parse(stored);
    }
  }
}
```

## Server-Side Usage (Node.js)

### Express Middleware

```typescript
// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { OxyServices } from '@oxyhq/services/core';

const oxyServices = new OxyServices({
  baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
});

export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  try {
    const result = await oxyServices.authenticateToken(token);
    
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

export { oxyServices };
```

### API Service Layer

```typescript
// services/userService.ts
import { OxyServices } from '@oxyhq/services/core';

export class UserService {
  private oxyServices: OxyServices;
  
  constructor() {
    this.oxyServices = new OxyServices({
      baseURL: process.env.OXY_API_URL || 'https://api.oxy.so'
    });
  }
  
  async authenticateUser(username: string, password: string) {
    return await this.oxyServices.login(username, password);
  }
  
  async getUserProfile(userId: string) {
    return await this.oxyServices.getUserById(userId);
  }
  
  async updateUserProfile(userId: string, data: any) {
    return await this.oxyServices.updateUser(userId, data);
  }
  
  async validateToken(token: string) {
    return await this.oxyServices.authenticateToken(token);
  }
}

export const userService = new UserService();
```

## Error Handling Patterns

### Retry Logic

```typescript
// utils/retryLogic.ts
import oxyServices from './oxyServices';

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Check if it's a token expiry error
      if (error.code === 'TOKEN_EXPIRED' && attempt < maxRetries) {
        try {
          await oxyServices.refreshTokens();
          continue; // Retry with new token
        } catch (refreshError) {
          throw refreshError; // Refresh failed, don't retry
        }
      }
      
      // For network errors, wait before retry
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
  }
  
  throw lastError!;
}

// Usage example
export async function fetchUserWithRetry(userId: string) {
  return withRetry(() => oxyServices.getUserById(userId));
}
```

### Global Error Handler

```typescript
// utils/errorHandler.ts
import oxyServices from './oxyServices';

export class GlobalErrorHandler {
  static handleApiError(error: any) {
    console.error('API Error:', error);
    
    switch (error.code) {
      case 'TOKEN_EXPIRED':
        // Try to refresh token
        return this.handleTokenExpiry();
        
      case 'NETWORK_ERROR':
        // Show network error message
        this.showNetworkError();
        break;
        
      case 'INVALID_SESSION':
        // Clear session and redirect to login
        this.handleInvalidSession();
        break;
        
      default:
        // Show generic error
        this.showGenericError(error.message);
    }
  }
  
  private static async handleTokenExpiry() {
    try {
      await oxyServices.refreshTokens();
      return true; // Token refreshed successfully
    } catch (error) {
      this.handleInvalidSession();
      return false;
    }
  }
  
  private static handleInvalidSession() {
    oxyServices.clearTokens();
    // Redirect to login page
    window.location.href = '/login';
  }
  
  private static showNetworkError() {
    // Show toast or notification
    console.error('Network error occurred');
  }
  
  private static showGenericError(message: string) {
    // Show toast or notification
    console.error('Error:', message);
  }
}
```

## Best Practices

### 1. Token Management

```typescript
// Always check token validity before making requests
const token = oxyServices.getAccessToken();
if (token) {
  try {
    const isValid = await oxyServices.validate();
    if (!isValid) {
      await oxyServices.refreshTokens();
    }
  } catch (error) {
    // Handle token refresh failure
    oxyServices.clearTokens();
  }
}
```

### 2. Environment Configuration

```typescript
// config/api.ts
const getApiConfig = () => {
  const env = process.env.NODE_ENV || 'development';
  
  const configs = {
    development: {
      baseURL: 'http://localhost:3001',
      timeout: 5000,
    },
    staging: {
      baseURL: 'https://staging-api.yourapp.com',
      timeout: 10000,
    },
    production: {
      baseURL: 'https://api.yourapp.com',
      timeout: 15000,
    }
  };
  
  return configs[env] || configs.development;
};

export const oxyServices = new OxyServices(getApiConfig());
```

### 3. Type Safety

```typescript
// types/api.ts
import { User } from '@oxyhq/services/core';

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface UserProfile extends User {
  preferences: {
    theme: 'light' | 'dark';
    notifications: boolean;
  };
}

// Usage with proper typing
export async function getTypedUser(userId: string): Promise<UserProfile> {
  const user = await oxyServices.getUserById(userId);
  return user as UserProfile;
}
```

## Migration from Hooks to Non-Hook API

If transitioning from hooks to non-hook API:

```typescript
// Before (with hooks)
function MyComponent() {
  const authFetch = useAuthFetch();
  
  const handleClick = async () => {
    const user = await authFetch.get('/api/users/me');
  };
}

// After (with non-hook API in Redux thunk)
export const fetchCurrentUser = createAsyncThunk(
  'user/fetchCurrent',
  async () => {
    return await oxyServices.getCurrentUser();
  }
);
```

This comprehensive guide should help you effectively use the OxyServices core API in any non-component context, from Redux stores to utility functions and server-side applications.