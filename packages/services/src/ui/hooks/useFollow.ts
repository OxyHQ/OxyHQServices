import { useCallback, useMemo } from 'react';
import { useFollowStore } from '../stores/followStore';
import { useOxy } from '../context/OxyContext';
import { isNotNullOrUndefined } from '../../utils/validationUtils';

export const useFollow = (userId?: string | string[]) => {
  const { oxyServices } = useOxy();
  
  // Validate oxyServices is available
  if (!isNotNullOrUndefined(oxyServices)) {
    throw new Error('OxyServices is not available. Ensure you are using useFollow within an OxyProvider.');
  }
  
  const userIds = useMemo(() => (Array.isArray(userId) ? userId : userId ? [userId] : []), [userId]);
  const isSingleUser = typeof userId === 'string';

  // Zustand selectors
  const followState = useFollowStore();

  // Single user helpers
  const isFollowing = isSingleUser && userId ? followState.followingUsers[userId] ?? false : false;
  const isLoading = isSingleUser && userId ? followState.loadingUsers[userId] ?? false : false;
  const error = isSingleUser && userId ? followState.errors[userId] ?? null : null;
  
  // Follower count helpers
  const followerCount = isSingleUser && userId ? followState.followerCounts[userId] ?? null : null;
  const followingCount = isSingleUser && userId ? followState.followingCounts[userId] ?? null : null;
  const isLoadingCounts = isSingleUser && userId ? followState.loadingCounts[userId] ?? false : false;

  const toggleFollow = useCallback(async () => {
    if (!isSingleUser || !userId) throw new Error('toggleFollow is only available for single user mode');
    await followState.toggleFollowUser(userId, oxyServices, isFollowing);
  }, [isSingleUser, userId, followState, oxyServices, isFollowing]);

  const setFollowStatus = useCallback((following: boolean) => {
    if (!isSingleUser || !userId) throw new Error('setFollowStatus is only available for single user mode');
    followState.setFollowingStatus(userId, following);
  }, [isSingleUser, userId, followState]);

  const fetchStatus = useCallback(async () => {
    if (!isSingleUser || !userId) throw new Error('fetchStatus is only available for single user mode');
    await followState.fetchFollowStatus(userId, oxyServices);
  }, [isSingleUser, userId, followState, oxyServices]);

  const clearError = useCallback(() => {
    if (!isSingleUser || !userId) throw new Error('clearError is only available for single user mode');
    followState.clearFollowError(userId);
  }, [isSingleUser, userId, followState]);

  const fetchUserCounts = useCallback(async () => {
    if (!isSingleUser || !userId) throw new Error('fetchUserCounts is only available for single user mode');
    await followState.fetchUserCounts(userId, oxyServices);
  }, [isSingleUser, userId, followState, oxyServices]);

  const setFollowerCount = useCallback((count: number) => {
    if (!isSingleUser || !userId) throw new Error('setFollowerCount is only available for single user mode');
    followState.setFollowerCount(userId, count);
  }, [isSingleUser, userId, followState]);

  const setFollowingCount = useCallback((count: number) => {
    if (!isSingleUser || !userId) throw new Error('setFollowingCount is only available for single user mode');
    followState.setFollowingCount(userId, count);
  }, [isSingleUser, userId, followState]);

  // Multiple user helpers
  const followData = useMemo(() => {
    const data: Record<string, { isFollowing: boolean; isLoading: boolean; error: string | null }> = {};
    userIds.forEach(uid => {
      data[uid] = {
        isFollowing: followState.followingUsers[uid] ?? false,
        isLoading: followState.loadingUsers[uid] ?? false,
        error: followState.errors[uid] ?? null,
      };
    });
    return data;
  }, [userIds, followState.followingUsers, followState.loadingUsers, followState.errors]);

  const toggleFollowForUser = useCallback(async (targetUserId: string) => {
    const currentState = followState.followingUsers[targetUserId] ?? false;
    await followState.toggleFollowUser(targetUserId, oxyServices, currentState);
  }, [followState, oxyServices]);

  const setFollowStatusForUser = useCallback((targetUserId: string, following: boolean) => {
    followState.setFollowingStatus(targetUserId, following);
  }, [followState]);

  const fetchStatusForUser = useCallback(async (targetUserId: string) => {
    await followState.fetchFollowStatus(targetUserId, oxyServices);
  }, [followState, oxyServices]);

  const fetchAllStatuses = useCallback(async () => {
    await Promise.all(userIds.map(uid => followState.fetchFollowStatus(uid, oxyServices)));
  }, [userIds, followState, oxyServices]);

  const clearErrorForUser = useCallback((targetUserId: string) => {
    followState.clearFollowError(targetUserId);
  }, [followState]);

  const updateCountsFromFollowAction = useCallback((targetUserId: string, action: 'follow' | 'unfollow', counts: { followers: number; following: number }) => {
    const currentUserId = oxyServices.getCurrentUserId() || undefined;
    followState.updateCountsFromFollowAction(targetUserId, action, counts, currentUserId);
  }, [followState, oxyServices]);

  // Aggregate helpers for multiple users
  const isAnyLoading = userIds.some(uid => followState.loadingUsers[uid]);
  const hasAnyError = userIds.some(uid => !!followState.errors[uid]);
  const allFollowing = userIds.every(uid => followState.followingUsers[uid]);
  const allNotFollowing = userIds.every(uid => !followState.followingUsers[uid]);

  if (isSingleUser && userId) {
    return {
      isFollowing,
      isLoading,
      error,
      toggleFollow,
      setFollowStatus,
      fetchStatus,
      clearError,
      // Follower count methods
      followerCount,
      followingCount,
      isLoadingCounts,
      fetchUserCounts,
      setFollowerCount,
      setFollowingCount,
    };
  }

  return {
    followData,
    toggleFollowForUser,
    setFollowStatusForUser,
    fetchStatusForUser,
    fetchAllStatuses,
    clearErrorForUser,
    isAnyLoading,
    hasAnyError,
    allFollowing,
    allNotFollowing,
  };
};

// Convenience hook for just follower counts
export const useFollowerCounts = (userId: string) => {
  const { oxyServices } = useOxy();
  
  // Validate oxyServices is available
  if (!isNotNullOrUndefined(oxyServices)) {
    throw new Error('OxyServices is not available. Ensure you are using useFollowerCounts within an OxyProvider.');
  }
  
  const followState = useFollowStore();

  const followerCount = followState.followerCounts[userId] ?? null;
  const followingCount = followState.followingCounts[userId] ?? null;
  const isLoadingCounts = followState.loadingCounts[userId] ?? false;

  const fetchUserCounts = useCallback(async () => {
    await followState.fetchUserCounts(userId, oxyServices);
  }, [userId, followState, oxyServices]);

  const setFollowerCount = useCallback((count: number) => {
    followState.setFollowerCount(userId, count);
  }, [userId, followState]);

  const setFollowingCount = useCallback((count: number) => {
    followState.setFollowingCount(userId, count);
  }, [userId, followState]);

  return {
    followerCount,
    followingCount,
    isLoadingCounts,
    fetchUserCounts,
    setFollowerCount,
    setFollowingCount,
  };
}; 