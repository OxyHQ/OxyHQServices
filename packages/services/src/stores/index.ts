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
import { createThemeSlice, type ThemeState } from './themeStore';
import { createUserSettingsSlice, type UserSettingsState } from './userSettingsStore';
import type { OxyServices } from '../core';
import { createApiUtils, type ApiUtils } from '../utils/api';

// Combined store state
export interface OxyStore extends AuthState, FollowState, ThemeState, UserSettingsState {
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
      ...createFollowSlice(set, get, api),
      
      // Theme slice
      ...createThemeSlice(set, get, api),
      
      // User Settings slice
      ...createUserSettingsSlice(set, get, api)
    })),
    {
      name: 'oxy-auth', // storage key
      storage,
      partialize: (state) => {
        // Persist tokens and user preferences (theme, language) for clean architecture
        const partialized = {
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
          theme: state.theme,
          language: state.language,
        } as Partial<OxyStore>;
        
        console.log('[OxyStore] Partializing state for persistence (tokens + preferences):', {
          hasAccessToken: !!partialized.accessToken,
          hasRefreshToken: !!partialized.refreshToken,
          accessTokenLength: partialized.accessToken?.length || 0,
          refreshTokenLength: partialized.refreshToken?.length || 0,
          theme: partialized.theme,
          language: partialized.language,
        });
        
        return partialized;
      },
      onRehydrateStorage: () => (state) => {
        console.log('[OxyStore] Rehydrating from storage (tokens + preferences):', {
          hasAccessToken: !!state?.accessToken,
          hasRefreshToken: !!state?.refreshToken,
          accessTokenLength: state?.accessToken?.length || 0,
          refreshTokenLength: state?.refreshToken?.length || 0,
          theme: state?.theme,
          language: state?.language,
        });
        
        // If we have tokens, they will be restored to state
        // Non-persisted state will be synced from backend in initializeOxyStore
        if (state?.accessToken && state?.refreshToken) {
          console.log('[OxyStore] Tokens and preferences restored from storage, non-persisted state will be synced from backend');
        } else {
          console.log('[OxyStore] No tokens found in storage');
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
    state.syncTokens(state.getApiUtils()),
  syncNonPersistedState: () =>
    state.syncNonPersistedState(state.getApiUtils())
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

export const useUserSettings = () => useOxyStore((state) => ({
  settings: state.settings,
  isLoading: state.isLoading,
  isSaving: state.isSaving,
  error: state.error,
  lastSync: state.lastSync,
  isOffline: state.isOffline,
  
  // Actions
  setSettings: state.setSettings,
  setLoading: state.setLoading,
  setSaving: state.setSaving,
  setError: state.setError,
  setOffline: state.setOffline,
  reset: state.reset,
  
  // Async actions (auto-inject apiUtils)
  loadSettings: () => 
    state.loadSettings(state.getApiUtils()),
  saveSettings: (updates: any) => 
    state.saveSettings(updates, state.getApiUtils()),
  syncSettings: () => 
    state.syncSettings(state.getApiUtils()),
  refreshSettings: () => 
    state.refreshSettings(state.getApiUtils()),
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
  console.log('[OxyStore] Initializing with token + preferences persistence model:', {
    hasAccessToken: !!state.accessToken,
    hasRefreshToken: !!state.refreshToken,
    accessTokenLength: state.accessToken?.length || 0,
    refreshTokenLength: state.refreshToken?.length || 0,
    theme: state.theme,
    language: state.language,
    // Non-persisted state (should be empty on startup)
    hasUser: !!state.user,
    isAuthenticated: state.isAuthenticated,
    sessionsCount: state.sessions.length,
  });
  
  // Initialize the store with OxyServices first
  useOxyStore.getState().initialize(oxyServices);
  
  // Handle token restoration and sync
  if (state.accessToken && state.refreshToken) {
    console.log('[OxyStore] Tokens found in storage, restoring to OxyServices and syncing state from backend');
    
    // Restore tokens to OxyServices
    oxyServices.setTokens(state.accessToken, state.refreshToken);
    
    // Automatically sync non-persisted state from backend
    setTimeout(async () => {
      try {
        console.log('[OxyStore] Starting automatic sync of non-persisted state from backend');
        await useOxyStore.getState().syncNonPersistedState();
        console.log('[OxyStore] Automatic sync completed successfully');
      } catch (error: any) {
        console.warn('[OxyStore] Automatic sync failed:', error);
        // If sync fails due to invalid tokens, state will be reset by syncNonPersistedState
      }
    }, 100); // Small delay to ensure store is fully initialized
  } else {
    // Check if OxyServices has tokens that we don't have in store
    const oxyAccessToken = oxyServices.getAccessToken();
    const oxyRefreshToken = oxyServices.getRefreshToken();
    
    if (oxyAccessToken && oxyRefreshToken) {
      console.log('[OxyStore] OxyServices has tokens but storage doesn\'t, syncing to store');
      useOxyStore.getState().setUser(null, oxyAccessToken, oxyRefreshToken);
      
      // Also sync non-persisted state
      setTimeout(async () => {
        try {
          await useOxyStore.getState().syncNonPersistedState();
        } catch (error: any) {
          console.warn('[OxyStore] Failed to sync after OxyServices token restoration:', error);
        }
      }, 100);
    } else {
      console.log('[OxyStore] No tokens available - user needs to authenticate');
    }
  }
};

// Export store and types
export type { AuthState, FollowState };