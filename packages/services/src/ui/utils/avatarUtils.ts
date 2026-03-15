import { authenticatedApiCall } from '@oxyhq/core';
import type { OxyServices, User } from '@oxyhq/core';
import { useAccountStore } from '../stores/accountStore';
import { useAuthStore } from '../stores/authStore';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateUserQueries, invalidateAccountQueries } from '../hooks/queries/queryKeys';

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
 * @param syncSession - Optional function to sync session/refresh token when auth errors occur
 * @returns Promise that resolves with updated user data
 */
export async function updateProfileWithAvatar(
  updates: Partial<User>,
  oxyServices: OxyServices,
  activeSessionId: string | null,
  queryClient: QueryClient,
  syncSession?: () => Promise<User>
): Promise<User> {
  const data = await authenticatedApiCall<User>(
    oxyServices,
    activeSessionId,
    () => oxyServices.updateProfile(updates),
    syncSession
  );

  // Update cache with server response
  queryClient.setQueryData(queryKeys.accounts.current(), data);
  if (activeSessionId) {
    queryClient.setQueryData(queryKeys.users.profile(activeSessionId), data);
  }

  // Update authStore so frontend components see the changes immediately
  useAuthStore.getState().setUser(data);

  // If avatar was updated, refresh accountStore with cache-busted URL
  if (updates.avatar && activeSessionId) {
    refreshAvatarInStore(activeSessionId, updates.avatar, oxyServices);
  }

  // Invalidate all related queries to refresh everywhere
  invalidateUserQueries(queryClient);
  invalidateAccountQueries(queryClient);

  return data;
}
