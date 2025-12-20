import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { User } from '../../../models/interfaces';
import { queryKeys, invalidateAccountQueries, invalidateUserQueries } from '../queries/queryKeys';
import { useOxy } from '../../context/OxyContext';
import { toast } from '../../../lib/sonner';
import { refreshAvatarInStore } from '../../utils/avatarUtils';
import { useAuthStore } from '../../stores/authStore';

/**
 * Update user profile with optimistic updates and offline queue support
 */
export const useUpdateProfile = () => {
  const { oxyServices, activeSessionId, user, syncIdentity } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<User>) => {
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
        return await oxyServices.updateProfile(updates);
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
              // Retry the update after getting token
              return await oxyServices.updateProfile(updates);
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
    // Optimistic update
    onMutate: async (updates) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.accounts.current() });

      // Snapshot previous value
      const previousUser = queryClient.getQueryData<User>(queryKeys.accounts.current());

      // Optimistically update
      if (previousUser) {
        queryClient.setQueryData<User>(queryKeys.accounts.current(), {
          ...previousUser,
          ...updates,
        });

        // Also update profile query if sessionId is available
        if (activeSessionId) {
          queryClient.setQueryData<User>(queryKeys.users.profile(activeSessionId), {
            ...previousUser,
            ...updates,
          });
        }
      }

      return { previousUser };
    },
    // On error, rollback
    onError: (error, updates, context) => {
      if (context?.previousUser) {
        queryClient.setQueryData(queryKeys.accounts.current(), context.previousUser);
        if (activeSessionId) {
          queryClient.setQueryData(queryKeys.users.profile(activeSessionId), context.previousUser);
        }
      }
      toast.error(error instanceof Error ? error.message : 'Failed to update profile');
    },
    // On success, invalidate and refetch
    onSuccess: (data, updates) => {
      // Update cache with server response
      queryClient.setQueryData(queryKeys.accounts.current(), data);
      if (activeSessionId) {
        queryClient.setQueryData(queryKeys.users.profile(activeSessionId), data);
      }
      
      // Update authStore so frontend components see the changes immediately
      useAuthStore.getState().setUser(data);
      
      // If avatar was updated, refresh accountStore with cache-busted URL
      if (updates.avatar && activeSessionId && oxyServices) {
        refreshAvatarInStore(activeSessionId, updates.avatar, oxyServices);
      }
      
      // Invalidate all related queries to refresh everywhere
      invalidateUserQueries(queryClient);
      invalidateAccountQueries(queryClient);
    },
  });
};

/**
 * Upload avatar with progress tracking and offline queue support
 */
export const useUploadAvatar = () => {
  const { oxyServices, activeSessionId, syncIdentity } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: { uri: string; type?: string; name?: string; size?: number }) => {
      // Ensure we have a valid token before making the request
      if (!oxyServices.hasValidToken() && activeSessionId) {
        try {
          await oxyServices.getTokenBySession(activeSessionId);
        } catch (tokenError) {
          const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);
          if (errorMessage.includes('AUTH_REQUIRED_OFFLINE_SESSION') || errorMessage.includes('offline')) {
            try {
              await syncIdentity();
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
        // Upload file first
        const uploadResult = await oxyServices.assetUpload(file as any, 'public');
        const fileId = uploadResult?.file?.id || uploadResult?.id || uploadResult;

        if (!fileId || typeof fileId !== 'string') {
          throw new Error('Failed to get file ID from upload result');
        }

        // Update profile with file ID
        return await oxyServices.updateProfile({ avatar: fileId });
      } catch (error: any) {
        const errorMessage = error?.message || '';
        const status = error?.status || error?.response?.status;
        
        // Handle authentication errors
        if (status === 401 || errorMessage.includes('Authentication required') || errorMessage.includes('Invalid or missing authorization header')) {
          if (activeSessionId) {
            try {
              await syncIdentity();
              await oxyServices.getTokenBySession(activeSessionId);
              // Retry upload
              const uploadResult = await oxyServices.assetUpload(file as any, 'public');
              const fileId = uploadResult?.file?.id || uploadResult?.id || uploadResult;
              if (!fileId || typeof fileId !== 'string') {
                throw new Error('Failed to get file ID from upload result');
              }
              return await oxyServices.updateProfile({ avatar: fileId });
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
    onMutate: async (file) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.accounts.current() });
      const previousUser = queryClient.getQueryData<User>(queryKeys.accounts.current());

      // Optimistically set a temporary avatar (using file URI as placeholder)
      if (previousUser) {
        const optimisticUser = {
          ...previousUser,
          avatar: file.uri, // Temporary, will be replaced with fileId
        };
        queryClient.setQueryData<User>(queryKeys.accounts.current(), optimisticUser);
        if (activeSessionId) {
          queryClient.setQueryData<User>(queryKeys.users.profile(activeSessionId), optimisticUser);
        }
      }

      return { previousUser };
    },
    onError: (error, file, context) => {
      if (context?.previousUser) {
        queryClient.setQueryData(queryKeys.accounts.current(), context.previousUser);
        if (activeSessionId) {
          queryClient.setQueryData(queryKeys.users.profile(activeSessionId), context.previousUser);
        }
      }
      toast.error(error instanceof Error ? error.message : 'Failed to upload avatar');
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.accounts.current(), data);
      if (activeSessionId) {
        queryClient.setQueryData(queryKeys.users.profile(activeSessionId), data);
      }
      
      // Update authStore so frontend components see the changes immediately
      useAuthStore.getState().setUser(data);
      
      // Refresh accountStore with cache-busted URL if avatar was updated
      if (data?.avatar && activeSessionId && oxyServices) {
        refreshAvatarInStore(activeSessionId, data.avatar, oxyServices);
      }
      
      // Invalidate all related queries to refresh everywhere
      invalidateUserQueries(queryClient);
      invalidateAccountQueries(queryClient);
      toast.success('Avatar updated successfully');
    },
  });
};

