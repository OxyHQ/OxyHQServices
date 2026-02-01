/**
 * Avatar Picker Hook
 *
 * Extracts avatar selection logic from OxyContext for better modularity.
 * Opens the FileManagement bottom sheet in select mode for image files,
 * then updates the user's profile avatar.
 */

import { useCallback } from 'react';
import type { OxyServices } from '@oxyhq/core';
import { translate } from '@oxyhq/core';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/sonner';
import type { RouteName } from '../navigation/routes';
import { updateAvatarVisibility, updateProfileWithAvatar } from '../utils/avatarUtils';

interface UseAvatarPickerOptions {
  oxyServices: OxyServices;
  currentLanguage: string | null | undefined;
  activeSessionId: string | null;
  queryClient: QueryClient;
  showBottomSheet: (config: { screen: RouteName; props?: Record<string, unknown> }) => void;
}

export function useAvatarPicker({
  oxyServices,
  currentLanguage,
  activeSessionId,
  queryClient,
  showBottomSheet,
}: UseAvatarPickerOptions) {
  const openAvatarPicker = useCallback(() => {
    showBottomSheet({
      screen: 'FileManagement' as RouteName,
      props: {
        selectMode: true,
        multiSelect: false,
        disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
        afterSelect: 'none',
        onSelect: async (file: any) => {
          if (!file.contentType.startsWith('image/')) {
            toast.error(translate(currentLanguage ?? undefined, 'editProfile.toasts.selectImage') || 'Please select an image file');
            return;
          }
          try {
            await updateAvatarVisibility(file.id, oxyServices, 'OxyContext');
            await updateProfileWithAvatar(
              { avatar: file.id },
              oxyServices,
              activeSessionId,
              queryClient
            );
            toast.success(translate(currentLanguage ?? undefined, 'editProfile.toasts.avatarUpdated') || 'Avatar updated');
          } catch (e: any) {
            toast.error(e.message || translate(currentLanguage ?? undefined, 'editProfile.toasts.updateAvatarFailed') || 'Failed to update avatar');
          }
        },
      },
    });
  }, [oxyServices, currentLanguage, showBottomSheet, activeSessionId, queryClient]);

  return { openAvatarPicker };
}
