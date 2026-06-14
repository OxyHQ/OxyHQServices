/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * Cold-boot ORDER + short-circuit guarantees for the web path.
 *
 * The provider resolves a session on cold boot through an ordered
 * `runColdBoot` sequence (core primitive). The FIRST step that yields a
 * session wins and every later step is SKIPPED. This file pins the
 * cross-domain (mention.earth) ordering contract for the CENTRAL-SSO design:
 *
 *   Order (web): redirect → sso-return → fedcm-silent → cookie-restore →
 *   stored-session → sso-bounce (terminal).
 *
 *   1. FedCM silent short-circuits BEFORE the cookie step when FedCM is
 *      supported and silent reauthn returns a session — `refreshAllSessions`
 *      and the terminal `sso-bounce` are never reached.
 *   2. When every recovery step skips on a logged-out cross-domain RP, the
 *      TERMINAL `sso-bounce` step fires exactly once: it records the CSRF state
 *      + guard + destination in `sessionStorage` and top-level-navigates to the
 *      central `auth.oxy.so/sso?prompt=none`. `window.location.assign` is the
 *      observable side effect (jsdom does not actually navigate).
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';

const API_BASE_URL = 'https://api.mention.earth';
const FEDCM_USER_ID = 'fedcm_user_1';

const setTokensSpy = jest.fn();

const fedcmSession: SessionLoginResponse = {
  sessionId: 'sess_fedcm',
  deviceId: 'dev_fedcm',
  accessToken: 'fedcm.access.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: FEDCM_USER_ID, username: 'fedcmuser' },
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
      config: { authWebUrl: 'https://auth.oxy.so' },
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
      refreshAllSessions,
      generateSsoState: jest.fn(() => 'state-token-xyz'),
      exchangeSsoCode: jest.fn(async () => null),
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

describe('Cold-boot order (web cross-domain, central SSO)', () => {
  let assignSpy: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    captured = { isAuthenticated: false, userId: undefined, isTokenReady: false };
    setTokensSpy.mockClear();
    useAuthStore.getState().logout();
    // The terminal `sso-bounce` step navigates via `ssoNavigate` (a thin wrapper
    // over `window.location.assign`, which jsdom makes non-mockable) now exported
    // from `@oxyhq/core`. Spy the wrapper so the navigation is observable without
    // tearing down jsdom.
    assignSpy = jest.spyOn(oxyCore, 'ssoNavigate').mockImplementation(() => undefined);
  });

  afterEach(() => {
    assignSpy.mockRestore();
  });

  it('FedCM silent short-circuits BEFORE the cookie step and the SSO bounce', async () => {
    const { stub, refreshAllSessions, baseURL } = buildStub({
      fedcmSupported: true,
      silentFedCM: fedcmSession,
      currentUserId: FEDCM_USER_ID,
      baseURL: 'https://api.mention.earth/case-fedcm',
    });

    renderProvider(stub, baseURL);

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(FEDCM_USER_ID);

    // FedCM step won → cookie step never ran, no bounce.
    expect(stub.silentSignInWithFedCM).toHaveBeenCalledTimes(1);
    expect(refreshAllSessions).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('logged-out cross-domain RP: every step skips → terminal SSO bounce fires once', async () => {
    const { stub, refreshAllSessions, baseURL } = buildStub({
      fedcmSupported: false,
      refreshAllResult: async () => ({ accounts: [] }),
      baseURL: 'https://api.mention.earth/case-bounce',
    });

    renderProvider(stub, baseURL);

    // The cookie step is reached (both FedCM + sso-return skipped), returns no
    // accounts, then stored-session skips, then the terminal bounce fires.
    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(1));
    expect(refreshAllSessions).toHaveBeenCalledTimes(1);

    // The bounce targets the central IdP /sso with prompt=none + the RP origin.
    const assigned = new URL(assignSpy.mock.calls[0][0] as string);
    expect(assigned.origin).toBe('https://auth.oxy.so');
    expect(assigned.pathname).toBe('/sso');
    expect(assigned.searchParams.get('prompt')).toBe('none');
    expect(assigned.searchParams.get('client_id')).toBe('https://app.mention.earth');
    expect(assigned.searchParams.get('return_to')).toBe(
      'https://app.mention.earth/__oxy/sso-callback',
    );
    expect(assigned.searchParams.get('state')).toBe('state-token-xyz');

    // The bounce recorded the loop-breaking guard + CSRF state + destination.
    expect(window.sessionStorage.getItem('oxy_sso_state:https://app.mention.earth')).toBe(
      'state-token-xyz',
    );
    expect(window.sessionStorage.getItem('oxy_sso_guard:https://app.mention.earth')).not.toBeNull();
    expect(window.sessionStorage.getItem('oxy_sso_dest:https://app.mention.earth')).toBe(
      'https://app.mention.earth/',
    );

    // Not authenticated (the navigation would tear the page down in a real
    // browser; jsdom keeps it alive).
    expect(captured.isAuthenticated).toBe(false);
    expect(setTokensSpy).not.toHaveBeenCalled();
  });
});
