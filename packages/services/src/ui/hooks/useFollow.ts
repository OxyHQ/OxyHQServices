import { useCallback, useMemo } from 'react';
import { useFollowStore } from '../stores/followStore';
import { useOxy } from '../context/OxyContext';

export const useFollow = (userId?: string | string[]) => {
  const { oxyServices } = useOxy();
  const userIds = useMemo(() => (Array.isArray(userId) ? userId : userId ? [userId] : []), [userId]);
  const isSingleUser = typeof userId === 'string';

  // Zustand selectors
  const followState = useFollowStore();

  // Single user helpers
  const isFollowing = isSingleUser && userId ? followState.followingUsers[userId] ?? false : false;
  const isLoading = isSingleUser && userId ? followState.loadingUsers[userId] ?? false : false;
  const error = isSingleUser && userId ? followState.errors[userId] ?? null : null;

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