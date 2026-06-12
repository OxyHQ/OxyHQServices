/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * Cold-boot session restore via the secure refresh cookies (multi-account).
 *
 * THE BUG THIS GUARDS: on a hard reload the web client had no access token in
 * memory, so the bearer-protected cold-boot token fetch (`getTokenBySession` →
 * `/session/token/:id`) 401'd, the stored session was cleared, and the user was
 * bounced to sign-in. FedCM silent re-auth cannot cover this (Chrome
 * auto-reauthn cooldown).
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
 *                the session id; `getTokenBySession` is NOT used and no FedCM
 *                call is needed.
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
const getTokenBySessionSpy = jest.fn(async () => 'should.not.be.called');
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
    // The provider now routes the cold-boot restore through
    // `oxyServices.refreshAllSessions()`. The stub returns the multi-account
    // snapshot; per-test `beforeEach` re-binds this with the desired shape.
    refreshAllSessions: jest.fn(async () => ({ accounts: [] })),
    getCurrentUser:
      overrides.getCurrentUser ??
      jest.fn(async (): Promise<User> => ({ id: COOKIE_USER_ID, username: 'tester' } as User)),
    getTokenBySession: getTokenBySessionSpy,
    validateSession: jest.fn(async () => ({
      valid: true,
      user: { id: COOKIE_USER_ID, username: 'tester' },
    })),
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

describe('Cold-boot restore via secure refresh cookies (multi-account)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    captured = { isAuthenticated: false, userId: undefined, isTokenReady: false };
    setTokensSpy.mockClear();
    getTokenBySessionSpy.mockClear();
    isFedCMSupportedSpy.mockClear();
    useAuthStore.getState().logout();
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

    // Cold boot did NOT depend on the bearer-protected token fetch — the user
    // was signed in from the cookies alone, no FedCM silent re-auth needed.
    expect(getTokenBySessionSpy).not.toHaveBeenCalled();
  });

  it('CASE empty: a `{accounts:[]}` snapshot leaves the user logged out without throwing and without planting a token', async () => {
    const stub = baseStub();
    // `refreshAllSessions` already defaults to `{accounts: []}` via baseStub.

    renderProvider(stub);

    await waitFor(() => expect(stub.refreshAllSessions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(captured.isTokenReady).toBe(true));

    expect(captured.isAuthenticated).toBe(false);
    expect(captured.userId).toBeUndefined();
    expect(setTokensSpy).not.toHaveBeenCalled();

    expect(window.localStorage.getItem(SESSION_IDS_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_AUTHUSER_KEY)).toBeNull();
  });

  it('CASE network error: a refreshAllSessions rejection falls through unauthenticated without throwing', async () => {
    const stub = baseStub();
    stub.refreshAllSessions = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    renderProvider(stub);

    await waitFor(() => expect(stub.refreshAllSessions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(captured.isTokenReady).toBe(true));
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
