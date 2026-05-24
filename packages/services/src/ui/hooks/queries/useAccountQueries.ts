import { useEffect } from 'react';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { authenticatedApiCall } from '@oxyhq/core';
import type { User } from '@oxyhq/core';
import { queryKeys } from './queryKeys';
import { mutationKeys } from '../mutations/mutationKeys';
import { useOxy } from '../../context/OxyContext';
import { useAuthStore } from '../../stores/authStore';

/**
 * Get user profile by session ID
 */
export const useUserProfile = (sessionId: string | null, options?: { enabled?: boolean }) => {
  const { oxyServices } = useOxy();

  return useQuery({
    queryKey: queryKeys.users.profile(sessionId || ''),
    queryFn: async () => {
      if (!sessionId) {
        throw new Error('Session ID is required');
      }
      return await oxyServices.getUserBySession(sessionId);
    },
    enabled: (options?.enabled !== false) && !!sessionId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
};

/**
 * Get multiple user profiles by session IDs (batch query)
 */
export const useUserProfiles = (sessionIds: string[], options?: { enabled?: boolean }) => {
  const { oxyServices } = useOxy();

  return useQueries({
    queries: sessionIds.map((sessionId) => ({
      queryKey: queryKeys.users.profile(sessionId),
      queryFn: async () => {
        const results = await oxyServices.getUsersBySessions([sessionId]);
        return results[0]?.user || null;
      },
      enabled: (options?.enabled !== false) && !!sessionId,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    })),
  });
};

/**
 * Get current authenticated user.
 *
 * The store-mirror effect must NOT overwrite the in-memory user while a
 * write mutation is in flight — otherwise a stale background refetch
 * landing between optimistic update and server-confirmed update would
 * revert the optimistic value and flicker the UI.
 *
 * We gate the mirror on the mutation-cache state for any mutation that
 * touches `User` shape (profile, avatar, settings, privacy). When any of
 * those is in flight we skip the mirror entirely; the winning onSuccess
 * handler is responsible for writing the final value to the store.
 */
export const useCurrentUser = (options?: { enabled?: boolean }) => {
  const { oxyServices, activeSessionId, isAuthenticated } = useOxy();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.accounts.current(),
    queryFn: async () => {
      if (!activeSessionId) {
        throw new Error('No active session');
      }
      return await oxyServices.getUserBySession(activeSessionId);
    },
    enabled: (options?.enabled !== false) && isAuthenticated && !!activeSessionId,
    staleTime: 1 * 60 * 1000, // 1 minute for current user
    gcTime: 30 * 60 * 1000,
  });

  // Mirror fresh server-side user into the auth store so consumers reading
  // useOxy().user pick up newly-arriving fields (createdAt, updatedAt, etc.).
  //
  // Guard 1 (mutation in flight): skip if ANY user-shape mutation is in
  // flight — the in-progress optimistic value must not be reverted by a
  // background refetch.
  // Guard 2 (staleness): if the existing store user has a strictly newer
  // `updatedAt` than the incoming data, skip. Protects against late-
  // arriving refetches that race with an already-completed mutation.
  const data = query.data;
  useEffect(() => {
    if (!data) return;

    // Check for any write mutation that mutates the user shape. Match by
    // any prefix of the user-write mutation keys we own — `isMutating`
    // matches mutations whose `mutationKey` starts with the provided key.
    const userWriteMutationsInFlight =
      queryClient.isMutating({ mutationKey: mutationKeys.account.updateProfile }) +
      queryClient.isMutating({ mutationKey: mutationKeys.account.uploadAvatar }) +
      queryClient.isMutating({ mutationKey: mutationKeys.account.updateSettings }) +
      queryClient.isMutating({ mutationKey: mutationKeys.account.updatePrivacySettings });

    if (userWriteMutationsInFlight > 0) {
      return;
    }

    // updatedAt-based staleness gate. Tolerates missing fields on either
    // side: when the server response or stored user omits `updatedAt`
    // (partial updates, legacy users), fall through to the mirror — the
    // mutation-in-flight guard above is the primary defense.
    const storedUser = useAuthStore.getState().user;
    const incomingUpdatedAt = parseUpdatedAt(data.updatedAt);
    const storedUpdatedAt = parseUpdatedAt(storedUser?.updatedAt);
    if (
      incomingUpdatedAt !== null &&
      storedUpdatedAt !== null &&
      incomingUpdatedAt < storedUpdatedAt
    ) {
      return;
    }

    useAuthStore.getState().setUser(data);
  }, [data, queryClient]);

  return query;
};

/**
 * Best-effort parser for the various `updatedAt` representations the API
 * returns (ISO string, epoch number, Date instance, undefined). Returns
 * `null` when the value can't be interpreted as a finite timestamp — the
 * caller then falls back to the mutation-in-flight guard.
 */
function parseUpdatedAt(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Get user by ID
 */
export const useUserById = (userId: string | null, options?: { enabled?: boolean }) => {
  const { oxyServices } = useOxy();

  return useQuery({
    queryKey: queryKeys.users.detail(userId || ''),
    queryFn: async () => {
      if (!userId) {
        throw new Error('User ID is required');
      }
      return await oxyServices.getUserById(userId);
    },
    enabled: (options?.enabled !== false) && !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

/**
 * Get user profile by username
 */
export const useUserByUsername = (username: string | null, options?: { enabled?: boolean }) => {
  const { oxyServices } = useOxy();

  return useQuery({
    queryKey: [...queryKeys.users.details(), 'username', username || ''],
    queryFn: async () => {
      if (!username) {
        throw new Error('Username is required');
      }
      return await oxyServices.getProfileByUsername(username);
    },
    enabled: (options?.enabled !== false) && !!username,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

/**
 * Batch get users by session IDs (optimized single API call)
 */
export const useUsersBySessions = (sessionIds: string[], options?: { enabled?: boolean }) => {
  const { oxyServices } = useOxy();

  return useQuery({
    queryKey: queryKeys.accounts.list(sessionIds),
    queryFn: async () => {
      if (sessionIds.length === 0) {
        return [];
      }
      return await oxyServices.getUsersBySessions(sessionIds);
    },
    enabled: (options?.enabled !== false) && sessionIds.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

/**
 * Get privacy settings for a user
 */
export const usePrivacySettings = (userId?: string, options?: { enabled?: boolean }) => {
  const { oxyServices, activeSessionId, user } = useOxy();
  const targetUserId = userId || user?.id;

  return useQuery({
    queryKey: queryKeys.privacy.settings(targetUserId),
    queryFn: async () => {
      if (!targetUserId) {
        throw new Error('User ID is required');
      }

      return authenticatedApiCall(
        oxyServices,
        activeSessionId,
        () => oxyServices.getPrivacySettings(targetUserId)
      );
    },
    enabled: (options?.enabled !== false) && !!targetUserId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

