/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * Task 2 (Fase 3-B): cold-boot cutover — token-acquisition ladder +
 * `SessionClient.start()`.
 *
 * `restoreSessionsFromStorage`'s 8-step cold boot (Task pre-existing) is now a
 * PURE token-acquisition ladder (`sso-return`, `stored-session`,
 * `shared-key-signin`, `silent-iframe`, `sso-bounce` — there is no FedCM step;
 * see `CrossDomainAuth`'s doc comment in `@oxyhq/core`) — the two
 * `oxy_rt` refresh-cookie restore steps (`cookie-restore-active`,
 * `cookie-restore`) and the `restoreViaRefreshCookie` function they called are
 * DELETED. Once the ladder yields a session (or an access token is already
 * held), `OxyContext` hands off to the server-authoritative `SessionClient`:
 * `addCurrentAccount()` registers the recovered account+session into the
 * server device-session set, THEN `start()` bootstraps the full device state
 * (server `activeAccountId` + realtime socket) and projects it via
 * `syncFromClient()`. When no session is acquired, the client is never
 * started — the app stays logged out.
 *
 * This suite mocks `createSessionClient` (from the `../session` barrel, same
 * pattern as `sessionClientProjection.test.tsx`) so the handoff is observable
 * without a real network, and drives the REAL token-acquisition ladder against
 * a controllable `oxyServices` stub (same pattern as `coldBootOrder.test.tsx`).
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import type { DeviceSessionState } from '@oxyhq/contracts';

jest.mock('../../src/ui/session', () => {
  const actual = jest.requireActual('../../src/ui/session');
  return {
    ...actual,
    createSessionClient: jest.fn(),
  };
});

import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import { useAuthStore } from '../../src/ui/stores/authStore';
import { createSessionClient } from '../../src/ui/session';

const mockedCreateSessionClient = createSessionClient as jest.MockedFunction<typeof createSessionClient>;

const API_BASE_URL = 'https://api.mention.earth';
const SILENT_USER_ID = 'silent_user_1';
const DEVICE_ACCOUNT_ID = 'account_silent_1';

const silentIframeSession: SessionLoginResponse = {
  sessionId: 'sess_silent',
  deviceId: 'dev_silent',
  accessToken: 'silent.access.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: SILENT_USER_ID, username: 'silentuser' },
} as SessionLoginResponse;

interface CapturedState {
  isAuthenticated: boolean;
  isTokenReady: boolean;
  userId: string | undefined;
  sessionsLength: number;
}

let captured: CapturedState = { isAuthenticated: false, isTokenReady: false, userId: undefined, sessionsLength: 0 };

function Capture() {
  const { isAuthenticated, isTokenReady, user, sessions } = useOxy();
  captured = { isAuthenticated, isTokenReady, userId: user?.id, sessionsLength: sessions.length };
  return null;
}

type StateListener = (state: DeviceSessionState | null) => void;

/**
 * A controllable stand-in for `SessionClient`. `start()` simulates the server
 * bootstrap by populating `getState()` and notifying subscribers — mirroring
 * what the REAL `SessionClient.start()` -> `bootstrap()` does on a successful
 * `GET /session/device/state`.
 */
function buildFakeClient(deviceState: DeviceSessionState) {
  let state: DeviceSessionState | null = null;
  const listeners = new Set<StateListener>();
  const callOrder: string[] = [];
  const addCurrentAccount = jest.fn(async () => {
    callOrder.push('addCurrentAccount');
  });
  const start = jest.fn(async () => {
    callOrder.push('start');
    state = deviceState;
    for (const listener of listeners) {
      listener(state);
    }
  });
  return {
    callOrder,
    addCurrentAccount,
    start,
    fakeClient: {
      getState: () => state,
      subscribe: (listener: StateListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      addCurrentAccount,
      start,
    },
  };
}

function buildDeviceState(): DeviceSessionState {
  return {
    deviceId: 'dev_silent',
    accounts: [{ accountId: DEVICE_ACCOUNT_ID, sessionId: 'sess_silent', authuser: 0 }],
    activeAccountId: DEVICE_ACCOUNT_ID,
    revision: 1,
    updatedAt: Date.now(),
  };
}

interface StubConfig {
  silentIframeSession?: SessionLoginResponse | null;
  currentUserId?: string;
  initialAccessToken?: string | null;
  baseURL: string;
}

function buildStub(cfg: StubConfig) {
  let currentToken: string | null = cfg.initialAccessToken ?? null;
  const refreshAllSessions = jest.fn(async () => ({ accounts: [] as unknown[] }));
  const getUsersByIds = jest.fn(async (ids: string[]): Promise<User[]> =>
    ids.map((id) => ({ id, username: `user-${id}` } as User)),
  );
  return {
    refreshAllSessions,
    getUsersByIds,
    stub: {
      config: { authWebUrl: 'https://auth.oxy.so' },
      httpService: { setTokens: (token: string) => { currentToken = token; } },
      getBaseURL: () => cfg.baseURL,
      getSessionBaseUrl: () => cfg.baseURL,
      getAccessToken: () => currentToken,
      onTokensChanged: () => () => undefined,
      setTokens: (token: string) => { currentToken = token; },
      clearTokens: () => { currentToken = null; },
      clearCache: jest.fn(),
      handleAuthCallback: jest.fn(() => null),
      silentSignIn: jest.fn(async () => cfg.silentIframeSession ?? null),
      refreshAllSessions,
      generateSsoState: jest.fn(() => 'state-token-xyz'),
      exchangeSsoCode: jest.fn(async () => null),
      getCurrentUser: jest.fn(
        async (): Promise<User> => ({ id: cfg.currentUserId ?? SILENT_USER_ID, username: 'tester' } as User),
      ),
      validateSession: jest.fn(async () => ({ valid: true, user: { id: cfg.currentUserId ?? SILENT_USER_ID, username: 'tester' } })),
      getDeviceSessions: jest.fn(async () => []),
      getSessionsBySessionId: jest.fn(async () => []),
      getUserBySession: jest.fn(async (): Promise<User> => ({ id: cfg.currentUserId ?? SILENT_USER_ID, username: 'tester' } as User)),
      refreshTokenViaCookie: jest.fn(async () => null),
      listAccounts: jest.fn(async () => []),
      getUsersByIds,
    },
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

describe('Cold-boot cutover: token ladder -> SessionClient.start (Task 2)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    captured = { isAuthenticated: false, isTokenReady: false, userId: undefined, sessionsLength: 0 };
    useAuthStore.getState().logout();
    mockedCreateSessionClient.mockReset();
  });

  it('a silent-iframe win hands off to SessionClient: addCurrentAccount then start (in order), then syncFromClient projects the server state', async () => {
    const deviceState = buildDeviceState();
    const fake = buildFakeClient(deviceState);
    const setCurrentAccountId = jest.fn();
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId } as never,
    });

    const { stub, refreshAllSessions, getUsersByIds } = buildStub({
      silentIframeSession,
      currentUserId: SILENT_USER_ID,
      baseURL: 'https://api.mention.earth/case-silent-iframe-handoff',
    });

    renderProvider(stub, 'https://api.mention.earth/case-silent-iframe-handoff');

    // The ladder recovers a session (silent-iframe) — isAuthenticated flips via
    // the existing `handleWebSSOSession` commit path.
    await waitFor(() => expect(captured.isAuthenticated).toBe(true));

    // The post-ladder handoff ran: addCurrentAccount BEFORE start.
    await waitFor(() => expect(fake.start).toHaveBeenCalledTimes(1));
    expect(fake.addCurrentAccount).toHaveBeenCalledTimes(1);
    expect(fake.callOrder).toEqual(['addCurrentAccount', 'start']);

    // start() populated device state and notified subscribers ->
    // syncFromClient projected it onto the exposed sessions/user.
    await waitFor(() => expect(captured.sessionsLength).toBe(1));
    await waitFor(() => expect(getUsersByIds).toHaveBeenCalledWith([DEVICE_ACCOUNT_ID]));
    expect(setCurrentAccountId).toHaveBeenCalledWith(DEVICE_ACCOUNT_ID);

    // (b) No oxy_rt refresh-cookie restore ever ran — the cookie-restore steps
    // and `restoreViaRefreshCookie` are deleted from the ladder.
    expect(refreshAllSessions).not.toHaveBeenCalled();
  });

  it('when NO step in the ladder yields a session, SessionClient.start is never called (stays logged out)', async () => {
    const deviceState = buildDeviceState();
    const fake = buildFakeClient(deviceState);
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });

    const { stub, refreshAllSessions } = buildStub({
      baseURL: 'https://api.mention.earth/case-no-session',
    });

    renderProvider(stub, 'https://api.mention.earth/case-no-session');

    // No prior-session hint is seeded, so this is a first-time anonymous
    // visitor: no step recovers a session and the terminal `sso-bounce` is
    // smart-gated off (`allowSsoBounce` requires a prior-session hint or a
    // local recovery this boot). Wait on `isTokenReady` (set in cold boot's
    // `finally`, the backstop that ALWAYS fires) rather than `isAuthenticated`,
    // which never becomes true on this path.
    await waitFor(() => expect(captured.isTokenReady).toBe(true));
    expect(captured.isAuthenticated).toBe(false);

    // The SessionClient handoff never ran: no session was acquired and no
    // access token was ever planted.
    expect(fake.addCurrentAccount).not.toHaveBeenCalled();
    expect(fake.start).not.toHaveBeenCalled();
    expect(refreshAllSessions).not.toHaveBeenCalled();
  });
});
