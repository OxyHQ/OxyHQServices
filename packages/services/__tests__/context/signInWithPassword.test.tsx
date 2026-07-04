/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * `useOxy().signInWithPassword` + `completeTwoFactorSignIn` — device-first
 * username/email + password sign-in.
 *
 * `signInWithPassword` calls `oxyServices.passwordSignIn(...)` and:
 *   - on a session arm, commits it through the SAME funnel the QR device flow /
 *     cold boot use (`commitSession`): plants the token, persists the rotating
 *     refresh family, registers + activates the account into the
 *     server-authoritative device set (`registerAndActivate`), and hydrates the
 *     full user. Returns `{ status: 'ok' }`. There is NO cross-apex refusal.
 *   - on a 2FA-enabled account (`{ twoFactorRequired, loginToken }`), commits
 *     NOTHING and returns `{ status: '2fa_required', loginToken }`; the caller
 *     completes the challenge via `completeTwoFactorSignIn`, which commits
 *     through the same funnel.
 */

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Force the device-first cold boot onto the NATIVE ladder so it resolves
// quickly to unauthenticated (empty store → skip; shared-key mint → null) with
// no web bootstrap-hop perturbing the password-commit path under test.
jest.mock('../../src/ui/utils/isWebBrowser', () => ({
  __esModule: true,
  isWebBrowser: () => false,
}));

// Stub the SessionClient so the commit funnel's device-set registration is
// deterministic + offline (the real client would open a socket + hit the
// backend). Its `getState()` returns null, so `syncFromClient` is a no-op and
// the authenticated projection comes from `commitSession`'s `getCurrentUser`.
const fakeSessionClient = {
  getState: jest.fn(() => null),
  subscribe: jest.fn(() => () => undefined),
  start: jest.fn(async () => undefined),
  bootstrap: jest.fn(async () => undefined),
  addCurrentAccount: jest.fn(async () => undefined),
  registerAndActivate: jest.fn(async () => undefined),
  switchAccount: jest.fn(async () => undefined),
  signOut: jest.fn(async () => undefined),
};
jest.mock('../../src/ui/session', () => {
  const actual = jest.requireActual('../../src/ui/session');
  return {
    ...actual,
    createSessionClient: jest.fn(() => ({
      client: fakeSessionClient,
      host: { setCurrentAccountId: jest.fn() },
    })),
  };
});

import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { OxyContextState, PasswordSignInResult } from '../../src/ui/context/OxyContext';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';

const API_BASE_URL = 'https://api.oxy.so';
const PASSWORD_USER_ID = 'user_pw_1';

/** The two arms of the device-first `POST /auth/login` contract the stub returns. */
type PasswordLoginArm = { twoFactorRequired: true; loginToken: string } | SessionLoginResponse;

const fullSession = {
  sessionId: 'sess_pw',
  deviceId: 'dev_pw',
  accessToken: 'pw.access.token',
  refreshToken: 'pw.refresh.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: PASSWORD_USER_ID, username: 'pwuser' },
} as unknown as SessionLoginResponse;

function buildStub(
  passwordSignInImpl: () => Promise<PasswordLoginArm>,
  completeTwoFactorImpl: () => Promise<SessionLoginResponse> = async () => fullSession,
) {
  let currentToken: string | null = null;
  const passwordSignInSpy = jest.fn(passwordSignInImpl);
  const completeTwoFactorSpy = jest.fn(completeTwoFactorImpl);
  const setTokensSpy = jest.fn((token: string) => { currentToken = token; });
  return {
    passwordSignInSpy,
    completeTwoFactorSpy,
    setTokensSpy,
    stub: {
      config: {},
      httpService: {
        setTokens: setTokensSpy,
        setAuthRefreshHandler: jest.fn(),
        refreshAccessToken: jest.fn(async () => null),
      },
      getBaseURL: () => API_BASE_URL,
      getSessionBaseUrl: () => API_BASE_URL,
      getAccessToken: () => currentToken,
      getAccessTokenExpiry: () => null,
      onTokensChanged: () => () => undefined,
      setTokens: setTokensSpy,
      clearTokens: jest.fn(() => { currentToken = null; }),
      clearCache: jest.fn(),
      signInWithSharedIdentity: jest.fn(async () => null),
      passwordSignIn: passwordSignInSpy,
      completeTwoFactorSignIn: completeTwoFactorSpy,
      getCurrentUser: jest.fn(async (): Promise<User> => ({ id: PASSWORD_USER_ID, username: 'pwuser' } as User)),
      getUsersByIds: jest.fn(async () => []),
      listAccounts: jest.fn(async () => []),
    },
  };
}

