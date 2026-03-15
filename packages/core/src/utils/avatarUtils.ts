/**
 * Minimal interface for services that can update asset visibility.
 * Kept loose to avoid mixin type-inference issues with the OxyServices class.
 */
export interface AssetVisibilityService {
  assetUpdateVisibility(fileId: string, visibility: 'private' | 'public' | 'unlisted'): Promise<unknown>;
}

/**
 * Updates file visibility to public for avatar use.
 * Logs non-404 errors to help debug upload issues.
 *
 * @param fileId - The file ID to update visibility for
 * @param oxyServices - OxyServices instance (or any object with assetUpdateVisibility)
 * @param contextName - Context name for error logging
 */
export async function updateAvatarVisibility(
  fileId: string | undefined,
  oxyServices: AssetVisibilityService,
  contextName: string = 'AvatarUtils'
): Promise<void> {
  if (!fileId || fileId.startsWith('temp-')) {
    return;
  }

  try {
    await oxyServices.assetUpdateVisibility(fileId, 'public');
  } catch (visError: unknown) {
    // 404 is expected when asset doesn't exist yet — skip logging
    const status = (visError instanceof Error && 'status' in visError)
      ? (visError as Error & { status: number }).status
      : undefined;
    if (status !== 404) {
      console.error(`[${contextName}] Failed to update avatar visibility for ${fileId}:`, visError);
    }
  }
}
