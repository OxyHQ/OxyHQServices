import { create } from 'zustand';
import { OxyServices } from '../../core';

interface FollowState {
  followingUsers: Record<string, boolean>;
  loadingUsers: Record<string, boolean>;
  fetchingUsers: Record<string, boolean>;
  errors: Record<string, string | null>;
  setFollowingStatus: (userId: string, isFollowing: boolean) => void;
  clearFollowError: (userId: string) => void;
  resetFollowState: () => void;
  fetchFollowStatus: (userId: string, oxyServices: OxyServices) => Promise<void>;
  toggleFollowUser: (userId: string, oxyServices: OxyServices, isCurrentlyFollowing: boolean) => Promise<void>;
}

export const useFollowStore = create<FollowState>((set, get) => ({
  followingUsers: {},
  loadingUsers: {},
  fetchingUsers: {},
  errors: {},
  setFollowingStatus: (userId, isFollowing) => set((state) => ({
    followingUsers: { ...state.followingUsers, [userId]: isFollowing },
    errors: { ...state.errors, [userId]: null },
  })),
  clearFollowError: (userId) => set((state) => ({
    errors: { ...state.errors, [userId]: null },
  })),
  resetFollowState: () => set({
    followingUsers: {},
    loadingUsers: {},
    fetchingUsers: {},
    errors: {},
  }),
  fetchFollowStatus: async (userId, oxyServices) => {
    set((state) => ({
      fetchingUsers: { ...state.fetchingUsers, [userId]: true },
      errors: { ...state.errors, [userId]: null },
    }));
    try {
      const response = await oxyServices.getFollowStatus(userId);
      set((state) => ({
        followingUsers: { ...state.followingUsers, [userId]: response.isFollowing },
        fetchingUsers: { ...state.fetchingUsers, [userId]: false },
        errors: { ...state.errors, [userId]: null },
      }));
    } catch (error: any) {
      set((state) => ({
        fetchingUsers: { ...state.fetchingUsers, [userId]: false },
        errors: { ...state.errors, [userId]: error?.message || 'Failed to fetch follow status' },
      }));
    }
  },
  toggleFollowUser: async (userId, oxyServices, isCurrentlyFollowing) => {
    set((state) => ({
      loadingUsers: { ...state.loadingUsers, [userId]: true },
      errors: { ...state.errors, [userId]: null },
    }));
    try {
      let response;
      let newFollowState;
      if (isCurrentlyFollowing) {
        response = await oxyServices.unfollowUser(userId);
        newFollowState = false;
      } else {
        response = await oxyServices.followUser(userId);
        newFollowState = true;
      }
      set((state) => ({
        followingUsers: { ...state.followingUsers, [userId]: newFollowState },
        loadingUsers: { ...state.loadingUsers, [userId]: false },
        errors: { ...state.errors, [userId]: null },
      }));
    } catch (error: any) {
      set((state) => ({
        loadingUsers: { ...state.loadingUsers, [userId]: false },
        errors: { ...state.errors, [userId]: error?.message || 'Failed to update follow status' },
      }));
    }
  },
})); 