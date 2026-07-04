/**
 * Device-first `WebOxyProvider`: account-mutation methods routed ENTIRELY
 * through the server-authoritative `SessionClient`.
 *
 * Same harness as `sessionClientWiring.test.tsx` (cold boot mocked signed-out;
 * `createSessionClient` the one swappable seam; real projection helpers). The
 * fake client's initial 2-account `DeviceSessionState` is projected via a manual
 * `fire()`, giving each test a populated starting point to mutate.
 *
 * Contract under test:
 *   1. `switchSession(sessionId)` → `sessionClient.switchAccount(accountId)`.
 *   2. `switchSession` with an unknown session id REJECTS and never switches.
 *   3. `signOut()` revokes every account (`sessionClient.signOut({ all: true })`)
 *      and clears local state.
 *   4. `signOutAccount(authuser)` → `sessionClient.signOut({ accountId })`.
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

import { WebOxyProvider, useAuth, type WebOxyContextValue } from '../src/WebOxyProvider';
import { createSessionClient } from '@oxyhq/core';

const mockedCreateSessionClient = createSessionClient as jest.MockedFunction<typeof createSessionClient>;

type StateListener = (state: DeviceSessionState | null) => void;

function buildFakeClient(initialState: DeviceSessionState) {
  let state: DeviceSessionState | null = initialState;
  const listeners = new Set<StateListener>();
  const switchAccount = jest.fn(async (accountId: string) => {
    if (state) state = { ...state, activeAccountId: accountId, revision: state.revision + 1 };
  });
  const signOut = jest.fn(async (target: { accountId: string } | { all: true }) => {
    if (!state) return;
    if ('all' in target) {
      state = { ...state, accounts: [], activeAccountId: null, revision: state.revision + 1 };
    } else {
      const accounts = state.accounts.filter((a) => a.accountId !== target.accountId);
      state = { ...state, accounts, revision: state.revision + 1 };
    }
  });
  return {
    switchAccount,
    signOut,
    fakeClient: {
      getState: () => state,
      subscribe: (listener: StateListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      switchAccount,
      signOut,
      stop: jest.fn(),
    },
    fire() {
      for (const listener of listeners) listener(state);
    },
  };
}

function buildDeviceState(): DeviceSessionState {
  return {
    deviceId: 'dev-1',
    accounts: [
      { accountId: 'a1', sessionId: 'sess-a1', authuser: 0 },
      { accountId: 'a2', sessionId: 'sess-a2', authuser: 1 },
    ],
    activeAccountId: 'a1',
    revision: 1,
    updatedAt: Date.now(),
  };
}

function buildUser(id: string): User {
  return { id, username: `user-${id}` } as User;
}

let ctxRef: WebOxyContextValue | null = null;

function Capture() {
  ctxRef = useAuth() as unknown as WebOxyContextValue;
  return null;
}

function setup(fakeState: DeviceSessionState) {
  const fake = buildFakeClient(fakeState);
  mockedCreateSessionClient.mockReturnValue({
    client: fake.fakeClient as never,
    host: { setCurrentAccountId: jest.fn() } as never,
  });
  stubs.getUsersByIds = jest.fn(async () => [buildUser('a1'), buildUser('a2')]);
  render(
    <WebOxyProvider baseURL={stubs.baseURL}>
      <Capture />
    </WebOxyProvider>,
  );
  return fake;
}

describe('WebOxyProvider — account mutations over SessionClient (device-first)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    ctxRef = null;
    mockedCreateSessionClient.mockReset();
  });

  it('switchSession(sessionId) resolves the account and calls sessionClient.switchAccount', async () => {
    const fake = setup(buildDeviceState());
    await waitFor(() => expect(ctxRef).not.toBeNull());
    act(() => { fake.fire(); });
    await waitFor(() => expect(ctxRef?.sessions.length).toBe(2));

    await act(async () => { await ctxRef?.switchSession('sess-a2'); });
    expect(fake.switchAccount).toHaveBeenCalledWith('a2');
  });

  it('switchSession with an unknown session id rejects and never switches', async () => {
    const fake = setup(buildDeviceState());
    await waitFor(() => expect(ctxRef).not.toBeNull());
    act(() => { fake.fire(); });
    await waitFor(() => expect(ctxRef?.sessions.length).toBe(2));

    await expect(ctxRef?.switchSession('sess-nope')).rejects.toThrow();
    expect(fake.switchAccount).not.toHaveBeenCalled();
  });

  it('signOut() revokes every account via sessionClient.signOut({ all: true }) and clears local state', async () => {
    const fake = setup(buildDeviceState());
    await waitFor(() => expect(ctxRef).not.toBeNull());
    act(() => { fake.fire(); });
    await waitFor(() => expect(ctxRef?.sessions.length).toBe(2));

    await act(async () => { await ctxRef?.signOut(); });
    expect(fake.signOut).toHaveBeenCalledWith({ all: true });
    await waitFor(() => expect(ctxRef?.isAuthenticated).toBe(false));
    expect(ctxRef?.sessions.length).toBe(0);
    expect(ctxRef?.accounts.length).toBe(0);
    expect(ctxRef?.activeAuthuser).toBeNull();
  });

  it('signOutAccount(authuser) resolves the numeric slot to its account id and revokes it', async () => {
    const fake = setup(buildDeviceState());
    await waitFor(() => expect(ctxRef).not.toBeNull());
    act(() => { fake.fire(); });
    await waitFor(() => expect(ctxRef?.sessions.length).toBe(2));

    await act(async () => { await ctxRef?.signOutAccount(1); });
    expect(fake.signOut).toHaveBeenCalledWith({ accountId: 'a2' });
  });
});
