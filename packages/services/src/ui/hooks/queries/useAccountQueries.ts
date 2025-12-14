import { useQuery, useQueries } from '@tanstack/react-query';
import type { User } from '../../../models/interfaces';
import type { OxyServices } from '../../../core';
import { queryKeys } from './queryKeys';
import { useOxy } from '../../context/OxyContext';

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
 * Get current authenticated user
 */
export const useCurrentUser = (options?: { enabled?: boolean }) => {
  const { oxyServices, activeSessionId, isAuthenticated } = useOxy();

  return useQuery({
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
};

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

