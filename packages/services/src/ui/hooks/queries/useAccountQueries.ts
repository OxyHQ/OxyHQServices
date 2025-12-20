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

/**
 * Get privacy settings for a user
 */
export const usePrivacySettings = (userId?: string, options?: { enabled?: boolean }) => {
  const { oxyServices, activeSessionId, syncIdentity } = useOxy();
  // Use getCurrentUserId() which returns MongoDB ObjectId from JWT token
  // Never use user?.id as it may be set to publicKey
  const targetUserId = userId || oxyServices.getCurrentUserId() || undefined;

  return useQuery({
    queryKey: queryKeys.privacy.settings(targetUserId),
    queryFn: async () => {
      if (!targetUserId) {
        throw new Error('User ID is required');
      }

      // Ensure we have a valid token before making the request
      if (!oxyServices.hasValidToken() && activeSessionId) {
        try {
          // Try to get token for the session
          await oxyServices.getTokenBySession(activeSessionId);
        } catch (tokenError) {
          // If getting token fails, might be an offline session - try syncing
          const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);
          if (errorMessage.includes('AUTH_REQUIRED_OFFLINE_SESSION') || errorMessage.includes('offline')) {
            try {
              await syncIdentity();
              // Retry getting token after sync
              await oxyServices.getTokenBySession(activeSessionId);
            } catch (syncError) {
              throw new Error('Session needs to be synced. Please try again.');
            }
          } else {
            throw tokenError;
          }
        }
      }

      try {
        return await oxyServices.getPrivacySettings(targetUserId);
      } catch (error: any) {
        const errorMessage = error?.message || '';
        const status = error?.status || error?.response?.status;
        
        // Handle authentication errors
        if (status === 401 || errorMessage.includes('Authentication required') || errorMessage.includes('Invalid or missing authorization header')) {
          // Try to sync session and get token
          if (activeSessionId) {
            try {
              await syncIdentity();
              await oxyServices.getTokenBySession(activeSessionId);
              // Retry the request after getting token
              return await oxyServices.getPrivacySettings(targetUserId);
            } catch (retryError) {
              throw new Error('Authentication failed. Please sign in again.');
            }
          } else {
            throw new Error('No active session. Please sign in.');
          }
        }
        
        // TanStack Query will automatically retry on network errors
        throw error;
      }
    },
    enabled: (options?.enabled !== false) && !!targetUserId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

