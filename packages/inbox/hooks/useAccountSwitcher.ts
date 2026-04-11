/**
 * Hook for multi-account switching in the Inbox app.
 *
 * Bridges the OxyContext multi-session support with the Inbox-specific state:
 * resets the zustand email store and clears the React Query cache before
 * switching to a different Oxy session.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOxy } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';
import { queryClient } from '@/hooks/queries/queryClient';
import {
  getAccounts,
  addAccount,
  removeAccount,
  setActiveAccount,
  type StoredAccount,
} from '@/utils/accountStorage';

export function useAccountSwitcher() {
  const {
    user,
    sessions,
    activeSessionId,
    switchSession,
    logout,
    isAuthenticated,
    oxyServices,
  } = useOxy();

  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);
  const initializedRef = useRef(false);

  // Load saved accounts on mount
  useEffect(() => {
    getAccounts().then(setAccounts);
  }, []);

  // Persist the current user to account storage whenever auth state changes
  useEffect(() => {
    if (!user || !activeSessionId || !isAuthenticated) return;

    const userId = user.id?.toString();
    if (!userId) return;

    const username = user.username || '';
    const displayName = user.name?.first
      ? `${user.name.first}${user.name.last ? ` ${user.name.last}` : ''}`
      : username || 'Account';
    const avatarUrl = user.avatar
      ? oxyServices.getFileDownloadUrl(user.avatar, 'thumb')
      : null;

    const account: StoredAccount = {
      userId,
      sessionId: activeSessionId,
      username,
      email: username ? `${username}@oxy.so` : '',
      displayName,
      avatarUrl,
      lastActive: new Date().toISOString(),
    };

    addAccount(account).then(() => {
      getAccounts().then(setAccounts);
    });

    initializedRef.current = true;
  }, [user, activeSessionId, isAuthenticated, oxyServices]);

  /** Reset all inbox-specific state (zustand store + React Query cache). */
  const resetInboxState = useCallback(() => {
    // Reset the zustand email store to initial state
    useEmailStore.setState({
      currentMailbox: null,
      viewMode: null,
      selectedMessageId: null,
      moreExpanded: false,
      bundleView: false,
      expandedBundles: new Set<string>(),
      selectedMessageIds: new Set<string>(),
      isSelectionMode: false,
      _api: null, // Force re-init with new auth token
    });

    // Clear all React Query caches so stale data from the previous account
    // doesn't leak into the new account's view
    queryClient.clear();
  }, []);

  /** Switch to a different account by its userId. */
  const switchAccount = useCallback(
    async (targetUserId: string): Promise<boolean> => {
      if (isSwitching) return false;

      // Find the stored account
      const stored = accounts.find((a) => a.userId === targetUserId);
      if (!stored) return false;

      // Find the matching OxyContext session
      const session = sessions.find((s) => s.sessionId === stored.sessionId);
      if (!session) {
        // Session no longer exists -- remove the stale account entry
        await removeAccount(targetUserId);
        setAccounts((prev) => prev.filter((a) => a.userId !== targetUserId));
        return false;
      }

      // Don't switch if already active
      if (session.sessionId === activeSessionId) return true;

      setIsSwitching(true);
      try {
        // Reset inbox-specific state first
        resetInboxState();

        // Switch the OxyContext session (validates token, sets new user)
        await switchSession(session.sessionId);

        // Mark as active in local storage
        await setActiveAccount(targetUserId);
        setAccounts((prev) =>
          prev.map((a) =>
            a.userId === targetUserId
              ? { ...a, lastActive: new Date().toISOString() }
              : a,
          ),
        );

        return true;
      } catch {
        // Token expired or session invalid -- remove the stale account
        await removeAccount(targetUserId);
        setAccounts((prev) => prev.filter((a) => a.userId !== targetUserId));
        return false;
      } finally {
        setIsSwitching(false);
      }
    },
    [accounts, sessions, activeSessionId, isSwitching, switchSession, resetInboxState],
  );

  /** Sign out of a specific account (or the current one). */
  const signOutAccount = useCallback(
    async (targetUserId: string) => {
      const stored = accounts.find((a) => a.userId === targetUserId);
      const isCurrentAccount = stored?.sessionId === activeSessionId;

      // Remove from local storage
      await removeAccount(targetUserId);
      setAccounts((prev) => prev.filter((a) => a.userId !== targetUserId));

      if (isCurrentAccount) {
        resetInboxState();
        await logout();
      }
    },
    [accounts, activeSessionId, logout, resetInboxState],
  );

  // Build the list with the current user always included
  const currentUserId = user?.id?.toString() ?? null;

  // Filter out accounts that no longer have a valid session in OxyContext,
  // but always keep the current user.
  const validAccounts = accounts.filter((a) => {
    if (a.userId === currentUserId) return true;
    return sessions.some((s) => s.sessionId === a.sessionId);
  });

  return {
    accounts: validAccounts,
    currentUserId,
    isSwitching,
    switchAccount,
    signOutAccount,
    resetInboxState,
  };
}
