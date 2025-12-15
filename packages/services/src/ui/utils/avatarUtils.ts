import type { OxyServices } from '../../core';
import type { User } from '../../models/interfaces';
import { useAccountStore } from '../stores/accountStore';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateUserQueries, invalidateAccountQueries } from '../hooks/queries/queryKeys';

/**
 * Updates file visibility to public for avatar use.
 * Handles errors gracefully, only logging non-404 errors.
 * 
 * @param fileId - The file ID to update visibility for
 * @param oxyServices - OxyServices instance
 * @param contextName - Optional context name for logging
 * @returns Promise that resolves when visibility is updated (or skipped)
 */
export async function updateAvatarVisibility(
  fileId: string | undefined,
  oxyServices: OxyServices,
  contextName: string = 'AvatarUtils'
): Promise<void> {
  // Skip if temporary asset ID or no file ID
  if (!fileId || fileId.startsWith('temp-')) {
    return;
  }

  try {
    await oxyServices.assetUpdateVisibility(fileId, 'public');
    console.log(`[${contextName}] Avatar visibility updated to public`);
  } catch (visError: any) {
    // Only log non-404 errors (404 means asset doesn't exist yet, which is OK)
    if (visError?.response?.status !== 404) {
      console.warn(`[${contextName}] Failed to update avatar visibility, continuing anyway:`, visError);
    }
  }
}

/**
 * Refreshes avatar in accountStore with cache-busted URL to force image reload.
 * 
 * @param sessionId - The session ID for the account to update
 * @param avatarFileId - The new avatar file ID
 * @param oxyServices - OxyServices instance to generate download URL
 */
export function refreshAvatarInStore(
  sessionId: string,
  avatarFileId: string,
  oxyServices: OxyServices
): void {
  const { updateAccount } = useAccountStore.getState();
  const cacheBustedUrl = oxyServices.getFileDownloadUrl(avatarFileId, 'thumb') + `?t=${Date.now()}`;
  updateAccount(sessionId, {
    avatar: avatarFileId,
    avatarUrl: cacheBustedUrl,
  });
}

/**
 * Updates user profile with avatar and handles all side effects (query invalidation, accountStore update).
 * This function can be used from within OxyContext provider without requiring useOxy hook.
 * 
 * @param updates - Profile updates including avatar
 * @param oxyServices - OxyServices instance
 * @param activeSessionId - Active session ID
 * @param queryClient - TanStack Query client
 * @param syncIdentity - Optional sync identity function for handling auth errors
 * @returns Promise that resolves with updated user data
 */
export async function updateProfileWithAvatar(
  updates: Partial<User>,
  oxyServices: OxyServices,
  activeSessionId: string | null,
  queryClient: QueryClient,
  syncIdentity?: () => Promise<User>
): Promise<User> {
  // Ensure we have a valid token before making the request
  if (!oxyServices.hasValidToken() && activeSessionId) {
    try {
      await oxyServices.getTokenBySession(activeSessionId);
    } catch (tokenError) {
      const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);
      if (errorMessage.includes('AUTH_REQUIRED_OFFLINE_SESSION') || errorMessage.includes('offline')) {
        if (syncIdentity) {
          try {
            await syncIdentity();
            await oxyServices.getTokenBySession(activeSessionId);
          } catch (syncError) {
            throw new Error('Session needs to be synced. Please try again.');
          }
        } else {
          throw tokenError;
        }
      } else {
        throw tokenError;
      }
    }
  }

  try {
    const data = await oxyServices.updateProfile(updates);
    
    // Update cache with server response
    queryClient.setQueryData(queryKeys.accounts.current(), data);
    if (activeSessionId) {
      queryClient.setQueryData(queryKeys.users.profile(activeSessionId), data);
    }
    
    // If avatar was updated, refresh accountStore with cache-busted URL
    if (updates.avatar && activeSessionId) {
      refreshAvatarInStore(activeSessionId, updates.avatar, oxyServices);
    }
    
    // Invalidate all related queries to refresh everywhere
    invalidateUserQueries(queryClient);
    invalidateAccountQueries(queryClient);
    
    return data;
  } catch (error: any) {
    const errorMessage = error?.message || '';
    const status = error?.status || error?.response?.status;
    
    // Handle authentication errors
    if (status === 401 || errorMessage.includes('Authentication required') || errorMessage.includes('Invalid or missing authorization header')) {
      if (activeSessionId && syncIdentity) {
        try {
          await syncIdentity();
          await oxyServices.getTokenBySession(activeSessionId);
          // Retry the update after getting token
          return await updateProfileWithAvatar(updates, oxyServices, activeSessionId, queryClient, syncIdentity);
        } catch (retryError) {
          throw new Error('Authentication failed. Please sign in again.');
        }
      } else {
        throw new Error('No active session. Please sign in.');
      }
    }
    
    throw error;
  }
}

