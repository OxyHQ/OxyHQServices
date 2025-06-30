/**
 * Main Zustand store combining all slices
 * This is the single source of truth for all application state
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAuthSlice, type AuthState } from './authStore';
import { createFollowSlice, type FollowState } from './followStore';
import type { OxyServices } from '../core';
import { createApiUtils, type ApiUtils } from '../utils/api';

// Combined store state
export interface OxyStore extends AuthState, FollowState {
  // Store metadata
  _apiUtils: ApiUtils | null;
  _oxyServices: OxyServices | null;
  
  // Store initialization
  initialize: (oxyServices: OxyServices) => void;
  
  // Helper to get API utils (throws if not initialized)
  getApiUtils: () => ApiUtils;
}

// Platform-safe storage adapter
function isReactNative() {
  return (
    typeof navigator !== 'undefined' &&
    navigator.product === 'ReactNative'
  );
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

// Create a no-op storage for Node.js environments
const noOpStorage = {
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
};

const storage = isReactNative()
  ? createJSONStorage(() => AsyncStorage)
  : isBrowser()
    ? createJSONStorage(() => window.localStorage)
    : createJSONStorage(() => noOpStorage); // Use no-op storage instead of undefined

// Create the main store with persist
export const useOxyStore = create<OxyStore>()(
  persist(
    subscribeWithSelector((set, get, api) => ({
      // Store metadata
      _apiUtils: null,
      _oxyServices: null,
      
      // Initialize store with OxyServices instance
      initialize: (oxyServices: OxyServices) => {
        const apiUtils = createApiUtils(oxyServices);
        set({ 
          _apiUtils: apiUtils, 
          _oxyServices: oxyServices 
        });
      },
      
      // Helper to get API utils
      getApiUtils: () => {
        const state = get();
        if (!state._apiUtils) {
          throw new Error('Store not initialized. Call initialize() with OxyServices instance first.');
        }
        return state._apiUtils;
      },
      
      // Auth slice
      ...createAuthSlice(set, get, api),
      
      // Follow slice
      ...createFollowSlice(set, get, api)
    })),
    {
      name: 'oxy-auth', // storage key
      storage,
      partialize: (state) => {
        const partialized = {
          // Only persist the relevant auth state
          user: state.user,
          minimalUser: state.minimalUser,
          sessions: state.sessions,
          activeSessionId: state.activeSessionId,
          isAuthenticated: state.isAuthenticated,
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
        } as Partial<OxyStore>;
        
        console.log('[OxyStore] Partializing state for persistence:', {
          hasUser: !!partialized.user,
          hasAccessToken: !!partialized.accessToken,
          hasRefreshToken: !!partialized.refreshToken,
          accessTokenLength: partialized.accessToken?.length || 0,
          refreshTokenLength: partialized.refreshToken?.length || 0,
        });
        
        return partialized;
      },
      onRehydrateStorage: () => (state) => {
        console.log('[OxyStore] Rehydrating from storage:', {
          hasUser: !!state?.user,
          hasAccessToken: !!state?.accessToken,
          hasRefreshToken: !!state?.refreshToken,
          accessTokenLength: state?.accessToken?.length || 0,
          refreshTokenLength: state?.refreshToken?.length || 0,
          isAuthenticated: state?.isAuthenticated,
          userId: state?.user?.id,
          username: state?.user?.username,
        });
        
        // If we have user data but isAuthenticated is false, fix it
        if (state?.user && !state?.isAuthenticated) {
          console.log('[OxyStore] Fixing authentication state - user exists but isAuthenticated is false');
          // Fix the authentication state by calling setUser with the existing user data
          setTimeout(() => {
            const currentState = useOxyStore.getState();
            if (currentState.user && !currentState.isAuthenticated) {
              console.log('[OxyStore] Applying authentication state fix');
              currentState.setUser(currentState.user, currentState.accessToken, currentState.refreshToken);
            }
          }, 0);
        }
      },
    }
  )
);

// Convenience hooks for accessing specific parts of the store
export const useAuth = () => useOxyStore((state) => ({
  user: state.user,
  minimalUser: state.minimalUser,
  sessions: state.sessions,
  activeSessionId: state.activeSessionId,
  isAuthenticated: state.isAuthenticated,
  isLoading: state.isLoading,
  error: state.error,
  
  // Actions
  setUser: state.setUser,
  setMinimalUser: state.setMinimalUser,
  setSessions: state.setSessions,
  setActiveSessionId: state.setActiveSessionId,
  setLoading: state.setLoading,
  setError: state.setError,
  clearError: state.clearError,
  reset: state.reset,
  
  // Async actions (auto-inject apiUtils)
  login: (username: string, password: string, deviceName?: string) => 
    state.login(username, password, deviceName, state.getApiUtils()),
  logout: (targetSessionId?: string) => 
    state.logout(targetSessionId, state.getApiUtils()),
  logoutAll: () => 
    state.logoutAll(state.getApiUtils()),
  signUp: (username: string, email: string, password: string) => 
    state.signUp(username, email, password, state.getApiUtils()),
  refreshUserData: () => 
    state.refreshUserData(state.getApiUtils()),
  refreshSessions: () => 
    state.refreshSessions(state.getApiUtils()),
  switchSession: (sessionId: string) => 
    state.switchSession(sessionId, state.getApiUtils()),
  removeSession: (sessionId: string) => 
    state.removeSession(sessionId, state.getApiUtils()),
  updateProfile: (updates: Record<string, any>) => 
    state.updateProfile(updates, state.getApiUtils()),
  getDeviceSessions: () => 
    state.getDeviceSessions(state.getApiUtils()),
  logoutAllDeviceSessions: () => 
    state.logoutAllDeviceSessions(state.getApiUtils()),
  updateDeviceName: (deviceName: string) => 
    state.updateDeviceName(deviceName, state.getApiUtils()),
  ensureToken: () => 
    state.ensureToken(state.getApiUtils()),
  syncTokens: () => 
    state.syncTokens(state.getApiUtils())
}));

export const useFollow = () => useOxyStore((state) => ({
  followingUsers: state.followingUsers,
  loadingUsers: state.loadingUsers,
  errors: state.errors,
  
  // Actions
  setFollowingStatus: state.setFollowingStatus,
  setLoadingStatus: state.setLoadingStatus,
  setFollowError: state.setFollowError,
  clearFollowError: state.clearFollowError,
  clearAllFollowErrors: state.clearAllFollowErrors,
  setMultipleStatuses: state.setMultipleStatuses,
  
  // Async actions (auto-inject apiUtils)
  toggleFollow: (userId: string) => 
    state.toggleFollow(userId, state.getApiUtils()),
  fetchFollowStatus: (userId: string) => 
    state.fetchFollowStatus(userId, state.getApiUtils()),
  followUser: (userId: string) => 
    state.followUser(userId, state.getApiUtils()),
  unfollowUser: (userId: string) => 
    state.unfollowUser(userId, state.getApiUtils()),
  fetchMultipleStatuses: (userIds: string[]) => 
    state.fetchMultipleStatuses(userIds, state.getApiUtils())
}));

// Optimized hooks for specific data (prevent unnecessary re-renders)
export const useAuthUser = () => useOxyStore((state) => state.user);
export const useIsAuthenticated = () => useOxyStore((state) => state.isAuthenticated);
export const useAuthLoading = () => useOxyStore((state) => state.isLoading);
export const useAuthError = () => useOxyStore((state) => state.error);
export const useAuthSessions = () => useOxyStore((state) => state.sessions);

// Follow hooks for specific users
export const useUserFollowStatus = (userId: string) => useOxyStore((state) => ({
  isFollowing: state.followingUsers[userId] ?? false,
  isLoading: state.loadingUsers[userId] ?? false,
  error: state.errors[userId] ?? null
}));

// Batch follow hooks
export const useMultipleFollowStatuses = (userIds: string[]) => useOxyStore((state) => {
  const statuses: Record<string, { isFollowing: boolean; isLoading: boolean; error: string | null }> = {};
  
  userIds.forEach(userId => {
    statuses[userId] = {
      isFollowing: state.followingUsers[userId] ?? false,
      isLoading: state.loadingUsers[userId] ?? false,
      error: state.errors[userId] ?? null
    };
  });
  
  return statuses;
});

// Store initialization utility
export const initializeOxyStore = (oxyServices: OxyServices) => {
  // Log storage configuration
  console.log('[OxyStore] Storage configuration:', {
    isReactNative: isReactNative(),
    isBrowser: isBrowser(),
    storageType: storage ? 'configured' : 'undefined'
  });

  const state = useOxyStore.getState();
  console.log('[OxyStore] Initializing with tokens:', {
    hasAccessToken: !!state.accessToken,
    hasRefreshToken: !!state.refreshToken,
    accessTokenLength: state.accessToken?.length || 0,
    refreshTokenLength: state.refreshToken?.length || 0,
    hasUser: !!state.user,
    isAuthenticated: state.isAuthenticated,
  });
  
  // Check OxyServices current tokens
  const oxyAccessToken = oxyServices.getAccessToken();
  const oxyRefreshToken = oxyServices.getRefreshToken();
  console.log('[OxyStore] OxyServices current tokens:', {
    hasAccessToken: !!oxyAccessToken,
    hasRefreshToken: !!oxyRefreshToken,
    accessTokenLength: oxyAccessToken?.length || 0,
    refreshTokenLength: oxyRefreshToken?.length || 0,
  });
  
  // Restore tokens into OxyServices if available
  if (state.accessToken && state.refreshToken) {
    console.log('[OxyStore] Restoring tokens to OxyServices');
    oxyServices.setTokens(state.accessToken, state.refreshToken);
  } else if (oxyAccessToken && oxyRefreshToken) {
    console.log('[OxyStore] OxyServices has tokens, updating store');
    useOxyStore.getState().setUser(state.user, oxyAccessToken, oxyRefreshToken);
  } else if (state.user && state.isAuthenticated) {
    // User is authenticated but no tokens - this might be a storage issue
    // Try to refresh user data to get new tokens
    console.log('[OxyStore] User is authenticated but no tokens found. This might be a storage issue.');
    console.log('[OxyStore] User data available:', {
      userId: state.user.id,
      username: state.user.username,
    });
    
    // Try to restore the user ID to OxyServices by setting a temporary token
    // This will allow getCurrentUserId() to work even without valid tokens
    if (state.user.id) {
      console.log('[OxyStore] Attempting to restore user context to OxyServices');
      console.log('[OxyStore] User context available for token recovery');
      
      // Try to recover tokens using the user ID as session ID
      setTimeout(async () => {
        try {
          console.log('[OxyStore] Attempting token recovery for user:', state.user?.id);
          const tokenData = await oxyServices.getTokenBySession(state.user?.id || '');
          console.log('[OxyStore] Token recovery successful:', !!tokenData.accessToken);
          
          if (tokenData.accessToken) {
            // Set tokens in OxyServices and update store
            oxyServices.setTokens(tokenData.accessToken, '');
            useOxyStore.getState().setUser(state.user, tokenData.accessToken, '');
            console.log('[OxyStore] Tokens restored successfully');
          }
        } catch (recoveryError) {
          console.warn('[OxyStore] Token recovery failed:', recoveryError);
          // If token recovery fails, we'll let the ensureToken method handle it later
        }
      }, 1000); // Wait 1 second to ensure everything is initialized
    }
    
    // Don't try to refresh immediately - let the app handle this gracefully
    // The ensureToken method will handle this case
  } else {
    console.log('[OxyStore] No tokens to restore');
  }
  
  useOxyStore.getState().initialize(oxyServices);
};

// Export store and types
export type { AuthState, FollowState };