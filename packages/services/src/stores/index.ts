/**
 * Main Zustand store combining all slices
 * This is the single source of truth for all application state
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
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

// Create the main store
export const useOxyStore = create<OxyStore>()(
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
  }))
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
    state.ensureToken(state.getApiUtils())
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
  useOxyStore.getState().initialize(oxyServices);
};

// Export store and types
export type { AuthState, FollowState };