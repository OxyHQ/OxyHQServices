/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * Cold-boot session restore via the secure refresh cookies (multi-account).
 *
 * THE BUG THIS GUARDS: on a hard reload the web client has no access token in
 * memory. Cold boot must restore from secure httpOnly refresh cookies instead
 * of depending on any legacy bearer-token fetch tied to a stored session id.
 * FedCM silent re-auth cannot cover this (Chrome auto-reauthn cooldown).
 *
 * THE FIX: on boot the provider calls `oxyServices.refreshAllSessions()`
 * (`POST /auth/refresh-all` with `credentials: 'include'` and no Authorization
 * header). The browser sends every first-party httpOnly `oxy_rt_${n}` cookie;
 * the server rotates each in parallel and returns one entry per VALID account.
 * The client plants the active account's access token, builds a ClientSession
 * per returned slot, persists the active `authuser` slot and session id —
 * without FedCM.
 *
 * CASE accounts: a mocked 200 with one account signs the user in and persists
 *                the session id; no FedCM call is needed.
 * CASE empty:    a mocked 200 `{accounts:[]}` leaves the user logged out
 *                without throwing and without planting a token.
 * CASE network:  a `fetch` rejection falls through unauthenticated.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';

const SESSION_IDS_KEY = 'oxy_session_session_ids';
const ACTIVE_SESSION_KEY = 'oxy_session_active_session_id';
const ACTIVE_AUTHUSER_KEY = 'oxy_active_authuser';
const API_BASE_URL = 'https://api.oxy.so';

const COOKIE_SESSION_ID = 'sess_cookie_1';
const COOKIE_USER_ID = 'user_123';

function buildAccessToken(claims: Record<string, unknown>): string {
  const b64url = (value: string): string =>
    Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  return `${header}.${payload}.signature`;
}

const COOKIE_ACCESS_TOKEN = buildAccessToken({
  sessionId: COOKIE_SESSION_ID,
  userId: COOKIE_USER_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
});

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

interface StubOverrides {
  getCurrentUser?: jest.Mock;
}

const setTokensSpy = jest.fn();
const isFedCMSupportedSpy = jest.fn(() => false);

