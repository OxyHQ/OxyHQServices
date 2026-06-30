/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * `useOxy().signInWithPassword` — keyless username/email + password sign-in
 * (Workstream A6 glue).
 *
 * The slimmed Accounts app no longer holds a local identity key, so it signs in
 * with a password. `signInWithPassword` calls `oxyServices.signIn(...)` and:
 *   - on a full session, commits it through the SAME path FedCM / SSO use
 *     (`handleWebSession`) so `isAuthenticated` / `user` update — returns
 *     `{ status: 'ok' }`.
 *   - on a 2FA-enabled account (`{ twoFactorRequired, loginToken }`), commits
 *     NOTHING and returns `{ status: '2fa_required', loginToken }` so the caller
 *     can run the challenge.
 */

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Force the NATIVE branch so cold boot resolves quickly to unauthenticated and
// no web SSO machinery perturbs the password-commit path under test.
jest.mock('../../src/ui/hooks/useWebSSO', () => ({
  __esModule: true,
  isWebBrowser: () => false,
  useWebSSO: () => ({
    checkSSO: async () => null,
    signInWithFedCM: async () => null,
    isChecking: false,
    isFedCMSupported: false,
  }),
}));

import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { OxyContextState, PasswordSignInResult } from '../../src/ui/context/OxyContext';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';

const API_BASE_URL = 'https://api.oxy.so';
const PASSWORD_USER_ID = 'user_pw_1';

const fullSession: SessionLoginResponse = {
  sessionId: 'sess_pw',
  deviceId: 'dev_pw',
  accessToken: 'pw.access.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: PASSWORD_USER_ID, username: 'pwuser' },
} as SessionLoginResponse;

let capturedContext: OxyContextState | null = null;

function Capture() {
  capturedContext = useOxy();
  return null;
}

function buildStub(signInImpl: () => Promise<unknown>) {
  const signInSpy = jest.fn(signInImpl);
  const setTokensSpy = jest.fn();
  return {
    signInSpy,
    setTokensSpy,
    stub: {
      config: {},
      httpService: { setTokens: setTokensSpy },
      getBaseURL: () => API_BASE_URL,
      getSessionBaseUrl: () => API_BASE_URL,
      getAccessToken: jest.fn(() => null),
      onTokensChanged: () => () => undefined,
      setTokens: jest.fn(),
      clearTokens: jest.fn(),
      clearCache: jest.fn(),
      isFedCMSupported: jest.fn(() => false),
      signIn: signInSpy,
      validateSession: jest.fn(async () => ({ valid: false })),
      getCurrentUser: jest.fn(async (): Promise<User> => ({ id: PASSWORD_USER_ID, username: 'pwuser' } as User)),
      getSessionsBySessionId: jest.fn(async () => []),
      getUserSessions: jest.fn(async () => []),
      getDeviceSessions: jest.fn(async () => []),
      listAccounts: jest.fn(async () => []),
    },
  };
}

function renderProvider(oxyServices: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OxyContextProvider oxyServices={oxyServices as never} baseURL={API_BASE_URL}>
        <Capture />
      </OxyContextProvider>
    </QueryClientProvider>,
  );
}

describe('useOxy().signInWithPassword', () => {
  let getSharedSessionSpy: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    capturedContext = null;
    useAuthStore.getState().logout();
    getSharedSessionSpy = jest
      .spyOn(oxyCore.KeyManager, 'getSharedSession')
      .mockResolvedValue(null);
  });

  afterEach(() => {
    getSharedSessionSpy.mockRestore();
  });

  it('commits a full session and returns { status: "ok" }', async () => {
    const { stub, signInSpy } = buildStub(async () => fullSession);

    renderProvider(stub);

    await waitFor(() => expect(capturedContext?.isAuthResolved).toBe(true));
    expect(capturedContext?.isAuthenticated).toBe(false);

    let outcome: PasswordSignInResult | undefined;
    await act(async () => {
      outcome = await capturedContext?.signInWithPassword('pwuser', 'hunter2', { deviceName: 'Test Device' });
    });

    expect(signInSpy).toHaveBeenCalledWith('pwuser', 'hunter2', 'Test Device', undefined);
    expect(outcome).toEqual({ status: 'ok' });

    await waitFor(() => expect(capturedContext?.isAuthenticated).toBe(true));
    expect(capturedContext?.user?.id).toBe(PASSWORD_USER_ID);
  });

  it('returns { status: "2fa_required", loginToken } without committing a session', async () => {
    const { stub, signInSpy, setTokensSpy } = buildStub(async () => ({
      twoFactorRequired: true,
      loginToken: 'lt_2fa_abc123',
    }));

    renderProvider(stub);

    await waitFor(() => expect(capturedContext?.isAuthResolved).toBe(true));

    let outcome: PasswordSignInResult | undefined;
    await act(async () => {
      outcome = await capturedContext?.signInWithPassword('pwuser', 'hunter2');
    });

    expect(signInSpy).toHaveBeenCalledWith('pwuser', 'hunter2', undefined, undefined);
    expect(outcome).toEqual({ status: '2fa_required', loginToken: 'lt_2fa_abc123' });

    // No session was committed: not authenticated, no token planted.
    expect(capturedContext?.isAuthenticated).toBe(false);
    expect(setTokensSpy).not.toHaveBeenCalled();
  });
});
