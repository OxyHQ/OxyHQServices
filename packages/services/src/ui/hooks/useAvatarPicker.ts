/**
 * Avatar Picker Hook
 *
 * Extracts avatar selection logic from OxyContext for better modularity.
 *
 * Flow:
 *   1. Open the FileManagement bottom sheet in select mode for image files.
 *   2. After the user picks an image, route to the AvatarCrop screen so they
 *      can square-crop + zoom before the avatar is set.
 *   3. The cropped JPEG is uploaded as a NEW file via `oxyServices.assetUpload`
 *      and that file becomes the user's avatar.
 *
 * `expo-image-manipulator` is required for the crop step (declared as an
 * optional peer in the consuming app) — see AvatarCropScreen.
 */

import { useCallback } from 'react';
import type { FileMetadata, OxyServices } from '@oxyhq/core';
import { translate, updateAvatarVisibility } from '@oxyhq/core';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/sonner';
import type { RouteName } from '../navigation/routes';
import { updateProfileWithAvatar } from '../utils/avatarUtils';
import type { AvatarCropResult } from '../screens/AvatarCropScreen';

interface UseAvatarPickerOptions {
  oxyServices: OxyServices;
  currentLanguage: string | null | undefined;
  activeSessionId: string | null;
  queryClient: QueryClient;
  showBottomSheet: (config: { screen: RouteName; props?: Record<string, unknown> }) => void;
}

/** Upload result shape returned by oxyServices.assetUpload (single-file path). */
interface AssetUploadResult {
  file?: { id?: string };
  files?: Array<{ id?: string }>;
  id?: string;
}

function extractUploadedFileId(result: AssetUploadResult | undefined): string | undefined {
  if (!result) return undefined;
  if (typeof result.id === 'string') return result.id;
  if (result.file?.id) return result.file.id;
  const first = result.files?.[0];
  if (first?.id) return first.id;
  return undefined;
}

export function useAvatarPicker({
  oxyServices,
  currentLanguage,
  activeSessionId,
  queryClient,
  showBottomSheet,
}: UseAvatarPickerOptions) {
  /**
   * Final step: take the cropped JPEG, upload it as a new public file, then
   * set it as the user's avatar. Fires success/error toasts.
   */
  const finalizeCroppedAvatar = useCallback(
    async (cropped: AvatarCropResult) => {
      try {
        const uploadResult = (await oxyServices.assetUpload(
          {
            uri: cropped.uri,
            type: cropped.mime,
            name: `avatar-${Date.now()}.jpg`,
          },
          'public',
        )) as AssetUploadResult;

        const newFileId = extractUploadedFileId(uploadResult);
        if (!newFileId) {
          throw new Error('Avatar upload succeeded but no file ID was returned');
        }

        await updateAvatarVisibility(newFileId, oxyServices, 'useAvatarPicker');
        await updateProfileWithAvatar(
          { avatar: newFileId },
          oxyServices,
          activeSessionId,
          queryClient,
        );

        toast.success(
          translate(currentLanguage ?? undefined, 'editProfile.toasts.avatarUpdated') ||
            'Avatar updated',
        );
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : undefined;
        toast.error(
          message ||
            translate(currentLanguage ?? undefined, 'editProfile.toasts.updateAvatarFailed') ||
            'Failed to update avatar',
        );
      }
    },
    [activeSessionId, currentLanguage, oxyServices, queryClient],
  );

  /**
   * After the user picks a file in the FileManagement sheet, route to the
   * crop screen with the file's download URL as the source image.
   */
  const handleFilePicked = useCallback(
    (file: FileMetadata) => {
      if (!file.contentType?.startsWith('image/')) {
        toast.error(
          translate(currentLanguage ?? undefined, 'editProfile.toasts.selectImage') ||
            'Please select an image file',
        );
        return;
      }

      // Use the public download URL of the picked file as the crop source.
      // The OxyServices file URL endpoints accept image variants, but for
      // cropping we want the original — passing no variant returns it.
      const sourceUri = oxyServices.getFileDownloadUrl(file.id);

      showBottomSheet({
        screen: 'AvatarCrop',
        props: {
          imageUri: sourceUri,
          onConfirm: finalizeCroppedAvatar,
        },
      });
    },
    [currentLanguage, finalizeCroppedAvatar, oxyServices, showBottomSheet],
  );

  const openAvatarPicker = useCallback(() => {
    showBottomSheet({
      screen: 'FileManagement',
      props: {
        selectMode: true,
        multiSelect: false,
        disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
        afterSelect: 'none',
        onSelect: handleFilePicked,
      },
    });
  }, [handleFilePicked, showBottomSheet]);

  return { openAvatarPicker };
}