/**
 * Update account settings
 */
export const useUpdateAccountSettings = () => {
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: Record<string, any>) => {
      return await oxyServices.updateProfile({ privacySettings: settings });
    },
    onMutate: async (settings) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.accounts.settings() });
      const previousUser = queryClient.getQueryData<User>(queryKeys.accounts.current());

      if (previousUser) {
        queryClient.setQueryData<User>(queryKeys.accounts.current(), {
          ...previousUser,
          privacySettings: {
            ...previousUser.privacySettings,
            ...settings,
          },
        });
      }

      return { previousUser };
    },
    onError: (error, settings, context) => {
      if (context?.previousUser) {
        queryClient.setQueryData(queryKeys.accounts.current(), context.previousUser);
      }
      toast.error(error instanceof Error ? error.message : 'Failed to update settings');
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.accounts.current(), data);
      
      // Update authStore so frontend components see the changes immediately
      useAuthStore.getState().setUser(data);
      
      invalidateAccountQueries(queryClient);
      toast.success('Settings updated successfully');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts.settings() });
    },
  });
};

/**
 * Update privacy settings with optimistic updates and authentication handling
 */
export const useUpdatePrivacySettings = () => {
  const { oxyServices, activeSessionId, syncIdentity } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ settings, userId }: { settings: Record<string, any>; userId?: string }) => {
      // Use getCurrentUserId() which returns MongoDB ObjectId from JWT token
      // Never use user?.id as it may be set to publicKey
      const targetUserId = userId || oxyServices.getCurrentUserId();
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
        return await oxyServices.updatePrivacySettings(settings, targetUserId);
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
              // Retry the update after getting token
              return await oxyServices.updatePrivacySettings(settings, targetUserId);
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
    // Optimistic update
    onMutate: async ({ settings, userId }) => {
      const targetUserId = userId || oxyServices.getCurrentUserId();
      if (!targetUserId) return;

      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.privacy.settings(targetUserId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.accounts.current() });

      // Snapshot previous values
      const previousPrivacySettings = queryClient.getQueryData(queryKeys.privacy.settings(targetUserId));
      const previousUser = queryClient.getQueryData<User>(queryKeys.accounts.current());

      // Optimistically update privacy settings
      if (previousPrivacySettings) {
        queryClient.setQueryData(queryKeys.privacy.settings(targetUserId), {
          ...previousPrivacySettings,
          ...settings,
        });
      }

      // Also update user query if available
      if (previousUser) {
        queryClient.setQueryData<User>(queryKeys.accounts.current(), {
          ...previousUser,
          privacySettings: {
            ...previousUser.privacySettings,
            ...settings,
          },
        });
      }

      return { previousPrivacySettings, previousUser };
    },
    // On error, rollback
    onError: (error, { userId }, context) => {
      const targetUserId = userId || oxyServices.getCurrentUserId();
      if (context?.previousPrivacySettings && targetUserId) {
        queryClient.setQueryData(queryKeys.privacy.settings(targetUserId), context.previousPrivacySettings);
      }
      if (context?.previousUser) {
        queryClient.setQueryData(queryKeys.accounts.current(), context.previousUser);
      }
      toast.error(error instanceof Error ? error.message : 'Failed to update privacy settings');
    },
    // On success, invalidate and refetch
    onSuccess: (data, { userId }) => {
      const targetUserId = userId || oxyServices.getCurrentUserId();
      if (targetUserId) {
        queryClient.setQueryData(queryKeys.privacy.settings(targetUserId), data);
      }
      // Also update account query if it contains privacy settings
      const currentUser = queryClient.getQueryData<User>(queryKeys.accounts.current());
      if (currentUser) {
        const updatedUser = {
          ...currentUser,
          privacySettings: data,
        };
        queryClient.setQueryData<User>(queryKeys.accounts.current(), updatedUser);
        
        // Update authStore so frontend components see the changes immediately
        useAuthStore.getState().setUser(updatedUser);
      }
      invalidateAccountQueries(queryClient);
    },
    // Always refetch after error or success
    onSettled: (data, error, { userId }) => {
      const targetUserId = userId || oxyServices.getCurrentUserId();
      if (targetUserId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.privacy.settings(targetUserId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts.current() });
    },
  });
};

/**
 * Upload file with authentication handling and progress tracking
 */
export const useUploadFile = () => {
  const { oxyServices, activeSessionId, syncIdentity } = useOxy();

  return useMutation({
    mutationFn: async ({ 
      file, 
      visibility, 
      metadata, 
      onProgress 
    }: { 
      file: File; 
      visibility?: 'private' | 'public' | 'unlisted'; 
      metadata?: Record<string, any>;
      onProgress?: (progress: number) => void;
    }) => {
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
        return await oxyServices.assetUpload(file as any, visibility, metadata, onProgress);
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
              // Retry the upload after getting token
              return await oxyServices.assetUpload(file as any, visibility, metadata, onProgress);
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
  });
};

