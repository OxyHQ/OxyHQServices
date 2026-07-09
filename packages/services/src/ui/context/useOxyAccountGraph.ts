import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { OxyServices, AccountNode, CreateAccountInput, AccountDialogController, SessionClient } from '@oxyhq/core';
import { logger as loggerUtil } from '@oxyhq/core';
import { useAuthStore } from '../stores/authStore';
import { isUnauthorizedStatus } from './oxyContextHelpers';
import type { CommitInput } from './oxyContextTypes';

interface UseOxyAccountGraphParams {
  isAuthenticated: boolean;
  tokenReady: boolean;
  initialized: boolean;
  oxyServices: OxyServices;
  sessionClient: SessionClient;
  syncFromClient: () => Promise<void>;
  commitSession: (input: CommitInput, options: { activate: boolean }) => Promise<void>;
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
        { activate: true },
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
