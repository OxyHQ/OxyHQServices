import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authenticatedApiCall } from '@oxyhq/core';
import type { AssetUploadInput, User } from '@oxyhq/core';
import { queryKeys, invalidateAccountQueries, invalidateUserQueries, invalidateSessionQueries } from '../queries/queryKeys';
import { mutationKeys } from './mutationKeys';
import { useOxy } from '../../context/OxyContext';
import { toast } from '../../../lib/sonner';
import { refreshAvatarInStore } from '../../utils/avatarUtils';
import { useAuthStore } from '../../stores/authStore';

/**
 * Update user profile with optimistic updates and offline queue support
 */
export const useUpdateProfile = () => {
  const { oxyServices, activeSessionId, user } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...mutationKeys.account.updateProfile],
    mutationFn: async (updates: Partial<User>) => {
      return authenticatedApiCall<User>(
        oxyServices,
        activeSessionId,
        () => oxyServices.updateProfile(updates)
      );
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
    // On error, rollback ONLY the keys this mutation tried to change
    onError: (error, updates, context) => {
      if (context?.previousUser && updates) {
        const previousUser = context.previousUser;
        const changedKeys = Object.keys(updates) as Array<keyof User>;
        const partialRollback = changedKeys.reduce<Partial<User>>((acc, key) => {
          (acc as Record<string, unknown>)[key as string] = previousUser[key];
          return acc;
        }, {});

        const current = queryClient.getQueryData<User>(queryKeys.accounts.current());
        if (current) {
          queryClient.setQueryData<User>(queryKeys.accounts.current(), {
            ...current,
            ...partialRollback,
          });
        }
        if (activeSessionId) {
          const currentProfile = queryClient.getQueryData<User>(queryKeys.users.profile(activeSessionId));
          if (currentProfile) {
            queryClient.setQueryData<User>(queryKeys.users.profile(activeSessionId), {
              ...currentProfile,
              ...partialRollback,
            });
          }
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

      // Invalidate all related queries so every consumer (AccountSwitcher,
      // session lists, managed accounts, etc.) refetches the fresh profile.
      // This is critical right after `username` is set the first time, when
      // every cached "session profile" still reports the user as unnamed.
      invalidateUserQueries(queryClient);
      invalidateAccountQueries(queryClient);
      invalidateSessionQueries(queryClient);
    },
  });
};

/**
 * Upload avatar with progress tracking and offline queue support
 */
export const useUploadAvatar = () => {
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...mutationKeys.account.uploadAvatar],
    mutationFn: async (file: { uri: string; type?: string; name?: string; size?: number }) => {
      return authenticatedApiCall<User>(oxyServices, activeSessionId, async () => {
        const uploadResult = await oxyServices.assetUpload(file, 'public');
        const fileId = uploadResult?.file?.id;

        if (!fileId || typeof fileId !== 'string') {
          throw new Error('Upload succeeded but response did not contain a file ID');
        }

        // Update profile with file ID
        return await oxyServices.updateProfile({ avatar: fileId });
      });
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
    onError: (error, _file, context) => {
      // Avatar upload only mutates the `avatar` field — restore only that key
      if (context?.previousUser) {
        const previousAvatar = context.previousUser.avatar;
        const current = queryClient.getQueryData<User>(queryKeys.accounts.current());
        if (current) {
          queryClient.setQueryData<User>(queryKeys.accounts.current(), {
            ...current,
            avatar: previousAvatar,
          });
        }
        if (activeSessionId) {
          const currentProfile = queryClient.getQueryData<User>(queryKeys.users.profile(activeSessionId));
          if (currentProfile) {
            queryClient.setQueryData<User>(queryKeys.users.profile(activeSessionId), {
              ...currentProfile,
              avatar: previousAvatar,
            });
          }
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

      // Invalidate all related queries to refresh everywhere, including the
      // sessions cache so other-account avatars update too.
      invalidateUserQueries(queryClient);
      invalidateAccountQueries(queryClient);
      invalidateSessionQueries(queryClient);
      toast.success('Avatar updated successfully');
    },
  });
};

/**
 * Update account settings (privacy preferences).
 *
 * Privacy settings are not part of the `PUT /users/me` allow-list; the API
 * would silently drop them. Route through `updatePrivacySettings` so the
 * dedicated `PATCH /privacy/:id/privacy` endpoint performs a dot-path merge
 * and returns the updated `privacySettings` object.
 */
