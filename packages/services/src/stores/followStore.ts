/**
 * Follow store using Zustand
 * Centralized state management for all follow/unfollow functionality
 */

import { StateCreator } from 'zustand';
import type { ApiUtils } from '../utils/api';

export interface FollowState {
  // Follow data - using maps for better performance
  followingUsers: Record<string, boolean>;
  loadingUsers: Record<string, boolean>;
  errors: Record<string, string | null>;
  
  // Actions
  setFollowingStatus: (userId: string, isFollowing: boolean) => void;
  setLoadingStatus: (userId: string, isLoading: boolean) => void;
  setFollowError: (userId: string, error: string | null) => void;
  clearFollowError: (userId: string) => void;
  clearAllFollowErrors: () => void;
  reset: () => void;
  
  // Async actions
  toggleFollow: (userId: string, apiUtils?: ApiUtils) => Promise<{ success: boolean; isFollowing: boolean }>;
  fetchFollowStatus: (userId: string, apiUtils?: ApiUtils) => Promise<void>;
  followUser: (userId: string, apiUtils?: ApiUtils) => Promise<void>;
  unfollowUser: (userId: string, apiUtils?: ApiUtils) => Promise<void>;
  
  // Batch operations
  fetchMultipleStatuses: (userIds: string[], apiUtils?: ApiUtils) => Promise<void>;
  setMultipleStatuses: (statuses: Record<string, boolean>) => void;
}

export const createFollowSlice: StateCreator<FollowState> = (set, get) => ({
  // Initial state
  followingUsers: {},
  loadingUsers: {},
  errors: {},

  // Synchronous actions
  setFollowingStatus: (userId, isFollowing) => 
    set((state) => ({
      followingUsers: { ...state.followingUsers, [userId]: isFollowing },
      errors: { ...state.errors, [userId]: null } // Clear error on status update
    })),

  setLoadingStatus: (userId, isLoading) => 
    set((state) => ({
      loadingUsers: { ...state.loadingUsers, [userId]: isLoading }
    })),

  setFollowError: (userId, error) => 
    set((state) => ({
      errors: { ...state.errors, [userId]: error },
      loadingUsers: { ...state.loadingUsers, [userId]: false } // Clear loading on error
    })),

  clearFollowError: (userId) => 
    set((state) => ({
      errors: { ...state.errors, [userId]: null }
    })),

  clearAllFollowErrors: () => 
    set({ errors: {} }),

  reset: () => 
    set({
      followingUsers: {},
      loadingUsers: {},
      errors: {}
    }),

  setMultipleStatuses: (statuses) =>
    set((state) => ({
      followingUsers: { ...state.followingUsers, ...statuses }
    })),

  // Async actions
  toggleFollow: async (userId, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    const currentState = get();
    const isCurrentlyFollowing = currentState.followingUsers[userId] ?? false;
    
    set((state) => ({
      loadingUsers: { ...state.loadingUsers, [userId]: true },
      errors: { ...state.errors, [userId]: null }
    }));
    
    try {
      let result;
      if (isCurrentlyFollowing) {
        result = await apiUtils.unfollowUser(userId);
      } else {
        result = await apiUtils.followUser(userId);
      }
      
      // Update state with result
      get().setFollowingStatus(userId, result.isFollowing);
      get().setLoadingStatus(userId, false);
      
      return result;
    } catch (error: any) {
      const errorMessage = error?.message || 'Follow operation failed';
      get().setFollowError(userId, errorMessage);
      throw error;
    }
  },

  fetchFollowStatus: async (userId, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    set((state) => ({
      loadingUsers: { ...state.loadingUsers, [userId]: true },
      errors: { ...state.errors, [userId]: null }
    }));
    
    try {
      const result = await apiUtils.getFollowStatus(userId);
      get().setFollowingStatus(userId, result.isFollowing);
      get().setLoadingStatus(userId, false);
    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to fetch follow status';
      get().setFollowError(userId, errorMessage);
      throw error;
    }
  },

  followUser: async (userId, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    set((state) => ({
      loadingUsers: { ...state.loadingUsers, [userId]: true },
      errors: { ...state.errors, [userId]: null }
    }));
    
    try {
      const result = await apiUtils.followUser(userId);
      get().setFollowingStatus(userId, result.isFollowing);
      get().setLoadingStatus(userId, false);
    } catch (error: any) {
      const errorMessage = error?.message || 'Follow user failed';
      get().setFollowError(userId, errorMessage);
      throw error;
    }
  },

  unfollowUser: async (userId, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    set((state) => ({
      loadingUsers: { ...state.loadingUsers, [userId]: true },
      errors: { ...state.errors, [userId]: null }
    }));
    
    try {
      const result = await apiUtils.unfollowUser(userId);
      get().setFollowingStatus(userId, result.isFollowing);
      get().setLoadingStatus(userId, false);
    } catch (error: any) {
      const errorMessage = error?.message || 'Unfollow user failed';
      get().setFollowError(userId, errorMessage);
      throw error;
    }
  },

  // Batch operations
  fetchMultipleStatuses: async (userIds, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    // Set loading for all users
    const loadingUpdates = userIds.reduce((acc, userId) => {
      acc[userId] = true;
      return acc;
    }, {} as Record<string, boolean>);
    
    set((state) => ({
      loadingUsers: { ...state.loadingUsers, ...loadingUpdates }
    }));
    
    // Fetch statuses in parallel
    const promises = userIds.map(async (userId) => {
      try {
        const result = await apiUtils.getFollowStatus(userId);
        return { userId, isFollowing: result.isFollowing, error: null };
      } catch (error: any) {
        return { userId, isFollowing: false, error: error?.message || 'Failed to fetch status' };
      }
    });
    
    const results = await Promise.all(promises);
    
    // Update state with all results
    const followingUpdates: Record<string, boolean> = {};
    const loadingUpdates2: Record<string, boolean> = {};
    const errorUpdates: Record<string, string | null> = {};
    
    results.forEach(({ userId, isFollowing, error }) => {
      followingUpdates[userId] = isFollowing;
      loadingUpdates2[userId] = false;
      errorUpdates[userId] = error;
    });
    
    set((state) => ({
      followingUsers: { ...state.followingUsers, ...followingUpdates },
      loadingUsers: { ...state.loadingUsers, ...loadingUpdates2 },
      errors: { ...state.errors, ...errorUpdates }
    }));
  }
});

