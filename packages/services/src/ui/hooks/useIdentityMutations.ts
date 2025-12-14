/**
 * TanStack Query mutations for identity operations
 * Provides offline-first mutations for identity creation, import, and sync
 * Never deletes identity on errors - preserves user data
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { User } from '../../models/interfaces';

export interface CreateIdentityResult {
  recoveryPhrase: string[];
  synced: boolean;
}

export interface ImportIdentityResult {
  synced: boolean;
}

/**
 * Hook for creating a new identity with offline support
 * Never deletes identity on error - preserves user data
 */
export function useCreateIdentity(
  createIdentityFn: () => Promise<CreateIdentityResult>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createIdentityFn,
    onSuccess: (data) => {
      // Invalidate user queries to refetch after identity creation
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['identity'] });
    },
    onError: (error) => {
      // Never delete identity on error - just log it
      // User can recover using recovery phrase
      if (__DEV__) {
        console.warn('[useCreateIdentity] Identity creation error (identity may still exist):', error);
      }
    },
    retry: false, // Don't retry identity creation
    networkMode: 'offlineFirst',
  });
}

/**
 * Hook for importing an identity from recovery phrase
 * Never deletes identity on error - preserves user data
 */
export function useImportIdentity(
  importIdentityFn: (phrase: string) => Promise<ImportIdentityResult>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: importIdentityFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['identity'] });
    },
    onError: (error) => {
      // Never delete identity on error - just log it
      if (__DEV__) {
        console.warn('[useImportIdentity] Identity import error (identity may still exist):', error);
      }
    },
    retry: false,
    networkMode: 'offlineFirst',
  });
}

/**
 * Hook for syncing identity with server
 * Never deletes identity on error - only logs and allows retry
 */
export function useSyncIdentity(
  syncIdentityFn: () => Promise<User>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncIdentityFn,
    onSuccess: (user) => {
      // Update user cache
      queryClient.setQueryData(['user', 'current'], user);
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['identity'] });
    },
    onError: (error) => {
      // Never delete identity on error - just log it
      // User can retry sync later or use recovery phrase
      if (__DEV__) {
        console.warn('[useSyncIdentity] Sync failed, but identity is preserved:', error);
      }
    },
    retry: (failureCount, error: any) => {
      // Retry up to 2 times for sync operations
      // Don't retry if it's a network error - user can retry when online
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isNetworkError = 
        errorMessage.includes('Network') ||
        errorMessage.includes('Failed to fetch') ||
        error?.code === 'NETWORK_ERROR';
      
      if (isNetworkError) {
        return false; // Don't retry network errors - user will retry when online
      }
      
      return failureCount < 2;
    },
    networkMode: 'offlineFirst',
  });
}

