/**
 * Avatar Picker Hook
 *
 * Extracts avatar selection logic from OxyContext for better modularity.
 *
 * Flow (typed promises over the shared surface stack — no callback props):
 *   1. `surfaces.present('FileManagement', …)` opens the image-only picker and
 *      resolves with the picked file (or `undefined` if the user cancels).
 *   2. Resolve a private-safe source URL, then `surfaces.present('AvatarCrop', …)`
 *      opens the square-crop editor and resolves with the cropped JPEG.
 *   3. The cropped JPEG is uploaded as a NEW file via `oxyServices.assetUpload`
 *      and that file becomes the user's avatar.
 *
 * `expo-image-manipulator` is required for the crop step (declared as an
 * optional peer in the consuming app) — see AvatarCropScreen.
 */

import { useCallback } from 'react';
import type { OxyServices } from '@oxyhq/core';
import { translate, updateAvatarVisibility } from '@oxyhq/core';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from '@oxyhq/bloom';
import { updateProfileWithAvatar } from '../utils/avatarUtils';
import { surfaces } from '../navigation/surfaces';
import type { AvatarCropResult } from '../screens/AvatarCropScreen';

interface UseAvatarPickerOptions {
  oxyServices: OxyServices;
  currentLanguage: string | null | undefined;
  activeSessionId: string | null;
  queryClient: QueryClient;
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

  const openAvatarPicker = useCallback(async () => {
    // 1. Present the image-only picker; it dismisses with the picked file when
    //    the user taps one, or `undefined` if they cancel.
    const file = await surfaces.present('FileManagement', {
      selectMode: true,
      multiSelect: false,
      disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
    });
    if (!file) return;

    if (!file.contentType?.startsWith('image/')) {
      toast.error(
        translate(currentLanguage ?? undefined, 'editProfile.toasts.selectImage') ||
          'Please select an image file',
      );
      return;
    }

    // 2. Resolve a working source URL. The picked file is usually PRIVATE, so
    //    the synchronous `getFileDownloadUrl` (public CDN origin) would 404 and
    //    the crop screen's `Image.getSize` would fail silently. `assetGetUrl`
    //    throws on failure (unlike `getFileDownloadUrlAsync`, which swallows
    //    errors and falls back to the broken public URL), so a failure surfaces
    //    a real user-facing error instead of a blank crop canvas. No variant is
    //    requested — cropping needs the original.
    let sourceUri: string;
    try {
      const resolved = await oxyServices.assetGetUrl(file.id);
      if (!resolved?.url) {
        throw new Error('No download URL returned for the selected image');
      }
      sourceUri = resolved.url;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : undefined;
      toast.error(
        message ||
          translate(currentLanguage ?? undefined, 'editProfile.toasts.cropMeasureFailed') ||
          'Could not load the selected image',
      );
      return;
    }

    // 3. Present the square-crop editor in place of the picker; it dismisses
    //    with the cropped JPEG on confirm, or `undefined` if cancelled.
    const cropped = await surfaces.present('AvatarCrop', { imageUri: sourceUri });
    if (!cropped) return;

    // 4. Upload + set as the user's avatar.
    await finalizeCroppedAvatar(cropped);
  }, [currentLanguage, finalizeCroppedAvatar, oxyServices]);

  return { openAvatarPicker };
}
