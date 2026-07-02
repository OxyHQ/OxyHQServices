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
    expect(token).toBe('tok-refresh');
  });

  it('resolves to null when the silent-iframe arm yields no session (there is NO FedCM fallback)', async () => {
    const fake = buildFakeOxyServices();
    fake.silentSignIn.mockResolvedValue(null);
    const commitSilentSession = jest.fn(async () => undefined);

    const handler = createWebAuthRefreshHandler({
      oxyServices: fake as unknown as OxyServices,
      commitSilentSession,
    });

    const token = await handler('response-401');

    // The silent-iframe arm is the ONLY arm — a null session exhausts the
    // chain. FedCM was removed from the client refresh path, so there is no
    // second arm to fall through to; the handler resolves to null and never
    // commits.
    expect(token).toBeNull();
    expect(commitSilentSession).not.toHaveBeenCalled();
  });

  it('contains a throw in the silent-iframe arm (never crashes the chain) and resolves to null', async () => {
    const fake = buildFakeOxyServices();
    fake.silentSignIn.mockRejectedValue(new Error('iframe blocked'));
    const commitSilentSession = jest.fn(async () => undefined);

    const handler = createWebAuthRefreshHandler({
      oxyServices: fake as unknown as OxyServices,
      commitSilentSession,
    });

    // A throw in the sole arm is caught + treated as a fall-through, never
    // propagated out of the handler; with no further arm the chain resolves
    // to null.
    const token = await handler('response-401');

    expect(token).toBeNull();
    expect(commitSilentSession).not.toHaveBeenCalled();
  });

  it('returns null without minting when autoDetectAuthWebUrl bails (e.g. localhost) — the iframe arm is skipped and there is no FedCM fallback', async () => {
    mockedAutoDetect.mockReturnValue(null);
    const fake = buildFakeOxyServices();
    const commitSilentSession = jest.fn(async () => undefined);

    const handler = createWebAuthRefreshHandler({
      oxyServices: fake as unknown as OxyServices,
      commitSilentSession,
    });

    const token = await handler('preflight');

    // No per-apex IdP to query → the iframe arm short-circuits without calling
    // `silentSignIn`, and there is no FedCM arm behind it, so the handler
    // resolves to null.
    expect(fake.silentSignIn).not.toHaveBeenCalled();
    expect(token).toBeNull();
    expect(commitSilentSession).not.toHaveBeenCalled();
  });

  it('resolves to null when every arm is exhausted (never mints a session)', async () => {
    const fake = buildFakeOxyServices();
    fake.silentSignIn.mockResolvedValue(null);
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
