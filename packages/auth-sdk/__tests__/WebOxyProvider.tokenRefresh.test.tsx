/**
 * @jest-environment-options {"url": "https://mention.earth/"}
 *
 * Task 5.2 (Fase 4 `WebOxyProvider` cutover): integration-level proof that
 * `WebOxyProvider` actually WIRES the in-session refresh handler + scheduler
 * from `./session/tokenRefresh.ts` into `oxyServices.httpService` — the arm's
 * own logic (silent-iframe re-mint, scheduler timer math) is
 * covered in isolation by `__tests__/session/tokenRefresh.test.ts`. This file
 * only asserts the WIRING: install on mount, uninstall on unmount, and that
 * invoking the installed handler re-mints + registers the recovered account
 * into the `SessionClient` device set exactly like a winning cold-boot ladder
 * step would.
 *
 * The fixed jsdom origin (a cross-domain RP, mirroring
 * `WebOxyProvider.coldBoot.test.tsx`) is REQUIRED so `autoDetectAuthWebUrl`
 * (real implementation) resolves a per-apex host instead of bailing on
 * `localhost` — otherwise the silent-iframe arm would never even attempt
 * `silentSignIn`.
 *
 * Mirrors the `WebOxyProvider.sessionClientMutations.test.tsx` harness:
 * `createSessionClient` is the ONE mocked seam (a controllable fake client),
 * no `AuthManager`/`createAuthManager` export (Fase 4 cutover, Task 5 —
 * retired).
 */

import { render, waitFor, act } from '@testing-library/react';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import type { DeviceSessionState } from '@oxyhq/contracts';

interface CoreStubs {
  getCurrentUser: jest.Mock<Promise<User | null>, []>;
  handleRedirectCallback: jest.Mock<SessionLoginResponse | null, []>;
  silentSignIn: jest.Mock<Promise<SessionLoginResponse | null>, [unknown?]>;
  exchangeSsoCode: jest.Mock<Promise<SessionLoginResponse>, [string]>;
  generateSsoState: jest.Mock<string, []>;
  getUsersByIds: jest.Mock<Promise<User[]>, [string[]]>;
  installedHandler: ((reason: string) => Promise<string | null>) | null;
  baseURL: string;
}

const stubs: CoreStubs = {
  getCurrentUser: jest.fn(async () => null),
  handleRedirectCallback: jest.fn(() => null),
  silentSignIn: jest.fn(async () => null),
  exchangeSsoCode: jest.fn(async () => ({}) as SessionLoginResponse),
  generateSsoState: jest.fn(() => 'state-fixed'),
  getUsersByIds: jest.fn(async () => []),
  installedHandler: null,
  baseURL: 'https://api.test-token-refresh',
};

function resetStubs(): void {
  stubs.getCurrentUser = jest.fn(async () => null);
  stubs.handleRedirectCallback = jest.fn(() => null);
  stubs.silentSignIn = jest.fn(async () => null);
  stubs.exchangeSsoCode = jest.fn(async () => ({}) as SessionLoginResponse);
  stubs.generateSsoState = jest.fn(() => 'state-fixed');
  stubs.getUsersByIds = jest.fn(async () => []);
  stubs.installedHandler = null;
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
    deviceStateToClientSessions: actual.deviceStateToClientSessions,
    activeSessionIdOf: actual.activeSessionIdOf,
    activeUserOf: actual.activeUserOf,
    accountIdsOf: actual.accountIdsOf,
    createSessionClient: jest.fn(),
    // No `AuthManager`/`createAuthManager` export: `WebOxyProvider` no longer
    // imports them (Fase 4 cutover, Task 5).
    OxyServices: class {
      _accessToken: string | null = null;
      httpService = {
        setAuthRefreshHandler: (handler: ((reason: string) => Promise<string | null>) | null) => {
          stubs.installedHandler = handler;
        },
        refreshAccessToken: async () => null,
      };
      getBaseURL(): string {
        return stubs.baseURL;
      }
      getCurrentUser(): Promise<User | null> {
        return stubs.getCurrentUser();
      }
      silentSignIn(options?: unknown): Promise<SessionLoginResponse | null> {
        return stubs.silentSignIn(options);
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

function buildFakeClient() {
  let state: DeviceSessionState | null = null;
  const listeners = new Set<StateListener>();
  const fire = () => {
    for (const listener of listeners) listener(state);
  };
  return {
    fakeClient: {
      getState: () => state,
      subscribe: (listener: StateListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      addCurrentAccount: jest.fn(async () => {
        state = {
          deviceId: 'dev-1',
          accounts: [{ accountId: 'u1', sessionId: 'sess-refresh', authuser: 0 }],
          activeAccountId: 'u1',
          revision: 1,
          updatedAt: Date.now(),
        };
        fire();
      }),
      start: jest.fn(async () => {
        fire();
      }),
      stop: jest.fn(),
    },
    setCurrentAccountId: jest.fn(),
  };
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

describe('WebOxyProvider in-session token refresh wiring (Task 5.2)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetStubs();
    mockedCreateSessionClient.mockReset();
    const fake = buildFakeClient();
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: fake.setCurrentAccountId } as never,
    });
  });

  it('installs a refresh handler on oxyServices.httpService on mount, and clears it on unmount', async () => {
    let latest: ReturnType<typeof useAuth> | null = null;
    const { unmount } = renderProvider((a) => { latest = a; });

    await waitFor(() => expect(latest?.isLoading).toBe(false));
    await waitFor(() => expect(stubs.installedHandler).toEqual(expect.any(Function)));

    unmount();

    expect(stubs.installedHandler).toBeNull();
  });

  it('invoking the installed handler re-mints via silent sign-in and registers the account into the SessionClient device set', async () => {
    let latest: ReturnType<typeof useAuth> | null = null;
    renderProvider((a) => { latest = a; });

    await waitFor(() => expect(latest?.isLoading).toBe(false));
    await waitFor(() => expect(stubs.installedHandler).toEqual(expect.any(Function)));

    stubs.silentSignIn.mockResolvedValue({
      sessionId: 'sess-refresh',
      deviceId: 'dev-1',
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      accessToken: 'tok-refresh',
      user: { id: 'u1', username: 'tester' } as User,
    });

    let token: string | null = null;
    await act(async () => {
      token = stubs.installedHandler ? await stubs.installedHandler('response-401') : null;
    });

    expect(token).toBe('tok-refresh');
    await waitFor(() => expect(latest?.isAuthenticated).toBe(true));
    expect(latest?.user?.id).toBe('u1');
  });
});
