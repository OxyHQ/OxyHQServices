/**
 * Follow hooks using Zustand
 * Replaces the complex Redux-based useFollow hooks
 */

import { useCallback, useMemo } from 'react';
import { 
  useFollow as useFollowStore, 
  useUserFollowStatus, 
  useMultipleFollowStatuses 
} from '../../stores';

/**
 * Hook for managing follow/unfollow functionality for a single user
 */
export const useFollowUser = (userId: string) => {
  const followStore = useFollowStore();
  const userStatus = useUserFollowStatus(userId);

  const toggleFollow = useCallback(async () => {
    try {
      const result = await followStore.toggleFollow(userId);
      return result;
    } catch (error) {
      throw error;
    }
  }, [followStore, userId]);

  const followUser = useCallback(async () => {
    try {
      await followStore.followUser(userId);
    } catch (error) {
      throw error;
    }
  }, [followStore, userId]);

  const unfollowUser = useCallback(async () => {
    try {
      await followStore.unfollowUser(userId);
    } catch (error) {
      throw error;
    }
  }, [followStore, userId]);

  const fetchStatus = useCallback(async () => {
    try {
      await followStore.fetchFollowStatus(userId);
    } catch (error) {
      console.warn(`Failed to fetch follow status for user ${userId}:`, error);
    }
  }, [followStore, userId]);

  const setFollowStatus = useCallback((isFollowing: boolean) => {
    followStore.setFollowingStatus(userId, isFollowing);
  }, [followStore, userId]);

  const clearError = useCallback(() => {
    followStore.clearFollowError(userId);
  }, [followStore, userId]);

  return {
    isFollowing: userStatus.isFollowing,
    isLoading: userStatus.isLoading,
    error: userStatus.error,
    toggleFollow,
    followUser,
    unfollowUser,
    fetchStatus,
    setFollowStatus,
    clearError,
  };
};

/**
 * Hook for managing follow/unfollow functionality for multiple users
 */
export const useFollowMultipleUsers = (userIds: string[]) => {
  const followStore = useFollowStore();
  const userStatuses = useMultipleFollowStatuses(userIds);

  const toggleFollowForUser = useCallback(async (targetUserId: string) => {
    try {
      const result = await followStore.toggleFollow(targetUserId);
      return result;
    } catch (error) {
      throw error;
    }
  }, [followStore]);

  const followUserById = useCallback(async (targetUserId: string) => {
    try {
      await followStore.followUser(targetUserId);
    } catch (error) {
      throw error;
    }
  }, [followStore]);

  const unfollowUserById = useCallback(async (targetUserId: string) => {
    try {
      await followStore.unfollowUser(targetUserId);
    } catch (error) {
      throw error;
    }
  }, [followStore]);

  const fetchStatusForUser = useCallback(async (targetUserId: string) => {
    try {
      await followStore.fetchFollowStatus(targetUserId);
    } catch (error) {
      console.warn(`Failed to fetch follow status for user ${targetUserId}:`, error);
    }
  }, [followStore]);

  const fetchAllStatuses = useCallback(async () => {
    try {
      await followStore.fetchMultipleStatuses(userIds);
    } catch (error) {
      console.warn('Failed to fetch follow statuses:', error);
    }
  }, [followStore, userIds]);

  const setFollowStatusForUser = useCallback((targetUserId: string, isFollowing: boolean) => {
    followStore.setFollowingStatus(targetUserId, isFollowing);
  }, [followStore]);

  const clearErrorForUser = useCallback((targetUserId: string) => {
    followStore.clearFollowError(targetUserId);
  }, [followStore]);

  // Computed values
  const isAnyLoading = useMemo(() => 
    userIds.some(userId => userStatuses[userId]?.isLoading), 
    [userIds, userStatuses]
  );

  const hasAnyError = useMemo(() => 
    userIds.some(userId => userStatuses[userId]?.error), 
    [userIds, userStatuses]
  );

  const allFollowing = useMemo(() => 
    userIds.every(userId => userStatuses[userId]?.isFollowing), 
    [userIds, userStatuses]
  );

  const allNotFollowing = useMemo(() => 
    userIds.every(userId => !userStatuses[userId]?.isFollowing), 
    [userIds, userStatuses]
  );

  return {
    followData: userStatuses,
    toggleFollowForUser,
    followUserById,
    unfollowUserById,
    fetchStatusForUser,
    fetchAllStatuses,
    setFollowStatusForUser,
    clearErrorForUser,
    
    // Helper computed values
    isAnyLoading,
    hasAnyError,
    allFollowing,
    allNotFollowing,
  };
};

/**
 * Unified follow hook that can handle both single user and multiple users
 * This replaces both useFollow and useOxyFollow from the old system
 */
export const useFollow = (userId?: string | string[]) => {
  // Determine mode based on input
  const isSingleUser = typeof userId === 'string';
  const isMultipleUsers = Array.isArray(userId);
  const singleUserId = isSingleUser ? userId as string : '';
  const multipleUserIds = isMultipleUsers ? userId as string[] : [];

  // Use appropriate hook based on mode
  const singleUserHook = useFollowUser(singleUserId);
  const multipleUsersHook = useFollowMultipleUsers(multipleUserIds);

  if (isSingleUser && singleUserId) {
    return {
      mode: 'single' as const,
      ...singleUserHook,
    };
  }
  
  if (isMultipleUsers) {
    return {
      mode: 'multiple' as const,
      ...multipleUsersHook,
    };
  }

  // Default empty state
  return {
    mode: 'none' as const,
    isFollowing: false,
    isLoading: false,
    error: null,
    followData: {},
    toggleFollow: async () => { throw new Error('No user ID provided'); },
    followUser: async () => { throw new Error('No user ID provided'); },
    unfollowUser: async () => { throw new Error('No user ID provided'); },
    fetchStatus: async () => { throw new Error('No user ID provided'); },
    setFollowStatus: () => { throw new Error('No user ID provided'); },
    clearError: () => { throw new Error('No user ID provided'); },
    isAnyLoading: false,
    hasAnyError: false,
    allFollowing: false,
    allNotFollowing: true,
  };
};