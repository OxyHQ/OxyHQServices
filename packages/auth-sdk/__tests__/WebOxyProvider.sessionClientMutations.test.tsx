/**
 * Task 3 + Task 5 (Fase 4 `WebOxyProvider` cutover): account-mutation methods
 * routed ENTIRELY through the server-authoritative `SessionClient` — there is
 * no `AuthManager` / `oxy_rt` cookie-slot registry left anywhere in
 * `WebOxyProvider` (Task 5's clean cut).
 *
 * Mirrors `sessionClientWiring.test.tsx` (Task 1) and
 * `WebOxyProvider.coldBoot.test.tsx` (Task 2)'s harness: `@oxyhq/core` is
 * mocked with `createSessionClient` as the ONE swappable seam (a controllable
 * fake client), the REAL pure projection helpers, and stubbed
 * `OxyServices`/`CrossDomainAuth` surfaces (no `AuthManager` export — if
 * `WebOxyProvider` ever imported it again this suite would fail immediately
 * with a hard runtime error) so cold boot settles deterministically to
 * `unauthenticated` (no fragment, no silent-iframe session, no prior-session
 * hint -> no bounce) without a backend. The fake client's initial `DeviceSessionState`
 * is pushed through `syncFromClient` via a manual `fire()` (cold boot never
 * calls `client.start()` here since no session was acquired by the ladder —
 * same convention as `sessionClientWiring.test.tsx`), giving each test a
 * populated 2-account starting point to mutate.
 *
 * Contract under test:
 *   1. `switchSession(sessionId)` resolves the session id to its device
 *      account and switches via `sessionClient.switchAccount(accountId)`.
 *   2. `switchSession` with an unknown session id REJECTS (never silently
 *      no-ops) and never calls `sessionClient.switchAccount`.
 *   3. `signOut()` revokes every device account
 *      (`sessionClient.signOut({ all: true })`) AND fully cleans up locally
 *      (`user`/`sessions`/`accounts`/`activeAuthuser` cleared).
 *   4. `signOutAccount(authuser)` resolves the LEGACY numeric `authuser` to
 *      its device account id and revokes it via
 *      `sessionClient.signOut({ accountId })`.
 *   5. `accounts`/`activeAuthuser` are projected from the SAME
 *      `DeviceSessionState` `sessions`/`activeSessionId` are — never from an
 *      `AuthManager` (there is none).
 */

import { render, waitFor, act } from '@testing-library/react';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import type { DeviceSessionState } from '@oxyhq/contracts';

interface CoreStubs {
  getCurrentUser: jest.Mock<Promise<User | null>, []>;
  handleRedirectCallback: jest.Mock<SessionLoginResponse | null, []>;
  exchangeSsoCode: jest.Mock<Promise<SessionLoginResponse>, [string]>;
  generateSsoState: jest.Mock<string, []>;
  getUsersByIds: jest.Mock<Promise<User[]>, [string[]]>;
  baseURL: string;
}

const stubs: CoreStubs = {
  getCurrentUser: jest.fn(async () => null),
  handleRedirectCallback: jest.fn(() => null),
  exchangeSsoCode: jest.fn(async () => ({}) as SessionLoginResponse),
  generateSsoState: jest.fn(() => 'state-fixed'),
  getUsersByIds: jest.fn(async () => []),
  baseURL: 'https://api.test-session-client-mutations',
};

function resetStubs(): void {
  stubs.getCurrentUser = jest.fn(async () => null);
  stubs.handleRedirectCallback = jest.fn(() => null);
  stubs.exchangeSsoCode = jest.fn(async () => ({}) as SessionLoginResponse);
  stubs.generateSsoState = jest.fn(() => 'state-fixed');
  stubs.getUsersByIds = jest.fn(async () => []);
}

jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return {
    __esModule: true,
    runColdBoot: actual.runColdBoot,
    resolveCentralAuthUrl: actual.resolveCentralAuthUrl,
    CENTRAL_AUTH_URL: actual.CENTRAL_AUTH_URL,
    parseSsoReturnFragment: actual.parseSsoReturnFragment,
    consumeSsoReturn: actual.consumeSsoReturn,
    SSO_CALLBACK_PATH: actual.SSO_CALLBACK_PATH,
    ssoStateKey: actual.ssoStateKey,
    ssoNoSessionKey: actual.ssoNoSessionKey,
    ssoGuardKey: actual.ssoGuardKey,
    ssoDestKey: actual.ssoDestKey,
    ssoAttemptedKey: actual.ssoAttemptedKey,
    ssoPriorSessionKey: actual.ssoPriorSessionKey,
    ssoSignedOutKey: actual.ssoSignedOutKey,
    silentRestoreSuppressed: actual.silentRestoreSuppressed,
    isCentralIdPOrigin: actual.isCentralIdPOrigin,
    guardActive: actual.guardActive,
    allowSsoBounce: actual.allowSsoBounce,
    buildSsoBounceUrl: actual.buildSsoBounceUrl,
    logger: actual.logger,
    autoDetectAuthWebUrl: actual.autoDetectAuthWebUrl,
    // Pure projection helpers — REAL implementations under test.
    deviceStateToClientSessions: actual.deviceStateToClientSessions,
    activeSessionIdOf: actual.activeSessionIdOf,
    activeUserOf: actual.activeUserOf,
    accountIdsOf: actual.accountIdsOf,
    // `createSessionClient` is the ONE mocked seam: swapped per-test for a
    // controllable fake client/host pair.
    createSessionClient: jest.fn(),
    // No `AuthManager`/`createAuthManager` export: `WebOxyProvider` no longer
    // imports them (Fase 4 cutover, Task 5).
    OxyServices: class {
      _accessToken: string | null = null;
      httpService = {
        setAuthRefreshHandler: (_handler: unknown) => undefined,
        refreshAccessToken: async () => null,
      };
      getBaseURL(): string {
        return stubs.baseURL;
      }
      getCurrentUser(): Promise<User | null> {
        return stubs.getCurrentUser();
      }
      exchangeSsoCode(code: string): Promise<SessionLoginResponse> {
        return stubs.exchangeSsoCode(code);
      }
      generateSsoState(): string {
        return stubs.generateSsoState();
      }
      setTokens(token: string): void {
        this._accessToken = token;
      }
      getAccessToken(): string | null {
        return this._accessToken;
      }
      getAccessTokenExpiry(): number | null {
        return null;
      }
      onTokensChanged(_listener: (token: string | null) => void): () => void {
        return () => undefined;
      }
      getUsersByIds(ids: string[]): Promise<User[]> {
        return stubs.getUsersByIds(ids);
      }
    },
    CrossDomainAuth: class {
      handleRedirectCallback(): SessionLoginResponse | null {
        return stubs.handleRedirectCallback();
      }
    },
  };
});

import { WebOxyProvider, useAuth } from '../src/WebOxyProvider';
import { createSessionClient } from '@oxyhq/core';

const mockedCreateSessionClient = createSessionClient as jest.MockedFunction<typeof createSessionClient>;

type StateListener = (state: DeviceSessionState | null) => void;
type SignOutTarget = { accountId: string } | { all: true };

/**
 * A controllable stand-in for `SessionClient` that also implements
 * `switchAccount`/`signOut` (unlike `sessionClientWiring.test.tsx`'s
 * projection-only fake) so this suite can assert Task 3's mutation wiring.
 * Both mutate the fake's internal state and re-`fire()`, mirroring the real
 * class's `applySync` -> `notify()` sequence.
 */
