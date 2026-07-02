/**
 * Direct unit tests for `@oxyhq/auth`'s in-session token refresh module
 * (Fase 4 cutover — Task 5.2, the replacement for `AuthManager`'s
 * `setupCookieRefresh` + reactive `HttpService` refresh handler).
 *
 * Exercises `createWebAuthRefreshHandler` + `startTokenRefreshScheduler` in
 * ISOLATION (no React tree) against a minimal `OxyServices`-shaped fake —
 * mirrors the "pure logic unit" test style already used for
 * `sessionHelpers.ts` / `errorHandlers.ts` in this package. See
 * `WebOxyProvider.tokenRefresh.test.tsx` for the integration-level proof that
 * `WebOxyProvider` actually wires these into `oxyServices.httpService`.
 */

jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return {
    __esModule: true,
    logger: actual.logger,
    autoDetectAuthWebUrl: jest.fn(() => 'https://auth.example.test'),
  };
});

import type { AuthRefreshReason, OxyServices, SessionLoginResponse } from '@oxyhq/core';
import { autoDetectAuthWebUrl } from '@oxyhq/core';
import {
  createWebAuthRefreshHandler,
  startTokenRefreshScheduler,
  TOKEN_REFRESH_LEAD_MS,
} from '../../src/session/tokenRefresh';

const mockedAutoDetect = autoDetectAuthWebUrl as jest.MockedFunction<typeof autoDetectAuthWebUrl>;

interface FakeOxyServices {
  silentSignIn: jest.Mock<Promise<SessionLoginResponse | null>, [unknown?]>;
  silentSignInWithFedCM: jest.Mock<Promise<SessionLoginResponse | null>, []>;
  isFedCMSupported: jest.Mock<boolean, []>;
  setTokens: (token: string) => void;
  getAccessToken: () => string | null;
  setExpirySeconds: (value: number | null) => void;
  getAccessTokenExpiry: () => number | null;
  onTokensChanged: (listener: (token: string | null) => void) => () => void;
  httpService: {
    refreshAccessToken: jest.Mock<Promise<string | null>, [AuthRefreshReason]>;
    setAuthRefreshHandler: jest.Mock<void, [unknown]>;
  };
}

function buildFakeOxyServices(): FakeOxyServices {
  let accessToken: string | null = null;
  let expirySeconds: number | null = null;
  const tokenListeners = new Set<(token: string | null) => void>();
  return {
    silentSignIn: jest.fn(async () => null),
    silentSignInWithFedCM: jest.fn(async () => null),
    isFedCMSupported: jest.fn(() => false),
    setTokens: (token: string) => {
      accessToken = token;
      for (const listener of tokenListeners) listener(token);
    },
    getAccessToken: () => accessToken,
    setExpirySeconds: (value: number | null) => {
      expirySeconds = value;
    },
    getAccessTokenExpiry: () => expirySeconds,
    onTokensChanged: (listener) => {
      tokenListeners.add(listener);
      return () => tokenListeners.delete(listener);
    },
    httpService: {
      refreshAccessToken: jest.fn(async () => null),
      setAuthRefreshHandler: jest.fn(),
    },
  };
}

function makeSession(overrides: Partial<SessionLoginResponse> = {}): SessionLoginResponse {
  return {
    sessionId: 'sess-refresh',
    deviceId: 'dev-1',
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    user: { id: 'u1', username: 'tester' } as SessionLoginResponse['user'],
    accessToken: 'tok-refresh',
    ...overrides,
  };
}

beforeEach(() => {
  mockedAutoDetect.mockReturnValue('https://auth.example.test');
});

