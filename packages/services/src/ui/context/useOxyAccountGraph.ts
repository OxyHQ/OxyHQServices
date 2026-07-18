import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { OxyServices, AccountNode, CreateAccountInput, AccountDialogController, SessionClient } from '@oxyhq/core';
import { logger as loggerUtil } from '@oxyhq/core';
import { useAuthStore } from '../stores/authStore';
import { isUnauthorizedStatus } from './oxyContextHelpers';
import { resetSessionScopedStores } from '../stores/resetSessionScopedStores';
import { ASSET_DOWNLOAD_URLS_QUERY_KEY } from '../hooks/useResolvedFileUrls';
import type { CommitInput } from './oxyContextTypes';

interface UseOxyAccountGraphParams {
  isAuthenticated: boolean;
  tokenReady: boolean;
  initialized: boolean;
  oxyServices: OxyServices;
  sessionClient: SessionClient;
  syncFromClient: () => Promise<void>;
  commitSession: (input: CommitInput, options: { activate: boolean; hubSync?: boolean }) => Promise<void>;
  queryClient: QueryClient;
  accountDialogControllerRef: RefObject<AccountDialogController | null>;
  clearSessionStateRef: RefObject<() => Promise<void>>;
}

export function useOxyAccountGraph({
  isAuthenticated,
  tokenReady,
  initialized,
  oxyServices,
  sessionClient,
  syncFromClient,
  commitSession,
  queryClient,
  accountDialogControllerRef,
  clearSessionStateRef,
}: UseOxyAccountGraphParams) {
  const [accounts, setAccounts] = useState<AccountNode[]>([]);

  const refreshAccounts = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || !tokenReady || !oxyServices.getAccessToken()) {
      setAccounts([]);
      return;
    }
    try {
      const list = await oxyServices.listAccounts();
      setAccounts(list);
    } catch (err) {
      if (isUnauthorizedStatus(err)) {
        setAccounts([]);
        await clearSessionStateRef.current();
        return;
      }
      if (__DEV__) {
        loggerUtil.debug('Failed to load accounts', { component: 'OxyContext' }, err as unknown);
      }
    }
  }, [isAuthenticated, oxyServices, tokenReady, clearSessionStateRef]);

  useEffect(() => {
    if (isAuthenticated && initialized && tokenReady) {
      refreshAccounts();
      void accountDialogControllerRef.current?.refresh();
    }
  }, [isAuthenticated, initialized, tokenReady, refreshAccounts, accountDialogControllerRef]);

  const runPostAccountSwitchSideEffects = useCallback(async (): Promise<void> => {
    resetSessionScopedStores();
    // Scoped media tokens are per-viewer — drop any cached URLs immediately so
    // `keepPreviousData`-style placeholders cannot flash the prior account's
    // private thumbnails while the new bearer mint lands.
    queryClient.removeQueries({ queryKey: [ASSET_DOWNLOAD_URLS_QUERY_KEY] });
    await refreshAccounts();
    queryClient.invalidateQueries();
  }, [refreshAccounts, queryClient]);

  const switchToAccount = useCallback(
    async (accountId: string): Promise<void> => {
      const deviceState = sessionClient.getState();
      if (deviceState?.accounts.some((account) => account.accountId === accountId)) {
        await sessionClient.switchAccount(accountId);
        await syncFromClient();
        await runPostAccountSwitchSideEffects();
        return;
      }

      const result = await oxyServices.switchToAccount(accountId);
      if (!result?.user || !result?.sessionId) {
        throw new Error('Account switch did not return a valid session');
      }
      await commitSession(
        {
          sessionId: result.sessionId,
          accessToken: result.accessToken,
          deviceSecret: result.deviceSecret,
          deviceId: result.deviceId,
          expiresAt: result.expiresAt,
          userId: result.user.id,
          user: result.user,
        },
        // A switch is IN-PLACE: never run the cross-origin hub-sync full-page
        // redirect. Cross-tab/app propagation rides the `session_state` socket.
        { activate: true, hubSync: false },
      );
      await runPostAccountSwitchSideEffects();
    },
    [oxyServices, sessionClient, syncFromClient, commitSession, runPostAccountSwitchSideEffects],
  );

  const createAccount = useCallback(
    async (data: CreateAccountInput): Promise<AccountNode> => {
      const account = await oxyServices.createAccount(data);
      await refreshAccounts();
      return account;
    },
    [oxyServices, refreshAccounts],
  );

  return {
    accounts,
    refreshAccounts,
    switchToAccount,
    createAccount,
  };
}
