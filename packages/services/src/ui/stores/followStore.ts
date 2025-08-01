import { create } from 'zustand';
import { OxyServices } from '../../core';

interface FollowState {
  followingUsers: Record<string, boolean>;
  loadingUsers: Record<string, boolean>;
  fetchingUsers: Record<string, boolean>;
  errors: Record<string, string | null>;
  // Follower counts for each user
  followerCounts: Record<string, number>;
  followingCounts: Record<string, number>;
  // Loading states for counts
  loadingCounts: Record<string, boolean>;
  setFollowingStatus: (userId: string, isFollowing: boolean) => void;
  clearFollowError: (userId: string) => void;
  resetFollowState: () => void;
  fetchFollowStatus: (userId: string, oxyServices: OxyServices) => Promise<void>;
  toggleFollowUser: (userId: string, oxyServices: OxyServices, isCurrentlyFollowing: boolean) => Promise<void>;
  // New methods for follower counts
  setFollowerCount: (userId: string, count: number) => void;
  setFollowingCount: (userId: string, count: number) => void;
  updateCountsFromFollowAction: (targetUserId: string, action: 'follow' | 'unfollow', counts: { followers: number; following: number }, currentUserId?: string) => void;
  fetchUserCounts: (userId: string, oxyServices: OxyServices) => Promise<void>;
}

export const useFollowStore = create<FollowState>((set: any, get: any) => ({
  followingUsers: {},
  loadingUsers: {},
  fetchingUsers: {},
  errors: {},
  followerCounts: {},
  followingCounts: {},
  loadingCounts: {},
  setFollowingStatus: (userId: string, isFollowing: boolean) => set((state: FollowState) => ({
    followingUsers: { ...state.followingUsers, [userId]: isFollowing },
    errors: { ...state.errors, [userId]: null },
  })),
  clearFollowError: (userId: string) => set((state: FollowState) => ({
    errors: { ...state.errors, [userId]: null },
  })),
  resetFollowState: () => set({
    followingUsers: {},
    loadingUsers: {},
    fetchingUsers: {},
    errors: {},
    followerCounts: {},
    followingCounts: {},
    loadingCounts: {},
  }),
  fetchFollowStatus: async (userId: string, oxyServices: OxyServices) => {
    set((state: FollowState) => ({
      fetchingUsers: { ...state.fetchingUsers, [userId]: true },
      errors: { ...state.errors, [userId]: null },
    }));
    try {
      const response = await oxyServices.getFollowStatus(userId);
      set((state: FollowState) => ({
        followingUsers: { ...state.followingUsers, [userId]: response.isFollowing },
        fetchingUsers: { ...state.fetchingUsers, [userId]: false },
        errors: { ...state.errors, [userId]: null },
      }));
    } catch (error: any) {
      set((state: FollowState) => ({
        fetchingUsers: { ...state.fetchingUsers, [userId]: false },
        errors: { ...state.errors, [userId]: error?.message || 'Failed to fetch follow status' },
      }));
    }
  },
  toggleFollowUser: async (userId: string, oxyServices: OxyServices, isCurrentlyFollowing: boolean) => {
    set((state: FollowState) => ({
      loadingUsers: { ...state.loadingUsers, [userId]: true },
      errors: { ...state.errors, [userId]: null },
    }));
    try {
      let response: any;
      let newFollowState;
      if (isCurrentlyFollowing) {
        response = await oxyServices.unfollowUser(userId);
        newFollowState = false;
      } else {
        response = await oxyServices.followUser(userId);
        newFollowState = true;
      }
      
      // Update follow status
      set((state: FollowState) => ({
        followingUsers: { ...state.followingUsers, [userId]: newFollowState },
        loadingUsers: { ...state.loadingUsers, [userId]: false },
        errors: { ...state.errors, [userId]: null },
      }));

      // Update counts if the response includes them
      // The API returns counts for both users:
      // - followers: target user's follower count (the user being followed)
      // - following: current user's following count (the user doing the following)
      if (response && response.counts) {
        const { counts } = response;
        
        // Get current user ID from oxyServices
        const currentUserId = oxyServices.getCurrentUserId();
        
        set((state: FollowState) => {
          const updates: any = {};
          
          // Update target user's follower count (the user being followed)
          updates.followerCounts = { 
            ...state.followerCounts, 
            [userId]: counts.followers 
          };
          
          // Update current user's following count (the user doing the following)
          if (currentUserId) {
            updates.followingCounts = { 
              ...state.followingCounts, 
              [currentUserId]: counts.following 
            };
          }
          
          return updates;
        });
      }
    } catch (error: any) {
      set((state: FollowState) => ({
        loadingUsers: { ...state.loadingUsers, [userId]: false },
        errors: { ...state.errors, [userId]: error?.message || 'Failed to update follow status' },
      }));
    }
  },
  setFollowerCount: (userId: string, count: number) => set((state: FollowState) => ({
    followerCounts: { ...state.followerCounts, [userId]: count },
  })),
  setFollowingCount: (userId: string, count: number) => set((state: FollowState) => ({
    followingCounts: { ...state.followingCounts, [userId]: count },
  })),
  updateCountsFromFollowAction: (targetUserId: string, action: 'follow' | 'unfollow', counts: { followers: number; following: number }, currentUserId?: string) => {
    set((state: FollowState) => {
      const updates: any = {};
      
      // Update target user's follower count (the user being followed)
      updates.followerCounts = { 
        ...state.followerCounts, 
        [targetUserId]: counts.followers 
      };
      
      // Update current user's following count (the user doing the following)
      if (currentUserId) {
        updates.followingCounts = { 
          ...state.followingCounts, 
          [currentUserId]: counts.following 
        };
      }
      
      return updates;
    });
  },
  fetchUserCounts: async (userId: string, oxyServices: OxyServices) => {
    set((state: FollowState) => ({
      loadingCounts: { ...state.loadingCounts, [userId]: true },
    }));
    try {
      const user = await oxyServices.getUserById(userId);
      if (user && user._count) {
        set((state: FollowState) => ({
          followerCounts: { 
            ...state.followerCounts, 
            [userId]: user._count?.followers || 0 
          },
          followingCounts: { 
            ...state.followingCounts, 
            [userId]: user._count?.following || 0 
          },
          loadingCounts: { ...state.loadingCounts, [userId]: false },
        }));
      }
    } catch (error: unknown) {
      set((state: FollowState) => ({
        loadingCounts: { ...state.loadingCounts, [userId]: false },
      }));
    }
  },
})); 