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

export const useFollowStore = create<FollowState>((set: any, get: any) => ({
  followingUsers: {},
  loadingUsers: {},
  fetchingUsers: {},
  errors: {},
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
      let response;
      let newFollowState;
      if (isCurrentlyFollowing) {
        response = await oxyServices.unfollowUser(userId);
        newFollowState = false;
      } else {
        response = await oxyServices.followUser(userId);
        newFollowState = true;
      }
      set((state: FollowState) => ({
        followingUsers: { ...state.followingUsers, [userId]: newFollowState },
        loadingUsers: { ...state.loadingUsers, [userId]: false },
        errors: { ...state.errors, [userId]: null },
      }));
    } catch (error: any) {
      set((state: FollowState) => ({
        loadingUsers: { ...state.loadingUsers, [userId]: false },
        errors: { ...state.errors, [userId]: error?.message || 'Failed to update follow status' },
      }));
    }
  },
})); 