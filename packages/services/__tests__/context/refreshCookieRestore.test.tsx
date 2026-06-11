/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * Cold-boot session restore via the secure refresh cookie.
 *
 * THE BUG THIS GUARDS: on a hard reload the web client had no access token in
 * memory, so the bearer-protected cold-boot token fetch (`getTokenBySession` →
 * `/session/token/:id`) 401'd, the stored session was cleared, and the user was
 * bounced to sign-in. FedCM silent re-auth cannot cover this (Chrome
 * auto-reauthn cooldown).
 *
 * THE FIX: on boot the provider first calls `POST {apiBaseUrl}/auth/refresh`
 * with `credentials: 'include'` and NO Authorization header. The browser sends
 * the first-party httpOnly `oxy_rt` cookie; the server validates + rotates it
 * and returns a fresh `{ accessToken }`. The client plants the token, derives
 * the `sessionId` from the (already server-signed) JWT claims, fetches the user,
 * restores the active session into the multi-session store, and durably
 * persists the session id — all without FedCM.
 *
 * CASE 200: a mocked 200 from `/auth/refresh` signs the user in and persists the
 *           session id; the bearer-protected `getTokenBySession` is NOT used for
 *           cold boot and no FedCM call is needed.
 * CASE 401: a mocked 401 leaves the user logged out WITHOUT throwing and without
 *           planting a token; the flow falls through unauthenticated.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';

const SESSION_IDS_KEY = 'oxy_session_session_ids';
const ACTIVE_SESSION_KEY = 'oxy_session_active_session_id';
const API_BASE_URL = 'https://api.oxy.so';

const COOKIE_SESSION_ID = 'sess_cookie_1';
const COOKIE_USER_ID = 'user_123';

/**
 * Build a structurally-valid JWT whose middle segment base64url-decodes to the
 * given claims. The signature is irrelevant (the client decodes only — it never
 * verifies), so a constant placeholder is used.
 */
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
    getAccessToken: () => null,
    onTokensChanged: () => () => undefined,
    setTokens: jest.fn(),
    clearTokens: jest.fn(),
    clearCache: jest.fn(),
    // If FedCM were to fire it would call this — assert it does NOT on the 200 path.
    isFedCMSupported: isFedCMSupportedSpy,
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

describe('Cold-boot restore via secure refresh cookie', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    captured = { isAuthenticated: false, userId: undefined, isTokenReady: false };
    setTokensSpy.mockClear();
    getTokenBySessionSpy.mockClear();
    isFedCMSupportedSpy.mockClear();
    // Reset the shared zustand auth store so authentication does not leak across tests.
    useAuthStore.getState().logout();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('CASE 200: signs the user in from the cookie and persists the session id (no FedCM, no bearer token fetch)', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${API_BASE_URL}/auth/refresh`);
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      // No Authorization header is attached on the cold-boot refresh call.
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: COOKIE_ACCESS_TOKEN }),
      } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderProvider(baseStub());

    // The user becomes authenticated purely from the refresh cookie.
    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(COOKIE_USER_ID);

    // The fresh access token was planted on the HTTP client.
    expect(setTokensSpy).toHaveBeenCalledWith(COOKIE_ACCESS_TOKEN);

    // The session id (decoded from the JWT) is durably persisted.
    await waitFor(() => {
      expect(window.localStorage.getItem(SESSION_IDS_KEY)).toBe(JSON.stringify([COOKIE_SESSION_ID]));
    });
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBe(COOKIE_SESSION_ID);

    // The refresh endpoint was hit exactly once for cold boot.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Cold boot did NOT depend on the bearer-protected token fetch — the user
    // was signed in from the cookie alone, no FedCM silent re-auth needed.
    expect(getTokenBySessionSpy).not.toHaveBeenCalled();
  });

  it('CASE 401: leaves the user logged out without throwing and without planting a token', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_refresh_token' }),
    } as Response));
    global.fetch = fetchMock as unknown as typeof fetch;

    // No stored sessions either → fully unauthenticated cold boot.
    renderProvider(baseStub());

    // The refresh endpoint is attempted on boot (wait for it — `isTokenReady`
    // starts `true`, so it is not a reliable "restore finished" signal).
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Let the (synchronous-after-fetch) fall-through settle.
    await waitFor(() => expect(captured.isTokenReady).toBe(true));

    // The 401 leaves the user unauthenticated; no token was planted.
    expect(captured.isAuthenticated).toBe(false);
    expect(captured.userId).toBeUndefined();
    expect(setTokensSpy).not.toHaveBeenCalled();

    // Nothing was persisted; no aggressive clearing threw.
    expect(window.localStorage.getItem(SESSION_IDS_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBeNull();
  });

  it('CASE network error: a fetch rejection falls through unauthenticated without throwing', async () => {
    const fetchMock = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderProvider(baseStub());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(captured.isTokenReady).toBe(true));
    expect(captured.isAuthenticated).toBe(false);
    expect(setTokensSpy).not.toHaveBeenCalled();
  });
});
