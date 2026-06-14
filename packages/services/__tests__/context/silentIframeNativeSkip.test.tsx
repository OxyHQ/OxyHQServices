/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * NATIVE attestation for the per-apex silent-iframe step.
 *
 * On React Native `isWebBrowser()` is false (no DOM), so the `silent-iframe`
 * cold-boot step — like every other web-only step — MUST be disabled. Native
 * reaches ONLY the `stored-session` step. This guards against the silent-iframe
 * step (which calls `oxyServices.silentSignIn()`, an iframe/postMessage flow)
 * ever running on a platform with no DOM.
 *
 * `isWebBrowser` is mocked → false at module top level (the proven pattern from
 * `nativeColdBoot.test.tsx`). The jsdom URL is irrelevant; the mock, not the
 * environment, decides the platform.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
import type { SessionLoginResponse, User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';

const API_BASE_URL = 'https://api.mention.earth';
const SESSION_IDS_KEY = 'oxy_session_session_ids';
const ACTIVE_SESSION_KEY = 'oxy_session_active_session_id';
const STORED_SESSION_ID = 'sess_stored_native';
const STORED_USER_ID = 'user_native_1';

const iframeSession: SessionLoginResponse = {
  sessionId: 'sess_iframe',
  deviceId: 'dev_iframe',
  accessToken: 'iframe.access.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: 'iframe_user_1', username: 'iframeuser' },
} as SessionLoginResponse;

// The iframe stub WOULD return a session — proving the step is gated off, not
// merely returning null.
const silentSignInSpy = jest.fn(async () => iframeSession);
const validateSessionSpy = jest.fn(async () => ({
  valid: true,
  user: { id: STORED_USER_ID, username: 'nativeuser' },
}));

interface CapturedState {
  isAuthenticated: boolean;
  userId: string | undefined;
}

let captured: CapturedState = { isAuthenticated: false, userId: undefined };

function Capture() {
  const { isAuthenticated, user } = useOxy();
  captured = { isAuthenticated, userId: user?.id };
  return null;
}

function buildStub() {
  return {
    config: {},
    httpService: { setTokens: jest.fn() },
    getBaseURL: () => API_BASE_URL,
    getSessionBaseUrl: () => API_BASE_URL,
    getAccessToken: () => null,
    onTokensChanged: () => () => undefined,
    setTokens: jest.fn(),
    clearTokens: jest.fn(),
    clearCache: jest.fn(),
    isFedCMSupported: jest.fn(() => false),
    handleAuthCallback: jest.fn(() => null),
    silentSignInWithFedCM: jest.fn(async () => null),
    silentSignIn: silentSignInSpy,
    refreshAllSessions: jest.fn(async () => ({ accounts: [] as unknown[] })),
    exchangeSsoCode: jest.fn(async () => null),
    generateSsoState: jest.fn(() => 'should-never-be-called'),
    validateSession: validateSessionSpy,
    getTokenBySession: jest.fn(async () => 'native.token'),
    getUserBySession: jest.fn(async (): Promise<User> => ({ id: STORED_USER_ID, username: 'nativeuser' } as User)),
    getCurrentUser: jest.fn(async (): Promise<User> => ({ id: STORED_USER_ID, username: 'nativeuser' } as User)),
    getSessionsBySessionId: jest.fn(async () => []),
    getUserSessions: jest.fn(async () => []),
    setActingAs: jest.fn(),
    getManagedAccounts: jest.fn(async () => []),
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

describe('Native cold boot NEVER attempts the per-apex silent iframe', () => {
  let ssoNavigateSpy: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    captured = { isAuthenticated: false, userId: undefined };
    silentSignInSpy.mockClear();
    validateSessionSpy.mockClear();
    useAuthStore.getState().logout();
    ssoNavigateSpy = jest.spyOn(oxyCore, 'ssoNavigate').mockImplementation(() => undefined);
    window.localStorage.setItem(SESSION_IDS_KEY, JSON.stringify([STORED_SESSION_ID]));
    window.localStorage.setItem(ACTIVE_SESSION_KEY, STORED_SESSION_ID);
  });

  afterEach(() => {
    ssoNavigateSpy.mockRestore();
  });

  it('runs ONLY stored-session: silentSignIn (iframe) and the SSO bounce are never reached', async () => {
    const stub = buildStub();

    renderProvider(stub);

    await waitFor(() => expect(validateSessionSpy).toHaveBeenCalled());

    // The per-apex silent iframe was NEVER attempted on native, and no central
    // bounce ever happened — even though the stub would have returned a session.
    expect(silentSignInSpy).not.toHaveBeenCalled();
    expect(ssoNavigateSpy).not.toHaveBeenCalled();
  });
});