let capturedContext: OxyContextState | null = null;

function Capture() {
  capturedContext = useOxy();
  return null;
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
  beforeEach(() => {
    window.localStorage.clear();
    capturedContext = null;
    useAuthStore.getState().logout();
    fakeSessionClient.registerAndActivate.mockClear();
  });

  it('commits a full session through the funnel (registerAndActivate) and returns { status: "ok" }', async () => {
    const { stub, passwordSignInSpy } = buildStub(async () => fullSession);

    renderProvider(stub);

    await waitFor(() => expect(capturedContext?.isAuthResolved).toBe(true));
    expect(capturedContext?.isAuthenticated).toBe(false);

    let outcome: PasswordSignInResult | undefined;
    await act(async () => {
      outcome = await capturedContext?.signInWithPassword('pwuser', 'hunter2', { deviceName: 'Test Device' });
    });

    // The device-first password call — device token is absent (nothing seeded),
    // so it is passed as `undefined` (equivalent to an absent key).
    expect(passwordSignInSpy).toHaveBeenCalledWith('pwuser', 'hunter2', { deviceName: 'Test Device' });
    expect(outcome).toEqual({ status: 'ok' });

    // Committed through the funnel: the account was registered + activated into
    // the server-authoritative device set.
    expect(fakeSessionClient.registerAndActivate).toHaveBeenCalledWith(PASSWORD_USER_ID);

    await waitFor(() => expect(capturedContext?.isAuthenticated).toBe(true));
    expect(capturedContext?.user?.id).toBe(PASSWORD_USER_ID);
  });

  it('returns { status: "2fa_required", loginToken } without committing a session', async () => {
    const { stub, passwordSignInSpy, setTokensSpy } = buildStub(async () => ({
      twoFactorRequired: true,
      loginToken: 'lt_2fa_abc123',
    }));

    renderProvider(stub);

    await waitFor(() => expect(capturedContext?.isAuthResolved).toBe(true));

    let outcome: PasswordSignInResult | undefined;
    await act(async () => {
      outcome = await capturedContext?.signInWithPassword('pwuser', 'hunter2');
    });

    expect(passwordSignInSpy).toHaveBeenCalledWith('pwuser', 'hunter2', {});
    expect(outcome).toEqual({ status: '2fa_required', loginToken: 'lt_2fa_abc123' });

    // No session was committed: not authenticated, no token planted, no device
    // registration.
    expect(capturedContext?.isAuthenticated).toBe(false);
    expect(setTokensSpy).not.toHaveBeenCalled();
    expect(fakeSessionClient.registerAndActivate).not.toHaveBeenCalled();
  });

  it('completeTwoFactorSignIn commits the session through the same funnel', async () => {
    const { stub, completeTwoFactorSpy } = buildStub(async () => ({
      twoFactorRequired: true,
      loginToken: 'lt_2fa_abc123',
    }));

    renderProvider(stub);

    await waitFor(() => expect(capturedContext?.isAuthResolved).toBe(true));

    // First step: password → 2FA required (no session).
    await act(async () => {
      await capturedContext?.signInWithPassword('pwuser', 'hunter2');
    });
    expect(capturedContext?.isAuthenticated).toBe(false);

    // Second step: complete the 2FA challenge → commits the session.
    await act(async () => {
      await capturedContext?.completeTwoFactorSignIn({ loginToken: 'lt_2fa_abc123', token: '123456' });
    });

    expect(completeTwoFactorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ loginToken: 'lt_2fa_abc123', token: '123456' }),
    );
    expect(fakeSessionClient.registerAndActivate).toHaveBeenCalledWith(PASSWORD_USER_ID);
    await waitFor(() => expect(capturedContext?.isAuthenticated).toBe(true));
    expect(capturedContext?.user?.id).toBe(PASSWORD_USER_ID);
  });
});
