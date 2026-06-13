/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * Cold-boot ORDER + short-circuit guarantees for the web path.
 *
 * The provider resolves a session on cold boot through an ordered
 * `runColdBoot` sequence (core primitive). The FIRST step that yields a
 * session wins and every later step is SKIPPED. This file pins the
 * cross-domain (mention.earth) ordering contract:
 *
 *   1. FedCM short-circuits BEFORE the cookie step when FedCM is supported and
 *      silent reauthn returns a session — `refreshAllSessions` is never called.
 *   2. When FedCM is NOT supported, the silent first-party iframe
 *      (`silentSignIn`) is used instead (Safari / Firefox path), and it too
 *      short-circuits the cookie step.
 *   3. On a cross-domain RP the cookie step is reached only when both silent
 *      paths skip; `refreshAllSessions` returning `{accounts:[]}` (the
 *      cross-domain reality — `oxy_rt` is Domain=oxy.so and never reaches
 *      api.mention.earth) leaves the user unauthenticated without clearing.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';

const API_BASE_URL = 'https://api.mention.earth';
const FEDCM_USER_ID = 'fedcm_user_1';
const IFRAME_USER_ID = 'iframe_user_1';

const setTokensSpy = jest.fn();

const fedcmSession: SessionLoginResponse = {
  sessionId: 'sess_fedcm',
  deviceId: 'dev_fedcm',
  accessToken: 'fedcm.access.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: FEDCM_USER_ID, username: 'fedcmuser' },
} as SessionLoginResponse;

const iframeSession: SessionLoginResponse = {
  sessionId: 'sess_iframe',
  deviceId: 'dev_iframe',
  accessToken: 'iframe.access.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: IFRAME_USER_ID, username: 'iframeuser' },
} as SessionLoginResponse;

interface CapturedState {
  isAuthenticated: boolean;
  userId: string | undefined;
  isTokenReady: boolean;
}

let captured: CapturedState = { isAuthenticated: false, userId: undefined, isTokenReady: false };

function Capture() {
  const { isAuthenticated, user, isTokenReady } = useOxy();
  captured = { isAuthenticated, userId: user?.id, isTokenReady };
  return null;
}

interface StubConfig {
  fedcmSupported: boolean;
  silentFedCM?: SessionLoginResponse | null;
  silentIframe?: SessionLoginResponse | null;
  refreshAllResult?: () => Promise<{ accounts: unknown[] }>;
  currentUserId?: string;
  // The cold-boot silent guard is module-level and keyed on `origin|baseURL`.
  // Each test uses a UNIQUE baseURL so its silent step is not pre-disabled by a
  // prior test's attempt in the same module scope.
  baseURL?: string;
}

function buildStub(cfg: StubConfig) {
  const baseURL = cfg.baseURL ?? API_BASE_URL;
  const refreshAllSessions = jest.fn(
    cfg.refreshAllResult ?? (async () => ({ accounts: [] as unknown[] })),
  );
  return {
    baseURL,
    stub: {
      config: { authWebUrl: 'https://auth.mention.earth' },
      httpService: { setTokens: setTokensSpy },
      getBaseURL: () => baseURL,
      getSessionBaseUrl: () => baseURL,
      getAccessToken: () => null,
      onTokensChanged: () => () => undefined,
      setTokens: jest.fn(),
      clearTokens: jest.fn(),
      clearCache: jest.fn(),
      isFedCMSupported: jest.fn(() => cfg.fedcmSupported),
      handleAuthCallback: jest.fn(() => null),
      silentSignInWithFedCM: jest.fn(async () => cfg.silentFedCM ?? null),
      silentSignIn: jest.fn(async () => cfg.silentIframe ?? null),
      refreshAllSessions,
      getTokenBySession: jest.fn(async () => 'unused.token'),
      getCurrentUser: jest.fn(
        async (): Promise<User> =>
          ({ id: cfg.currentUserId ?? FEDCM_USER_ID, username: 'tester' } as User),
      ),
      validateSession: jest.fn(async () => ({ valid: true, user: { id: FEDCM_USER_ID } })),
      setActingAs: jest.fn(),
      getManagedAccounts: jest.fn(async () => []),
    },
    refreshAllSessions,
  };
}

function renderProvider(oxyServices: unknown, baseURL: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OxyContextProvider oxyServices={oxyServices as never} baseURL={baseURL}>
        <Capture />
      </OxyContextProvider>
    </QueryClientProvider>,
  );
}

describe('Cold-boot order (web cross-domain)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    captured = { isAuthenticated: false, userId: undefined, isTokenReady: false };
    setTokensSpy.mockClear();
    useAuthStore.getState().logout();
  });

  it('FedCM silent short-circuits BEFORE the cookie step', async () => {
    const { stub, refreshAllSessions, baseURL } = buildStub({
      fedcmSupported: true,
      silentFedCM: fedcmSession,
      currentUserId: FEDCM_USER_ID,
      baseURL: 'https://api.mention.earth/case-fedcm',
    });

    renderProvider(stub, baseURL);

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(FEDCM_USER_ID);

    // FedCM step won → cookie step never ran.
    expect(stub.silentSignInWithFedCM).toHaveBeenCalledTimes(1);
    expect(refreshAllSessions).not.toHaveBeenCalled();
    // FedCM-supported branch never touches the iframe path.
    expect(stub.silentSignIn).not.toHaveBeenCalled();
  });

  it('uses the silent iframe when FedCM is NOT supported, short-circuiting the cookie step', async () => {
    const { stub, refreshAllSessions, baseURL } = buildStub({
      fedcmSupported: false,
      silentIframe: iframeSession,
      currentUserId: IFRAME_USER_ID,
      baseURL: 'https://api.mention.earth/case-iframe',
    });

    renderProvider(stub, baseURL);

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(IFRAME_USER_ID);

    // Iframe step won → FedCM never called, cookie step never ran.
    expect(stub.silentSignIn).toHaveBeenCalledTimes(1);
    expect(stub.silentSignInWithFedCM).not.toHaveBeenCalled();
    expect(refreshAllSessions).not.toHaveBeenCalled();
  });

  it('cookie step is skipped (no accounts) cross-domain → unauthenticated without clearing', async () => {
    const { stub, refreshAllSessions, baseURL } = buildStub({
      fedcmSupported: false,
      silentIframe: null,
      refreshAllResult: async () => ({ accounts: [] }),
      baseURL: 'https://api.mention.earth/case-cookie-empty',
    });

    renderProvider(stub, baseURL);

    // The cookie step is reached because both silent paths skipped.
    await waitFor(() => expect(refreshAllSessions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(captured.isTokenReady).toBe(true));

    expect(captured.isAuthenticated).toBe(false);
    expect(captured.userId).toBeUndefined();
    expect(setTokensSpy).not.toHaveBeenCalled();
  });
});
