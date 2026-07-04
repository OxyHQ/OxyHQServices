/**
 * @jest-environment-options {"url": "https://app.oxy.so/"}
 *
 * Device-first cold boot in `OxyContext`.
 *
 * The cold-boot SSO ladder (sso-return / silent-iframe / sso-bounce / IdP
 * session-check) is GONE. Cold boot now = `runSessionColdBoot` from
 * `@oxyhq/core`, and it NEVER redirects to a login page. This suite pins the two
 * end-to-end contracts that matter to consumers:
 *
 *   1. A signed-out boot resolves to `isAuthResolved: true` / `isAuthenticated:
 *      false` WITHOUT any navigation — the app renders its own "Sign in with
 *      Oxy" affordance instead of being bounced.
 *   2. A returning device (a persisted refresh family with a still-valid warm
 *      access token) restores the session on boot: the token is planted, the
 *      account is handed off to the SessionClient (`addCurrentAccount` — cold
 *      boot ensures MEMBERSHIP, not a deliberate activation), and the full user
 *      is hydrated via `getCurrentUser`.
 *
 * `createSessionClient` is mocked so the post-boot handoff is deterministic +
 * offline (the real client opens a socket + hits the backend); its `getState()`
 * returns null so the authenticated projection comes from `commitSession`'s
 * `getCurrentUser`.
 */

import React from 'react';
import { render, waitFor, act, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AUTH_STATE_STORAGE_KEY, type User } from '@oxyhq/core';

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
import type { OxyContextState } from '../../src/ui/context/OxyContext';
import { useAuthStore } from '../../src/ui/stores/authStore';

const API_BASE_URL = 'https://api.oxy.so';
const USER_ID = 'user_cb_1';

/**
 * A `@oxyhq/core`-shaped stub. `requestWebSession` (the same-apex inline
 * device-cookie probe the web cold boot uses) is controllable so a test can
 * yield "known device, signed out". `getCurrentUser` hydrates the committed
 * session in the restore case.
 */
function buildStub(overrides: Record<string, unknown> = {}) {
  let currentToken: string | null = null;
  const buildBootstrapUrl = jest.fn(() => 'https://api.oxy.so/auth/device/bootstrap');
  return {
    buildBootstrapUrl,
    stub: {
      config: {},
      httpService: {
        setTokens: (token: string) => { currentToken = token; },
        setAuthRefreshHandler: jest.fn(),
        refreshAccessToken: jest.fn(async () => null),
      },
      getBaseURL: () => API_BASE_URL,
      getSessionBaseUrl: () => API_BASE_URL,
      getAccessToken: () => currentToken,
      getAccessTokenExpiry: () => null,
      onTokensChanged: () => () => undefined,
      setTokens: (token: string) => { currentToken = token; },
      clearTokens: () => { currentToken = null; },
      clearCache: jest.fn(),
      buildBootstrapUrl,
      // Same-apex web probe → known device, signed out (no session arm).
      requestWebSession: jest.fn(async () => ({ reason: 'signed_out', deviceToken: 'dt-cb' })),
      signInWithSharedIdentity: jest.fn(async () => null),
      getCurrentUser: jest.fn(async (): Promise<User> => ({ id: USER_ID, username: 'cbuser' } as User)),
      getUsersByIds: jest.fn(async () => []),
      listAccounts: jest.fn(async () => []),
      ...overrides,
    },
  };
}

let capturedContext: OxyContextState | null = null;

function Capture() {
  capturedContext = useOxy();
  return null;
}

function renderProvider(oxyServices: unknown): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OxyContextProvider oxyServices={oxyServices as never} baseURL={API_BASE_URL}>
        <Capture />
      </OxyContextProvider>
    </QueryClientProvider>,
  );
}

describe('OxyContext cold boot (device-first)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    capturedContext = null;
    useAuthStore.getState().logout();
    Object.values(fakeSessionClient).forEach((fn) => (fn as jest.Mock).mockClear());
  });

  it('a signed-out boot resolves auth WITHOUT navigating to any login page', async () => {
    const { stub, buildBootstrapUrl } = buildStub();

    renderProvider(stub);

    await waitFor(() => expect(capturedContext?.isAuthResolved).toBe(true));

    // Signed out, but auth is RESOLVED (a definitive "logged out", not undetermined).
    expect(capturedContext?.isAuthenticated).toBe(false);
    expect(capturedContext?.user).toBeNull();
    // The web boot actually ran (the same-apex inline device-cookie probe), and
    // resolved signed-out INLINE...
    expect(stub.requestWebSession).toHaveBeenCalledTimes(1);
    // ...WITHOUT ever navigating: `buildBootstrapUrl` is the sole argument to the
    // one `window.location.assign(...)` call in the cold boot, so its absence
    // proves no redirect occurred. The critical device-first contract: NO
    // automatic navigation to any login page, ever.
    expect(buildBootstrapUrl).not.toHaveBeenCalled();
    // The commit funnel never ran, so the device set was never touched.
    expect(fakeSessionClient.addCurrentAccount).not.toHaveBeenCalled();
    expect(fakeSessionClient.registerAndActivate).not.toHaveBeenCalled();
  });

  it('restores a session from the persisted store (warm-plant) and hands off to the SessionClient', async () => {
    // A returning device: a persisted refresh family with a still-valid warm
    // access token → cold boot warm-plants without a network round-trip.
    window.localStorage.setItem(
      AUTH_STATE_STORAGE_KEY,
      JSON.stringify({
        sessionId: 'sess_cb',
        refreshToken: 'cb.refresh.token',
        userId: USER_ID,
        accessToken: 'cb.access.token',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    const { stub, buildBootstrapUrl } = buildStub();

    renderProvider(stub);

    await waitFor(() => expect(capturedContext?.isAuthenticated).toBe(true));
    expect(capturedContext?.isAuthResolved).toBe(true);

    // The full user was hydrated via getCurrentUser.
    expect(stub.getCurrentUser).toHaveBeenCalled();
    expect(capturedContext?.user?.id).toBe(USER_ID);
    // The token was planted from the warm store.
    expect(stub.getAccessToken()).toBe('cb.access.token');
    // Cold boot handoff ensures device-set MEMBERSHIP (addCurrentAccount), not a
    // deliberate activation (registerAndActivate) — the server's own active
    // account wins.
    await waitFor(() => expect(fakeSessionClient.addCurrentAccount).toHaveBeenCalledTimes(1));
    expect(fakeSessionClient.registerAndActivate).not.toHaveBeenCalled();
    expect(fakeSessionClient.start).toHaveBeenCalled();
    // A warm restore never even reaches the web bootstrap-hop step.
    expect(buildBootstrapUrl).not.toHaveBeenCalled();
  });
});
