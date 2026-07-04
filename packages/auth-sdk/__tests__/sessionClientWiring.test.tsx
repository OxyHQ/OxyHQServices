/**
 * Device-first `WebOxyProvider`: the `SessionClient` device-session set is the
 * SOLE authority for the exposed `sessions` / `activeSessionId` / `user` /
 * `accounts` / `activeAuthuser` projection.
 *
 * The cold boot is neutralized (mocked `runSessionColdBoot` resolves signed-out
 * without touching the DOM), so `sessions`/`user` are solely a function of the
 * `SessionClient` projection under test. `createSessionClient` is the ONE mocked
 * seam (a controllable fake client); the pure projection helpers
 * (`deviceStateToClientSessions`, `activeSessionIdOf`, `activeUserOf`,
 * `accountIdsOf`) are the REAL implementations via the `...actual` spread.
 */

import { render, waitFor, act } from '@testing-library/react';
import type { User } from '@oxyhq/core';
import type { DeviceSessionState } from '@oxyhq/contracts';

const stubs = {
  getUsersByIds: jest.fn(async (_ids: string[]) => [] as User[]),
  getUserById: jest.fn(async (_id: string): Promise<User> => {
    throw new Error('not found');
  }),
  baseURL: 'https://api.oxy.so',
};

jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return {
    __esModule: true,
    ...actual,
    // Cold boot resolves signed-out without any DOM/network side effect.
    runSessionColdBoot: jest.fn(async (opts: { onSignedOut?: (r: string) => void }) => {
      await opts.onSignedOut?.('no_session');
      return { kind: 'unauthenticated' };
    }),
    installAuthRefreshHandler: jest.fn(() => () => undefined),
    startTokenRefreshScheduler: jest.fn(() => ({ dispose: () => undefined })),
    refreshPersistedSession: jest.fn(async () => null),
    createSessionClient: jest.fn(),
    OxyServices: class {
      private token: string | null = null;
      getBaseURL(): string { return stubs.baseURL; }
      getAccessToken(): string | null { return this.token; }
      setTokens(t: string): void { this.token = t; }
      getAccessTokenExpiry(): number | null { return null; }
      onTokensChanged(): () => void { return () => undefined; }
      getUsersByIds(ids: string[]): Promise<User[]> { return stubs.getUsersByIds(ids); }
      getUserById(id: string): Promise<User> { return stubs.getUserById(id); }
    },
  };
});

import { WebOxyProvider, useAuth } from '../src/WebOxyProvider';
import { createSessionClient } from '@oxyhq/core';

const mockedCreateSessionClient = createSessionClient as jest.MockedFunction<typeof createSessionClient>;

type StateListener = (state: DeviceSessionState | null) => void;

