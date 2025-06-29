import { useDispatch, useSelector } from 'react-redux';
import { useCallback, useMemo } from 'react';
import { 
  toggleFollowUser, 
  setFollowingStatus, 
  clearFollowError, 
  fetchFollowStatus,
  followSelectors
} from '../store/slices/followSlice';
import type { FollowState } from '../store/slices/types';
import { useOxy } from '../context/OxyContext';

// Generic type for state that includes follow slice
interface StateWithFollow {
  follow: FollowState;
}

// Memoized selector to prevent unnecessary re-renders
const createFollowSelector = (userId: string) => (state: StateWithFollow) => ({
  isFollowing: followSelectors.selectIsUserFollowed(state, userId),
  isLoading: followSelectors.selectIsUserLoading(state, userId),
  error: followSelectors.selectUserError(state, userId),
});

// Memoized selector for multiple users
const createMultipleFollowSelector = (userIds: string[]) => (state: StateWithFollow) => {
  const followData: Record<string, { isFollowing: boolean; isLoading: boolean; error: string | null }> = {};
  
  for (const userId of userIds) {
    followData[userId] = {
      isFollowing: followSelectors.selectIsUserFollowed(state, userId),
      isLoading: followSelectors.selectIsUserLoading(state, userId),
      error: followSelectors.selectUserError(state, userId),
    };
  }
  
  const followState = state.follow;
  return {
    followData,
    isAnyLoading: userIds.some(uid => followState.loadingUsers[uid]),
    hasAnyError: userIds.some(uid => followState.errors[uid]),
    allFollowing: userIds.every(uid => followState.followingUsers[uid]),
    allNotFollowing: userIds.every(uid => !followState.followingUsers[uid]),
  };
};

/**
 * Custom hook for managing follow/unfollow functionality
 * Works with any Redux store that includes the Oxy follow reducer
 * Optimized to prevent unnecessary re-renders
 * Can handle both single user and multiple users
 */
export const useOxyFollow = (userId?: string | string[]) => {
  const dispatch = useDispatch();
  const { oxyServices } = useOxy();
  
  // Memoize user IDs to prevent recreation on every render
  const userIds = useMemo(() => {
    return Array.isArray(userId) ? userId : userId ? [userId] : [];
  }, [userId]);
  
  const isSingleUser = typeof userId === 'string';
  
  // Memoize selectors to prevent recreation
  const singleUserSelector = useMemo(() => {
    return isSingleUser && userId ? createFollowSelector(userId) : null;
  }, [isSingleUser, userId]);
  
  const multipleUserSelector = useMemo(() => {
    return !isSingleUser ? createMultipleFollowSelector(userIds) : null;
  }, [isSingleUser, userIds]);
  
  // Use appropriate selector based on mode
  const singleUserData = useSelector(singleUserSelector || (() => ({ isFollowing: false, isLoading: false, error: null })));
  const multipleUserData = useSelector(multipleUserSelector || (() => ({ 
    followData: {}, 
    isAnyLoading: false, 
    hasAnyError: false, 
    allFollowing: false, 
    allNotFollowing: true 
  })));

  // Memoized callbacks to prevent recreation on every render
  const toggleFollow = useCallback(async () => {
    if (!isSingleUser || !userId) throw new Error('toggleFollow is only available for single user mode');
    
    try {
      const result = await dispatch(toggleFollowUser({
        userId,
        oxyServices,
        isCurrentlyFollowing: singleUserData.isFollowing
      })).unwrap();
      return result;
    } catch (error) {
      throw error;
    }
  }, [dispatch, userId, oxyServices, singleUserData.isFollowing, isSingleUser]);

  const setFollowStatus = useCallback((following: boolean) => {
    if (!isSingleUser || !userId) throw new Error('setFollowStatus is only available for single user mode');
    dispatch(setFollowingStatus({ userId, isFollowing: following }));
  }, [dispatch, userId, isSingleUser]);

  const fetchStatus = useCallback(async () => {
    if (!isSingleUser || !userId) throw new Error('fetchStatus is only available for single user mode');
    
    try {
      await dispatch(fetchFollowStatus({ userId, oxyServices })).unwrap();
    } catch (error) {
      console.warn(`Failed to fetch follow status for user ${userId}:`, error);
    }
  }, [dispatch, userId, oxyServices, isSingleUser]);

  const clearError = useCallback(() => {
    if (!isSingleUser || !userId) throw new Error('clearError is only available for single user mode');
    dispatch(clearFollowError(userId));
  }, [dispatch, userId, isSingleUser]);

  // Multiple user callbacks
  const toggleFollowForUser = useCallback(async (targetUserId: string) => {
    const currentState = multipleUserData.followData[targetUserId]?.isFollowing ?? false;
    try {
      const result = await dispatch(toggleFollowUser({
        userId: targetUserId,
        oxyServices,
        isCurrentlyFollowing: currentState
      })).unwrap();
      return result;
    } catch (error) {
      throw error;
    }
  }, [dispatch, oxyServices, multipleUserData.followData]);

  const setFollowStatusForUser = useCallback((targetUserId: string, following: boolean) => {
    dispatch(setFollowingStatus({ userId: targetUserId, isFollowing: following }));
  }, [dispatch]);

  const fetchStatusForUser = useCallback(async (targetUserId: string) => {
    try {
      await dispatch(fetchFollowStatus({ userId: targetUserId, oxyServices })).unwrap();
    } catch (error) {
      console.warn(`Failed to fetch follow status for user ${targetUserId}:`, error);
    }
  }, [dispatch, oxyServices]);

  const fetchAllStatuses = useCallback(async () => {
    const promises = userIds.map(uid => 
      dispatch(fetchFollowStatus({ userId: uid, oxyServices })).unwrap().catch((error: any) => {
        console.warn(`Failed to fetch follow status for user ${uid}:`, error);
      })
    );
    await Promise.all(promises);
  }, [dispatch, userIds, oxyServices]);

  const clearErrorForUser = useCallback((targetUserId: string) => {
    dispatch(clearFollowError(targetUserId));
  }, [dispatch]);

  // Return appropriate interface based on mode
  if (isSingleUser && userId) {
    return {
      isFollowing: singleUserData.isFollowing,
      isLoading: singleUserData.isLoading,
      error: singleUserData.error,
      toggleFollow,
      setFollowStatus,
      fetchStatus,
      clearError,
    };
  }
  
  return {
    followData: multipleUserData.followData,
    toggleFollowForUser,
    setFollowStatusForUser,
    fetchStatusForUser,
    fetchAllStatuses,
    clearErrorForUser,
    // Helper methods
    isAnyLoading: multipleUserData.isAnyLoading,
    hasAnyError: multipleUserData.hasAnyError,
    allFollowing: multipleUserData.allFollowing,
    allNotFollowing: multipleUserData.allNotFollowing,
  };
};

// Backward compatibility alias
export const useFollow = useOxyFollow;