export const useUpdateAccountSettings = () => {
  const { oxyServices, activeSessionId, user } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...mutationKeys.account.updateSettings],
    mutationFn: async (settings: Record<string, unknown>) => {
      const userId = user?.id;
      if (!userId) {
        throw new Error('User ID is required to update account settings');
      }
      const updatedPrivacy = await authenticatedApiCall<Record<string, unknown>>(
        oxyServices,
        activeSessionId,
        () => oxyServices.updatePrivacySettings(settings, userId)
      );
      // Reflect the merged privacy block back onto the user object so cache
      // consumers that key off `User.privacySettings` see the change.
      const currentUser = queryClient.getQueryData<User>(queryKeys.accounts.current());
      if (currentUser) {
        return {
          ...currentUser,
          privacySettings: updatedPrivacy as { [key: string]: unknown },
        };
      }
      return { privacySettings: updatedPrivacy } as unknown as User;
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
      // Restore only the privacySettings keys this mutation tried to change
      if (context?.previousUser && settings) {
        const previousPrivacy = (context.previousUser.privacySettings ?? {}) as Record<string, unknown>;
        const changedKeys = Object.keys(settings);
        const partialPrivacyRollback = changedKeys.reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = previousPrivacy[key];
          return acc;
        }, {});

        const current = queryClient.getQueryData<User>(queryKeys.accounts.current());
        if (current) {
          queryClient.setQueryData<User>(queryKeys.accounts.current(), {
            ...current,
            privacySettings: {
              ...(current.privacySettings ?? {}),
              ...partialPrivacyRollback,
            } as { [key: string]: unknown },
          });
        }
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
  const { oxyServices, activeSessionId, user } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: [...mutationKeys.account.updatePrivacySettings],
    mutationFn: async ({ settings, userId }: { settings: Record<string, unknown>; userId?: string }) => {
      const targetUserId = userId || user?.id;
      if (!targetUserId) {
        throw new Error('User ID is required');
      }

      return authenticatedApiCall<Record<string, unknown>>(
        oxyServices,
        activeSessionId,
        () => oxyServices.updatePrivacySettings(settings, targetUserId)
      );
    },
    // Optimistic update
    onMutate: async ({ settings, userId }) => {
      const targetUserId = userId || user?.id;
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
    // On error, rollback ONLY the privacy keys this mutation tried to change.
    // Restoring the entire previous object would wipe out other concurrent
    // optimistic updates (e.g. user toggles two privacy switches in quick
    // succession; failure on one must not revert the other).
    onError: (error, { settings, userId }, context) => {
      const targetUserId = userId || user?.id;
      const changedKeys = settings ? Object.keys(settings) : [];

      // Rollback the privacy.settings query (partial)
      if (context?.previousPrivacySettings && targetUserId && changedKeys.length > 0) {
        const previousPrivacy = context.previousPrivacySettings as Record<string, unknown>;
        const partialPrivacyRollback = changedKeys.reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = previousPrivacy[key];
          return acc;
        }, {});
        const currentPrivacy = queryClient.getQueryData<Record<string, unknown>>(queryKeys.privacy.settings(targetUserId));
        if (currentPrivacy) {
          queryClient.setQueryData(queryKeys.privacy.settings(targetUserId), {
            ...currentPrivacy,
            ...partialPrivacyRollback,
          });
        }
      }

      // Rollback the accounts.current() user.privacySettings (partial)
      if (context?.previousUser && changedKeys.length > 0) {
        const previousPrivacy = (context.previousUser.privacySettings ?? {}) as Record<string, unknown>;
        const partialPrivacyRollback = changedKeys.reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = previousPrivacy[key];
          return acc;
        }, {});
        const current = queryClient.getQueryData<User>(queryKeys.accounts.current());
        if (current) {
          queryClient.setQueryData<User>(queryKeys.accounts.current(), {
            ...current,
            privacySettings: {
              ...(current.privacySettings ?? {}),
              ...partialPrivacyRollback,
            } as { [key: string]: unknown },
          });
        }
      }

      toast.error(error instanceof Error ? error.message : 'Failed to update privacy settings');
    },
    // On success, MERGE the server response into the cached state. Older
    // API builds returned only the changed field (or wiped the privacySettings
    // subdocument when handed a partial update), which would clobber every
    // other toggle if we blindly replaced. Defensive merge means the UI stays
    // consistent regardless of server behaviour.
    onSuccess: (data, { userId, settings }) => {
      const targetUserId = userId || user?.id;
      const incoming = (data ?? {}) as Record<string, unknown>;
      const requested = (settings ?? {}) as Record<string, unknown>;

      if (targetUserId) {
        queryClient.setQueryData<Record<string, unknown>>(
          queryKeys.privacy.settings(targetUserId),
          (previous) => ({
            ...(previous ?? {}),
            ...requested,
            ...incoming,
          }),
        );
      }

      const currentUser = queryClient.getQueryData<User>(queryKeys.accounts.current());
      if (currentUser) {
        const updatedUser: User = {
          ...currentUser,
          privacySettings: {
            ...((currentUser.privacySettings as Record<string, unknown> | undefined) ?? {}),
            ...requested,
            ...incoming,
          },
        };
        queryClient.setQueryData<User>(queryKeys.accounts.current(), updatedUser);
        useAuthStore.getState().setUser(updatedUser);
      }
      invalidateAccountQueries(queryClient);
    },
    // Deliberately NOT invalidating the privacy.settings cache here. A
    // background refetch against a backend that overwrites partial updates
    // would re-fetch a wiped subdocument and revert the user's toggle. The
    // onSuccess merge above is the source of truth.
  });
};

/** Uploaded file data structure from API */
interface UploadedFile {
  id: string;
  originalName?: string;
  sha256?: string;
  mime?: string;
  size?: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  variants?: Array<{ type: string; key: string; width?: number; height?: number; readyAt?: string; metadata?: Record<string, unknown> }>;
}

/** Upload result type that supports both single file and batch responses */
interface UploadResult {
  file?: UploadedFile;
  files?: UploadedFile[];
  id?: string;
}

/**
 * Upload file with authentication handling and progress tracking
 */
export const useUploadFile = () => {
  const { oxyServices, activeSessionId } = useOxy();

  return useMutation({
    mutationKey: [...mutationKeys.account.uploadFile],
    mutationFn: async ({
      file,
      visibility,
      metadata,
      onProgress,
    }: {
      file: AssetUploadInput;
      visibility?: 'private' | 'public' | 'unlisted';
      metadata?: Record<string, unknown>;
      onProgress?: (progress: number) => void;
    }) => {
      return authenticatedApiCall<UploadResult>(
        oxyServices,
        activeSessionId,
        () => oxyServices.assetUpload(file, visibility, metadata, onProgress)
      );
    },
  });
};