// Selectors for optimized component re-renders
export const followSelectors = {
  selectIsUserFollowed: (state: FollowState, userId: string) => 
    state.followingUsers[userId] ?? false,
  
  selectIsUserLoading: (state: FollowState, userId: string) => 
    state.loadingUsers[userId] ?? false,
  
  selectUserError: (state: FollowState, userId: string) => 
    state.errors[userId] ?? null,
  
  selectUserStatus: (state: FollowState, userId: string) => ({
    isFollowing: state.followingUsers[userId] ?? false,
    isLoading: state.loadingUsers[userId] ?? false,
    error: state.errors[userId] ?? null
  }),
  
  selectMultipleUserStatuses: (state: FollowState, userIds: string[]) => {
    const statuses: Record<string, { isFollowing: boolean; isLoading: boolean; error: string | null }> = {};
    
    userIds.forEach(userId => {
      statuses[userId] = {
        isFollowing: state.followingUsers[userId] ?? false,
        isLoading: state.loadingUsers[userId] ?? false,
        error: state.errors[userId] ?? null
      };
    });
    
    return statuses;
  },
  
  selectAnyLoading: (state: FollowState, userIds: string[]) => 
    userIds.some(userId => state.loadingUsers[userId]),
  
  selectAnyErrors: (state: FollowState, userIds: string[]) => 
    userIds.some(userId => state.errors[userId]),
  
  selectAllFollowing: (state: FollowState, userIds: string[]) => 
    userIds.every(userId => state.followingUsers[userId]),
  
  selectFollowingCount: (state: FollowState) => 
    Object.values(state.followingUsers).filter(Boolean).length,
  
  selectLoadingCount: (state: FollowState) => 
    Object.values(state.loadingUsers).filter(Boolean).length,
  
  selectErrorCount: (state: FollowState) => 
    Object.values(state.errors).filter(Boolean).length
};