function baseStub(overrides: StubOverrides = {}) {
  return {
    config: { authWebUrl: 'https://auth.oxy.so' },
    httpService: { setTokens: setTokensSpy },
    getBaseURL: () => API_BASE_URL,
    getSessionBaseUrl: () => API_BASE_URL,
    getAccessToken: () => null,
    onTokensChanged: () => () => undefined,
    setTokens: jest.fn(),
    clearTokens: jest.fn(),
    clearCache: jest.fn(),
    isFedCMSupported: isFedCMSupportedSpy,
    // Cold boot now runs an ordered `runColdBoot` sequence. The redirect, the
    // SSO-return, and the FedCM-silent steps all run BEFORE the cookie step, so
    // the stub must answer them: no redirect callback in URL (`null`) and no
    // silent FedCM session (`null`). They fall through so the cookie step runs.
    // `generateSsoState` is provided for the terminal `sso-bounce` step, which
    // fires on `accounts.oxy.so` only when the cookie step also finds nothing.
    handleAuthCallback: jest.fn(() => null),
    silentSignInWithFedCM: jest.fn(async () => null),
    generateSsoState: jest.fn(() => 'first-party-state'),
    // The provider now routes the cold-boot cookie restore through
    // `oxyServices.refreshAllSessions()`. The stub returns the multi-account
    // snapshot; per-test `beforeEach` re-binds this with the desired shape.
    refreshAllSessions: jest.fn(async () => ({ accounts: [] })),
    getCurrentUser:
      overrides.getCurrentUser ??
      jest.fn(async (): Promise<User> => ({ id: COOKIE_USER_ID, username: 'tester' } as User)),
    validateSession: jest.fn(async () => ({
      valid: true,
      user: { id: COOKIE_USER_ID, username: 'tester' },
    })),
    listAccounts: jest.fn(async () => []),
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

describe('Cold-boot restore via secure refresh cookies (multi-account)', () => {
  let ssoNavigateSpy: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // The terminal `sso-bounce` is SMART-gated: only a RETURNING visitor (durable
    // prior-session hint) is bounced. These cross-domain tests model a returning
    // user whose cookie restore comes back empty; the cookie-restore-wins cases
    // are unaffected (an earlier step short-circuits before the bounce gate).
    window.localStorage.setItem('oxy_session_prior_session', '1');
    captured = { isAuthenticated: false, userId: undefined, isTokenReady: false };
    setTokensSpy.mockClear();
    isFedCMSupportedSpy.mockClear();
    // `accounts.oxy.so` is a first-party RP, NOT the central IdP, so a fully
    // logged-out cold boot ends in the terminal `sso-bounce`. Spy the
    // navigation seam so it is observable and never tears down jsdom.
    ssoNavigateSpy = jest.spyOn(oxyCore, 'ssoNavigate').mockImplementation(() => undefined);
    useAuthStore.getState().logout();
  });

  afterEach(() => {
    ssoNavigateSpy.mockRestore();
  });

  it('CASE single account: signs the user in from the refresh-all snapshot, plants the token, and persists session id + authuser', async () => {
    const stub = baseStub();
    stub.refreshAllSessions = jest.fn(async () => ({
      accounts: [
        {
          authuser: 0,
          accessToken: COOKIE_ACCESS_TOKEN,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          sessionId: COOKIE_SESSION_ID,
          user: { id: COOKIE_USER_ID, username: 'tester', avatar: null, color: null },
        },
      ],
    }));

    renderProvider(stub);

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(COOKIE_USER_ID);

    // The fresh access token was planted on the HTTP client.
    expect(setTokensSpy).toHaveBeenCalledWith(COOKIE_ACCESS_TOKEN);

    // The session id is durably persisted.
    await waitFor(() => {
      expect(window.localStorage.getItem(SESSION_IDS_KEY)).toBe(JSON.stringify([COOKIE_SESSION_ID]));
    });
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBe(COOKIE_SESSION_ID);
    // The active authuser slot index is persisted (web localStorage, slot 0).
    expect(window.localStorage.getItem(ACTIVE_AUTHUSER_KEY)).toBe('0');

    // The refresh-all SDK method was called exactly once.
    expect(stub.refreshAllSessions).toHaveBeenCalledTimes(1);

    // The cookie step won → the terminal central-SSO bounce never fired.
    expect(ssoNavigateSpy).not.toHaveBeenCalled();
  });

  it('CASE empty: a `{accounts:[]}` snapshot leaves the user logged out, plants nothing, and bounces to central SSO', async () => {
    const stub = baseStub();
    // `refreshAllSessions` already defaults to `{accounts: []}` via baseStub.

    renderProvider(stub);

    await waitFor(() => expect(stub.refreshAllSessions).toHaveBeenCalledTimes(1));
    // Every recovery step skipped → the terminal central-SSO bounce fires once
    // (a logged-out first-party RP delegates to the central IdP).
    await waitFor(() => expect(ssoNavigateSpy).toHaveBeenCalledTimes(1));

    expect(captured.isAuthenticated).toBe(false);
    expect(captured.userId).toBeUndefined();
    expect(setTokensSpy).not.toHaveBeenCalled();

    expect(window.localStorage.getItem(SESSION_IDS_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_AUTHUSER_KEY)).toBeNull();

    const assigned = new URL(ssoNavigateSpy.mock.calls[0][0] as string);
    expect(assigned.origin).toBe('https://auth.oxy.so');
    expect(assigned.pathname).toBe('/sso');
    expect(assigned.searchParams.get('client_id')).toBe('https://accounts.oxy.so');
  });

  it('CASE network error: a refreshAllSessions rejection falls through unauthenticated, then bounces to central SSO', async () => {
    const stub = baseStub();
    stub.refreshAllSessions = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    renderProvider(stub);

    await waitFor(() => expect(stub.refreshAllSessions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ssoNavigateSpy).toHaveBeenCalledTimes(1));
    expect(captured.isAuthenticated).toBe(false);
    expect(setTokensSpy).not.toHaveBeenCalled();
  });

  it('CASE multi-account: persisted authuser wins when it matches a returned account', async () => {
    window.localStorage.setItem(ACTIVE_AUTHUSER_KEY, '1');
    const SLOT_1_SESSION_ID = 'sess_slot_1';
    const SLOT_1_USER_ID = 'user_456';
    const SLOT_1_TOKEN = buildAccessToken({
      sessionId: SLOT_1_SESSION_ID,
      userId: SLOT_1_USER_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const stub = baseStub({
      getCurrentUser: jest.fn(async (): Promise<User> => ({ id: SLOT_1_USER_ID, username: 'other' } as User)),
    });
    stub.refreshAllSessions = jest.fn(async () => ({
      accounts: [
        {
          authuser: 0,
          accessToken: COOKIE_ACCESS_TOKEN,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          sessionId: COOKIE_SESSION_ID,
          user: { id: COOKIE_USER_ID, username: 'tester', avatar: null, color: null },
        },
        {
          authuser: 1,
          accessToken: SLOT_1_TOKEN,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          sessionId: SLOT_1_SESSION_ID,
          user: { id: SLOT_1_USER_ID, username: 'other', avatar: null, color: null },
        },
      ],
    }));

    renderProvider(stub);

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(SLOT_1_USER_ID);

    // The PERSISTED authuser's token was planted (slot 1), NOT slot 0.
    expect(setTokensSpy).toHaveBeenCalledWith(SLOT_1_TOKEN);
    expect(window.localStorage.getItem(ACTIVE_AUTHUSER_KEY)).toBe('1');
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBe(SLOT_1_SESSION_ID);
  });
});