function buildFakeClient(initialState: DeviceSessionState | null) {
  let state = initialState;
  const listeners = new Set<StateListener>();
  const fire = () => {
    for (const listener of listeners) listener(state);
  };
  const switchAccount = jest.fn(async (accountId: string) => {
    if (state) {
      state = { ...state, activeAccountId: accountId, revision: state.revision + 1 };
    }
    fire();
  });
  const signOut = jest.fn(async (target: SignOutTarget) => {
    if (!state) return;
    if ('all' in target && target.all) {
      state = { ...state, accounts: [], activeAccountId: null, revision: state.revision + 1 };
    } else if ('accountId' in target) {
      const remaining = state.accounts.filter((account) => account.accountId !== target.accountId);
      state = {
        ...state,
        accounts: remaining,
        activeAccountId:
          state.activeAccountId === target.accountId
            ? (remaining[0]?.accountId ?? null)
            : state.activeAccountId,
        revision: state.revision + 1,
      };
    }
    fire();
  });
  return {
    fakeClient: {
      getState: () => state,
      subscribe: (listener: StateListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      switchAccount,
      signOut,
      addCurrentAccount: jest.fn(async () => {
        fire();
      }),
      start: jest.fn(async () => {
        fire();
      }),
      stop: jest.fn(),
    },
    fire,
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

function CaptureAuth({ onReady }: { onReady: (auth: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onReady(auth);
  return null;
}

function renderProvider(onReady: (auth: ReturnType<typeof useAuth>) => void) {
  return render(
    <WebOxyProvider baseURL={stubs.baseURL}>
      <CaptureAuth onReady={onReady} />
    </WebOxyProvider>,
  );
}

describe('WebOxyProvider account mutations routed through SessionClient (Task 3)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetStubs();
    mockedCreateSessionClient.mockReset();
  });

  it('switchSession resolves the session id to its device account and switches via SessionClient', async () => {
    const fake = buildFakeClient(buildDeviceState('a1'));
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });
    stubs.getUsersByIds = jest.fn(async () => [buildUser('a1'), buildUser('a2')]);

    let latest: ReturnType<typeof useAuth> | null = null;
    renderProvider((a) => {
      latest = a;
    });

    await waitFor(() => expect(latest?.isLoading).toBe(false));
    act(() => {
      fake.fire();
    });
    await waitFor(() => expect(latest?.sessions.length).toBe(2));

    await act(async () => {
      await latest?.switchSession('sess-a2');
    });

    expect(fake.fakeClient.switchAccount).toHaveBeenCalledWith('a2');
    expect(latest?.activeSessionId).toBe('sess-a2');
    expect(latest?.user?.id).toBe('a2');
    // `accounts`/`activeAuthuser` are projected from the SAME SessionClient
    // state `sessions`/`activeSessionId` derive from — never from an
    // AuthManager (there is none).
    expect(latest?.activeAuthuser).toBe(1);
    expect(latest?.accounts.map((a) => a.authuser)).toEqual([0, 1]);
  });

  it('switchSession rejects for a session id not on this device (never silently no-ops)', async () => {
    const fake = buildFakeClient(buildDeviceState('a1'));
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });
    stubs.getUsersByIds = jest.fn(async () => [buildUser('a1'), buildUser('a2')]);

    let latest: ReturnType<typeof useAuth> | null = null;
    renderProvider((a) => {
      latest = a;
    });

    await waitFor(() => expect(latest?.isLoading).toBe(false));
    act(() => {
      fake.fire();
    });
    await waitFor(() => expect(latest?.sessions.length).toBe(2));

    await expect(latest?.switchSession('sess-unknown')).rejects.toThrow(
      /No device account found for session/,
    );
    expect(fake.fakeClient.switchAccount).not.toHaveBeenCalled();
  });

  it('signOut revokes every device account via SessionClient({all:true}) and fully cleans up locally', async () => {
    const fake = buildFakeClient(buildDeviceState('a1'));
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });
    stubs.getUsersByIds = jest.fn(async () => [buildUser('a1'), buildUser('a2')]);

    let latest: ReturnType<typeof useAuth> | null = null;
    renderProvider((a) => {
      latest = a;
    });

    await waitFor(() => expect(latest?.isLoading).toBe(false));
    act(() => {
      fake.fire();
    });
    await waitFor(() => expect(latest?.isAuthenticated).toBe(true));

    await act(async () => {
      await latest?.signOut();
    });

    // Server-authoritative revocation.
    expect(fake.fakeClient.signOut).toHaveBeenCalledWith({ all: true });
    // Local cleanup: auth state wiped, including the SessionClient-projected
    // `accounts`/`activeAuthuser` (there is no separate AuthManager registry
    // left to also tear down).
    expect(latest?.isAuthenticated).toBe(false);
    expect(latest?.user).toBeNull();
    expect(latest?.sessions.length).toBe(0);
    expect(latest?.accounts).toEqual([]);
    expect(latest?.activeAuthuser).toBeNull();
  });

  it('signOutAccount resolves the legacy authuser to its device account id and revokes it via SessionClient', async () => {
    const fake = buildFakeClient(buildDeviceState('a1'));
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });
    stubs.getUsersByIds = jest.fn(async () => [buildUser('a1'), buildUser('a2')]);

    let latest: ReturnType<typeof useAuth> | null = null;
    renderProvider((a) => {
      latest = a;
    });

    await waitFor(() => expect(latest?.isLoading).toBe(false));
    act(() => {
      fake.fire();
    });
    await waitFor(() => expect(latest?.isAuthenticated).toBe(true));

    await act(async () => {
      // authuser=1 maps to accountId 'a2' in `buildDeviceState`; the active
      // account ('a1', authuser 0) is untouched.
      await latest?.signOutAccount(1);
    });

    expect(fake.fakeClient.signOut).toHaveBeenCalledWith({ accountId: 'a2' });
    // The removed account drops out of the SessionClient-projected `accounts`;
    // the still-active account's authuser is unaffected.
    expect(latest?.accounts.map((a) => a.authuser)).toEqual([0]);
    expect(latest?.activeAuthuser).toBe(0);
  });

  it('signOutAccount with an unmapped authuser surfaces via error (never rejects)', async () => {
    const fake = buildFakeClient(buildDeviceState('a1'));
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });
    stubs.getUsersByIds = jest.fn(async () => [buildUser('a1'), buildUser('a2')]);

    let latest: ReturnType<typeof useAuth> | null = null;
    renderProvider((a) => {
      latest = a;
    });

    await waitFor(() => expect(latest?.isLoading).toBe(false));
    act(() => {
      fake.fire();
    });
    await waitFor(() => expect(latest?.isAuthenticated).toBe(true));

    await act(async () => {
      await latest?.signOutAccount(99);
    });

    expect(fake.fakeClient.signOut).not.toHaveBeenCalled();
  });
});