describe('createWebAuthRefreshHandler', () => {
  it('mints via the per-apex silent iframe and commits the session (tagged "credentials")', async () => {
    const fake = buildFakeOxyServices();
    fake.silentSignIn.mockResolvedValue(makeSession());
    fake.setTokens('tok-refresh');
    const commitSilentSession = jest.fn(async () => undefined);

    const handler = createWebAuthRefreshHandler({
      oxyServices: fake as unknown as OxyServices,
      commitSilentSession,
    });

    const token = await handler('preflight');

    expect(fake.silentSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ authWebUrlOverride: 'https://auth.example.test' }),
    );
    expect(commitSilentSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-refresh' }), 'credentials');
    expect(fake.silentSignInWithFedCM).not.toHaveBeenCalled();
    expect(token).toBe('tok-refresh');
  });

  it('falls through to FedCM silent when the iframe arm yields no session', async () => {
    const fake = buildFakeOxyServices();
    fake.silentSignIn.mockResolvedValue(null);
    fake.isFedCMSupported.mockReturnValue(true);
    fake.silentSignInWithFedCM.mockResolvedValue(makeSession({ accessToken: 'tok-fedcm' }));
    const commitSilentSession = jest.fn(async (session: SessionLoginResponse) => {
      fake.setTokens(session.accessToken ?? '');
    });

    const handler = createWebAuthRefreshHandler({
      oxyServices: fake as unknown as OxyServices,
      commitSilentSession,
    });

    const token = await handler('response-401');

    expect(commitSilentSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-refresh' }), 'fedcm');
    expect(token).toBe('tok-fedcm');
  });

  it('falls through to FedCM when the iframe arm THROWS (never lets one arm crash the chain)', async () => {
    const fake = buildFakeOxyServices();
    fake.silentSignIn.mockRejectedValue(new Error('iframe blocked'));
    fake.isFedCMSupported.mockReturnValue(true);
    fake.silentSignInWithFedCM.mockResolvedValue(makeSession({ accessToken: 'tok-fedcm' }));
    const commitSilentSession = jest.fn(async (session: SessionLoginResponse) => {
      fake.setTokens(session.accessToken ?? '');
    });

    const handler = createWebAuthRefreshHandler({
      oxyServices: fake as unknown as OxyServices,
      commitSilentSession,
    });

    const token = await handler('response-401');

    expect(token).toBe('tok-fedcm');
  });

  it('skips the silent-iframe arm entirely when autoDetectAuthWebUrl bails (e.g. localhost)', async () => {
    mockedAutoDetect.mockReturnValue(null);
    const fake = buildFakeOxyServices();
    fake.isFedCMSupported.mockReturnValue(true);
    fake.silentSignInWithFedCM.mockResolvedValue(makeSession({ accessToken: 'tok-fedcm' }));
    const commitSilentSession = jest.fn(async () => undefined);

    const handler = createWebAuthRefreshHandler({
      oxyServices: fake as unknown as OxyServices,
      commitSilentSession,
    });

    await handler('preflight');

    expect(fake.silentSignIn).not.toHaveBeenCalled();
    expect(fake.silentSignInWithFedCM).toHaveBeenCalled();
  });

  it('resolves to null when every arm is exhausted (never mints a session)', async () => {
    const fake = buildFakeOxyServices();
    fake.silentSignIn.mockResolvedValue(null);
    fake.isFedCMSupported.mockReturnValue(false);
    const commitSilentSession = jest.fn(async () => undefined);

    const handler = createWebAuthRefreshHandler({
      oxyServices: fake as unknown as OxyServices,
      commitSilentSession,
    });

    const token = await handler('response-401');

    expect(token).toBeNull();
    expect(commitSilentSession).not.toHaveBeenCalled();
  });
});

describe('startTokenRefreshScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not schedule anything when there is no access token', () => {
    const fake = buildFakeOxyServices();
    const handle = startTokenRefreshScheduler(fake as unknown as OxyServices);

    jest.advanceTimersByTime(10 * TOKEN_REFRESH_LEAD_MS);

    expect(fake.httpService.refreshAccessToken).not.toHaveBeenCalled();
    handle.dispose();
  });

  it('does not schedule when the token has no decodable expiry', () => {
    const fake = buildFakeOxyServices();
    fake.setTokens('opaque-token');
    fake.setExpirySeconds(null);
    const handle = startTokenRefreshScheduler(fake as unknown as OxyServices);

    jest.advanceTimersByTime(10 * TOKEN_REFRESH_LEAD_MS);

    expect(fake.httpService.refreshAccessToken).not.toHaveBeenCalled();
    handle.dispose();
  });

  it('fires refreshAccessToken("preflight") exactly at the lead time before expiry', () => {
    const fake = buildFakeOxyServices();
    fake.setTokens('tok-1');
    fake.setExpirySeconds(Math.floor(Date.now() / 1000) + 90);
    const handle = startTokenRefreshScheduler(fake as unknown as OxyServices);

    // 90s expiry - 60s lead = fires at +30s. One tick early: nothing yet.
    jest.advanceTimersByTime(30_000 - 1000);
    expect(fake.httpService.refreshAccessToken).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    expect(fake.httpService.refreshAccessToken).toHaveBeenCalledWith('preflight');
    handle.dispose();
  });

  it('reschedules from the new expiry after the token changes (onTokensChanged)', () => {
    const fake = buildFakeOxyServices();
    fake.setTokens('tok-1');
    fake.setExpirySeconds(Math.floor(Date.now() / 1000) + 90);
    const handle = startTokenRefreshScheduler(fake as unknown as OxyServices);

    // A sign-in / silent re-mint rotates the token to a fresh, longer-lived one.
    fake.setExpirySeconds(Math.floor(Date.now() / 1000) + 900);
    fake.setTokens('tok-2');

    // The ORIGINAL 30s-out timer must have been cleared — advancing past it
    // must NOT fire on the stale schedule.
    jest.advanceTimersByTime(31_000);
    expect(fake.httpService.refreshAccessToken).not.toHaveBeenCalled();

    handle.dispose();
  });

  it('dispose() tears down the timer — no refresh fires after disposal', () => {
    const fake = buildFakeOxyServices();
    fake.setTokens('tok-1');
    fake.setExpirySeconds(Math.floor(Date.now() / 1000) + 90);
    const handle = startTokenRefreshScheduler(fake as unknown as OxyServices);

    handle.dispose();
    jest.advanceTimersByTime(10 * TOKEN_REFRESH_LEAD_MS);

    expect(fake.httpService.refreshAccessToken).not.toHaveBeenCalled();
  });
});
