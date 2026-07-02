/**
 * Task 1 (Fase 4 `WebOxyProvider` cutover): `SessionClient` wiring into
 * `WebOxyProvider` is ADDITIVE and INERT until Task 2 calls `client.start()`.
 *
 * `WebOxyProvider` now builds a `SessionClient` (via the shared
 * `@oxyhq/core` `createSessionClient` factory + the local WEB-ONLY
 * `createWebTokenTransport`) once per `oxyServices` instance and subscribes to
 * it, projecting `client.getState()` onto the exposed `sessions` /
 * `activeSessionId` / `user` through the same setters (`setActiveSessionId`,
 * `setUser`) and a new `clientProjectedSessions` override the cold-boot path
 * already uses. `client.start()` is NOT called by this task — that is Task
 * 2's job — so in production `client.getState()` never advances past `null`
 * and the projection is a guaranteed no-op.
 *
 * This suite proves the projection logic in isolation by swapping in a
 * controllable fake client (mocking only `createSessionClient` from
 * `@oxyhq/core`; the pure projection helpers — `deviceStateToClientSessions`,
 * `activeSessionIdOf`, `activeUserOf`, `accountIdsOf` — are the REAL
 * implementations via `jest.requireActual`):
 *
 *  1. When the fake client's `getState()` returns a populated 2-account
 *     `DeviceSessionState` and the subscriber fires, the context exposes both
 *     sessions, the correct `activeSessionId`, and the active account's `user`.
 *  2. When `getState()` returns `null` (the REAL production shape, since
 *     nothing calls `client.start()` in this task) firing the subscriber is a
 *     no-op — the existing state is left untouched.
 *
 * The rest of the cold boot (SSO return / silent-iframe / sso-bounce) is
 * neutralized the same way `WebOxyProvider.coldBoot.test.tsx`
 * does — stubbed `OxyServices`/`CrossDomainAuth`/`AuthManager` surfaces so the
 * provider settles deterministically to `unauthenticated` without a backend,
 * leaving `sessions`/`activeSessionId`/`user` solely a function of the
 * `SessionClient` projection under test. The first-time-visitor default (no
 * durable prior-session hint seeded) means the cold boot's terminal
 * `sso-bounce` step is also skipped (see `allowSsoBounce`), so no navigation
 * is attempted.
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
  baseURL: 'https://api.test-session-client-wiring',
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
    // Real cold-boot primitives + SSO helpers — same subset
    // `WebOxyProvider.coldBoot.test.tsx` wires through, so the cold boot
    // resolves deterministically to `unauthenticated` (no fragment, no
    // silent-iframe session, no cookie, no prior-session hint → no bounce).
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
    // Pure projection helpers: REAL implementations under test.
    deviceStateToClientSessions: actual.deviceStateToClientSessions,
    activeSessionIdOf: actual.activeSessionIdOf,
    activeUserOf: actual.activeUserOf,
    accountIdsOf: actual.accountIdsOf,
    // `createSessionClient` is the ONE mocked seam: swapped per-test for a
    // controllable fake client/host pair.
    createSessionClient: jest.fn(),
    // Stubbed service / auth surfaces (mirrors `WebOxyProvider.coldBoot.test.tsx`).
    // No `AuthManager`/`createAuthManager` export: `WebOxyProvider` no longer
    // imports them (Fase 4 cutover, Task 5) — if it ever did again, this suite
    // would fail immediately with a hard runtime error instead of silently
    // reintroducing the retired hybrid.
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

/**
 * A controllable stand-in for `SessionClient`: `getState()` + `subscribe()`
 * are all `syncFromClient` reads — the rest of the real class (`bootstrap`,
 * `switchAccount`, `signOut`, `start`) is intentionally NOT implemented since
 * Task 1 never calls them. `stop` IS implemented (a no-op spy) since
 * `WebOxyProvider` calls it unconditionally on unmount.
 */
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
      for (const listener of listeners) {
        listener(state);
      }
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
}

function Probe({ onState }: { onState: (s: ProbeState) => void }) {
  const { isAuthenticated, user, sessions, activeSessionId } = useAuth();
  onState({ isAuthenticated, userId: user?.id ?? null, sessionsLength: sessions.length, activeSessionId });
  return null;
}

function renderProvider(onState: (s: ProbeState) => void) {
  return render(
    <WebOxyProvider baseURL={stubs.baseURL}>
      <Probe onState={onState} />
    </WebOxyProvider>,
  );
}

describe('SessionClient wiring into WebOxyProvider (Task 1 — additive, inert until client.start())', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetStubs();
    mockedCreateSessionClient.mockReset();
  });

  it('projects a populated DeviceSessionState onto sessions/activeSessionId/user when the client notifies', async () => {
    const deviceState = buildDeviceState('a2');
    const fake = buildFakeClient(deviceState);
    const setCurrentAccountId = jest.fn();
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId } as never,
    });
    stubs.getUsersByIds = jest.fn(async () => [buildUser('a1'), buildUser('a2')]);

    let latest: ProbeState = { isAuthenticated: false, userId: null, sessionsLength: 0, activeSessionId: null };
    renderProvider((s) => { latest = s; });

    // Let the cold boot settle first (unauthenticated: no fragment, no
    // silent-iframe session, no cookie, no prior-session hint → no bounce).
    await waitFor(() => expect(latest.isAuthenticated).toBe(false));

    act(() => {
      fake.fire();
    });

    await waitFor(() => expect(latest.sessionsLength).toBe(2));
    expect(latest.activeSessionId).toBe('sess-a2');
    expect(latest.userId).toBe('a2');
    expect(stubs.getUsersByIds).toHaveBeenCalledWith(['a1', 'a2']);
    expect(setCurrentAccountId).toHaveBeenCalledWith('a2');
  });

  it('is inert while client.getState() is null (the real production shape — nothing calls client.start() in this task)', async () => {
    const fake = buildFakeClient(null);
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });

    let latest: ProbeState = { isAuthenticated: false, userId: null, sessionsLength: 0, activeSessionId: null };
    renderProvider((s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(false));

    act(() => {
      fake.fire();
    });

    expect(latest.sessionsLength).toBe(0);
    expect(latest.activeSessionId).toBeNull();
    expect(latest.userId).toBeNull();
    expect(stubs.getUsersByIds).not.toHaveBeenCalled();
  });
});
