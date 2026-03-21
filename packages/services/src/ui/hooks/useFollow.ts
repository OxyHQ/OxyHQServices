import { useCallback, useMemo, useEffect } from 'react';
import { useFollowStore } from '../stores/followStore';
import { useOxy } from '../context/OxyContext';
import type { OxyServices } from '@oxyhq/core';
import { useShallow } from 'zustand/react/shallow';

/**
 * useFollow — Hook for follow state management.
 *
 * Performance fixes:
 * 1. Uses granular Zustand selectors instead of subscribing to the entire store.
 *    The old `useFollowStore()` caused every component using this hook to re-render
 *    on ANY store change (any user's follow status, loading state, error, or count).
 * 2. Callbacks depend on primitive values (userId, isFollowing) not object references,
 *    so they remain stable across renders.
 * 3. Store action methods are accessed via getState() in callbacks to avoid
 *    subscribing to the action functions themselves (they never change but including
 *    them in selectors would cause unnecessary selector recalculations).
 */
export const useFollow = (userId?: string | string[]) => {
  const { oxyServices } = useOxy();
  const userIds = useMemo(() => (Array.isArray(userId) ? userId : userId ? [userId] : []), [userId]);
  const isSingleUser = typeof userId === 'string';

  // Granular Zustand selectors — only re-render when THIS user's data changes
  const isFollowing = useFollowStore(
    useCallback((s) => (isSingleUser && userId ? s.followingUsers[userId] ?? false : false), [isSingleUser, userId])
  );
  const isLoading = useFollowStore(
    useCallback((s) => (isSingleUser && userId ? s.loadingUsers[userId] ?? false : false), [isSingleUser, userId])
  );
  const error = useFollowStore(
    useCallback((s) => (isSingleUser && userId ? s.errors[userId] ?? null : null), [isSingleUser, userId])
  );
  const followerCount = useFollowStore(
    useCallback((s) => (isSingleUser && userId ? s.followerCounts[userId] ?? null : null), [isSingleUser, userId])
  );
  const followingCount = useFollowStore(
    useCallback((s) => (isSingleUser && userId ? s.followingCounts[userId] ?? null : null), [isSingleUser, userId])
  );
  const isLoadingCounts = useFollowStore(
    useCallback((s) => (isSingleUser && userId ? s.loadingCounts[userId] ?? false : false), [isSingleUser, userId])
  );

  // For multi-user mode, use shallow comparison to avoid re-renders when unrelated users change
  const followData = useFollowStore(
    useShallow((s) => {
      if (isSingleUser) return {};
      const data: Record<string, { isFollowing: boolean; isLoading: boolean; error: string | null }> = {};
      for (const uid of userIds) {
        data[uid] = {
          isFollowing: s.followingUsers[uid] ?? false,
          isLoading: s.loadingUsers[uid] ?? false,
          error: s.errors[uid] ?? null,
        };
      }
      return data;
    })
  );

  // Multi-user aggregate selectors
  const multiUserLoadingState = useFollowStore(
    useShallow((s) => {
      if (isSingleUser) return { isAnyLoading: false, hasAnyError: false, allFollowing: true, allNotFollowing: true };
      return {
        isAnyLoading: userIds.some(uid => s.loadingUsers[uid]),
        hasAnyError: userIds.some(uid => !!s.errors[uid]),
        allFollowing: userIds.every(uid => s.followingUsers[uid]),
        allNotFollowing: userIds.every(uid => !s.followingUsers[uid]),
      };
    })
  );

  // Stable callbacks that depend on primitives, not object references.
  // Store actions are accessed via getState() to avoid subscribing to them.
  const toggleFollow = useCallback(async () => {
    if (!isSingleUser || !userId) throw new Error('toggleFollow is only available for single user mode');
    const currentlyFollowing = useFollowStore.getState().followingUsers[userId] ?? false;
    await useFollowStore.getState().toggleFollowUser(userId, oxyServices, currentlyFollowing);
  }, [isSingleUser, userId, oxyServices]);

  const setFollowStatus = useCallback((following: boolean) => {
    if (!isSingleUser || !userId) throw new Error('setFollowStatus is only available for single user mode');
    useFollowStore.getState().setFollowingStatus(userId, following);
  }, [isSingleUser, userId]);

  const fetchStatus = useCallback(async () => {
    if (!isSingleUser || !userId) throw new Error('fetchStatus is only available for single user mode');
    await useFollowStore.getState().fetchFollowStatus(userId, oxyServices);
  }, [isSingleUser, userId, oxyServices]);

  const clearError = useCallback(() => {
    if (!isSingleUser || !userId) throw new Error('clearError is only available for single user mode');
    useFollowStore.getState().clearFollowError(userId);
  }, [isSingleUser, userId]);

  const fetchUserCounts = useCallback(async () => {
    if (!isSingleUser || !userId) throw new Error('fetchUserCounts is only available for single user mode');
    await useFollowStore.getState().fetchUserCounts(userId, oxyServices);
  }, [isSingleUser, userId, oxyServices]);

  const setFollowerCount = useCallback((count: number) => {
    if (!isSingleUser || !userId) throw new Error('setFollowerCount is only available for single user mode');
    useFollowStore.getState().setFollowerCount(userId, count);
  }, [isSingleUser, userId]);

  const setFollowingCount = useCallback((count: number) => {
    if (!isSingleUser || !userId) throw new Error('setFollowingCount is only available for single user mode');
    useFollowStore.getState().setFollowingCount(userId, count);
  }, [isSingleUser, userId]);

  // Auto-fetch counts when hook is used for a single user and counts are missing.
  useEffect(() => {
    if (!isSingleUser || !userId) return;

    if ((followerCount === null || followingCount === null) && !isLoadingCounts) {
      fetchUserCounts().catch((err: unknown) => console.warn('useFollow: fetchUserCounts failed', err));
    }
  }, [isSingleUser, userId, followerCount, followingCount, isLoadingCounts, fetchUserCounts]);

  // Multi-user callbacks
  const toggleFollowForUser = useCallback(async (targetUserId: string) => {
    const currentState = useFollowStore.getState().followingUsers[targetUserId] ?? false;
    await useFollowStore.getState().toggleFollowUser(targetUserId, oxyServices, currentState);
  }, [oxyServices]);

  const setFollowStatusForUser = useCallback((targetUserId: string, following: boolean) => {
    useFollowStore.getState().setFollowingStatus(targetUserId, following);
  }, []);

  const fetchStatusForUser = useCallback(async (targetUserId: string) => {
    await useFollowStore.getState().fetchFollowStatus(targetUserId, oxyServices);
  }, [oxyServices]);

  const fetchAllStatuses = useCallback(async () => {
    const store = useFollowStore.getState();
    await Promise.all(userIds.map(uid => store.fetchFollowStatus(uid, oxyServices)));
  }, [userIds, oxyServices]);

  const clearErrorForUser = useCallback((targetUserId: string) => {
    useFollowStore.getState().clearFollowError(targetUserId);
  }, []);

  const updateCountsFromFollowAction = useCallback((targetUserId: string, action: 'follow' | 'unfollow', counts: { followers: number; following: number }) => {
    const currentUserId = oxyServices.getCurrentUserId() || undefined;
    useFollowStore.getState().updateCountsFromFollowAction(targetUserId, action, counts, currentUserId);
  }, [oxyServices]);

  if (isSingleUser && userId) {
    return {
      isFollowing,
      isLoading,
      error,
      toggleFollow,
      setFollowStatus,
      fetchStatus,
      clearError,
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
    isAnyLoading: multiUserLoadingState.isAnyLoading,
    hasAnyError: multiUserLoadingState.hasAnyError,
    allFollowing: multiUserLoadingState.allFollowing,
    allNotFollowing: multiUserLoadingState.allNotFollowing,
  };
};

/**
 * useFollowForButton — Lightweight follow hook for FollowButton in list contexts.
 *
 * Unlike useFollow, this hook:
 * - Accepts oxyServices directly (no useOxy() context subscription)
 * - Only subscribes to the specific user's follow and loading state
 * - Returns only what FollowButton needs (no counts, no multi-user)
 */
export const useFollowForButton = (userId: string, oxyServices: OxyServices) => {
  const isFollowing = useFollowStore(
    useCallback((s) => s.followingUsers[userId] ?? false, [userId])
  );
  const isLoading = useFollowStore(
    useCallback((s) => s.loadingUsers[userId] ?? false, [userId])
  );
  const error = useFollowStore(
    useCallback((s) => s.errors[userId] ?? null, [userId])
  );

  const toggleFollow = useCallback(async () => {
    const currentlyFollowing = useFollowStore.getState().followingUsers[userId] ?? false;
    await useFollowStore.getState().toggleFollowUser(userId, oxyServices, currentlyFollowing);
  }, [userId, oxyServices]);

  const fetchStatus = useCallback(async () => {
    await useFollowStore.getState().fetchFollowStatus(userId, oxyServices);
  }, [userId, oxyServices]);

  const setFollowStatus = useCallback((following: boolean) => {
    useFollowStore.getState().setFollowingStatus(userId, following);
  }, [userId]);

  const clearError = useCallback(() => {
    useFollowStore.getState().clearFollowError(userId);
  }, [userId]);

  return {
    isFollowing,
    isLoading,
    error,
    toggleFollow,
    fetchStatus,
    setFollowStatus,
    clearError,
  };
};

// Convenience hook for just follower counts
export const useFollowerCounts = (userId: string) => {
  const { oxyServices } = useOxy();

  const followerCount = useFollowStore(
    useCallback((s) => s.followerCounts[userId] ?? null, [userId])
  );
  const followingCount = useFollowStore(
    useCallback((s) => s.followingCounts[userId] ?? null, [userId])
  );
  const isLoadingCounts = useFollowStore(
    useCallback((s) => s.loadingCounts[userId] ?? false, [userId])
  );

  const fetchUserCounts = useCallback(async () => {
    await useFollowStore.getState().fetchUserCounts(userId, oxyServices);
  }, [userId, oxyServices]);

  const setFollowerCount = useCallback((count: number) => {
    useFollowStore.getState().setFollowerCount(userId, count);
  }, [userId]);

  const setFollowingCount = useCallback((count: number) => {
    useFollowStore.getState().setFollowingCount(userId, count);
  }, [userId]);

  return {
    followerCount,
    followingCount,
    isLoadingCounts,
    fetchUserCounts,
    setFollowerCount,
    setFollowingCount,
  };
};