function buildFakeClient(initialState: DeviceSessionState | null) {
  let state = initialState;
  const listeners = new Set<StateListener>();
  return {
    fakeClient: {
      getState: () => state,
      subscribe: (listener: StateListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      stop: jest.fn(),
    },
    fire() {
      for (const listener of listeners) listener(state);
    },
  };
}

function buildDeviceState(activeAccountId: string | null): DeviceSessionState {
  return {
    deviceId: 'dev-1',
    accounts: [
      { accountId: 'a1', sessionId: 'sess-a1', authuser: 0 },
      { accountId: 'a2', sessionId: 'sess-a2', authuser: 1 },
    ],
    activeAccountId,
    revision: 1,
    updatedAt: Date.now(),
  };
}

function buildUser(id: string): User {
  return { id, username: `user-${id}` } as User;
}

interface ProbeState {
  isAuthenticated: boolean;
  userId: string | null;
  sessionsLength: number;
  activeSessionId: string | null;
  accountsLength: number;
  activeAuthuser: number | null;
}

function Probe({ onState }: { onState: (s: ProbeState) => void }) {
  const { isAuthenticated, user, sessions, activeSessionId, accounts, activeAuthuser } = useAuth();
  onState({
    isAuthenticated,
    userId: user?.id ?? null,
    sessionsLength: sessions.length,
    activeSessionId,
    accountsLength: accounts.length,
    activeAuthuser,
  });
  return null;
}

function renderProvider(onState: (s: ProbeState) => void) {
  return render(
    <WebOxyProvider baseURL={stubs.baseURL}>
      <Probe onState={onState} />
    </WebOxyProvider>,
  );
}

describe('WebOxyProvider — SessionClient projection (device-first)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    stubs.getUsersByIds = jest.fn(async () => []);
    stubs.getUserById = jest.fn(async () => { throw new Error('not found'); });
    mockedCreateSessionClient.mockReset();
  });

  it('projects a populated DeviceSessionState onto sessions/activeSessionId/user/accounts', async () => {
    const deviceState = buildDeviceState('a2');
    const fake = buildFakeClient(deviceState);
    const setCurrentAccountId = jest.fn();
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId } as never,
    });
    stubs.getUsersByIds = jest.fn(async () => [buildUser('a1'), buildUser('a2')]);

    let latest: ProbeState = {
      isAuthenticated: false, userId: null, sessionsLength: 0, activeSessionId: null,
      accountsLength: 0, activeAuthuser: null,
    };
    renderProvider((s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(false));

    act(() => { fake.fire(); });

    await waitFor(() => expect(latest.sessionsLength).toBe(2));
    expect(latest.activeSessionId).toBe('sess-a2');
    expect(latest.userId).toBe('a2');
    expect(latest.accountsLength).toBe(2);
    expect(latest.activeAuthuser).toBe(1);
    expect(stubs.getUsersByIds).toHaveBeenCalledWith(['a1', 'a2']);
    expect(setCurrentAccountId).toHaveBeenCalledWith('a2');
  });

  it('still lists accounts when the batch profile fetch fails (no bail to empty)', async () => {
    const deviceState = buildDeviceState('a2');
    const fake = buildFakeClient(deviceState);
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });
    // A transient batch-profile failure must NOT empty the chooser.
    stubs.getUsersByIds = jest.fn(async () => { throw new Error('network'); });

    let latest: ProbeState = {
      isAuthenticated: false, userId: null, sessionsLength: 0, activeSessionId: null,
      accountsLength: 0, activeAuthuser: null,
    };
    renderProvider((s) => { latest = s; });
    await waitFor(() => expect(latest.isAuthenticated).toBe(false));

    act(() => { fake.fire(); });

    // Accounts + sessions are still projected (handle-fallback rows) from the
    // SessionClient state even though every profile fetch threw.
    await waitFor(() => expect(latest.accountsLength).toBe(2));
    expect(latest.sessionsLength).toBe(2);
    expect(latest.activeSessionId).toBe('sess-a2');
    expect(latest.activeAuthuser).toBe(1);
  });

  it('is inert while client.getState() is null (signed-out cold boot)', async () => {
    const fake = buildFakeClient(null);
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });

    let latest: ProbeState = {
      isAuthenticated: false, userId: null, sessionsLength: 0, activeSessionId: null,
      accountsLength: 0, activeAuthuser: null,
    };
    renderProvider((s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(false));

    act(() => { fake.fire(); });

    expect(latest.sessionsLength).toBe(0);
    expect(latest.userId).toBeNull();
    expect(stubs.getUsersByIds).not.toHaveBeenCalled();
  });

  it('injects the statically-imported socket.io factory as the third createSessionClient argument', async () => {
    const fake = buildFakeClient(null);
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });

    let latest: ProbeState = {
      isAuthenticated: false, userId: null, sessionsLength: 0, activeSessionId: null,
      accountsLength: 0, activeAuthuser: null,
    };
    renderProvider((s) => { latest = s; });
    await waitFor(() => expect(latest.isAuthenticated).toBe(false));

    expect(mockedCreateSessionClient).toHaveBeenCalledTimes(1);
    const args = mockedCreateSessionClient.mock.calls[0];
    expect(args).toHaveLength(3);
    expect(typeof args[2]).toBe('function');
  });
});
