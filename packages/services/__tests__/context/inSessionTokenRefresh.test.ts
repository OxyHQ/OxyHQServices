/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * In-session access-token refresh (handler arms + proactive scheduler).
 *
 * THE GAP: the services path never installed an `authRefreshHandler`, so the
 * owner `HttpService.refreshAccessToken` short-circuited to null and a 15-minute
 * token expired with the app open while `isAuthenticated` stayed true — a zombie
 * logged-in state whose cross-apex feed calls 401-looped.
 *
 * These pin the two cooperating pieces wired from OxyContext:
 *   - the handler re-mints a fresh token from the durable silent-restore arms
 *     (web: per-apex iframe → FedCM → refresh-cookie; native: shared-key), first
 *     to yield a token wins; all-fail → null (so the session reconciles);
 *   - the scheduler fires a preflight refresh ~lead before expiry, no-ops with no
 *     token, and tears down cleanly.
 *
 * The jsdom URL (`app.mention.earth`) makes `autoDetectAuthWebUrl()` resolve the
 * per-apex IdP (`auth.mention.earth`) so the web iframe arm has a target.
 */

// Force / toggle the platform branch: the module reads `isWebBrowser()` at call
// time, so flipping `mockIsWebBrowser` between tests switches web ↔ native. The
// name is `mock`-prefixed so the jest.mock factory may close over it.
let mockIsWebBrowser = true;
jest.mock('../../src/ui/hooks/useWebSSO', () => ({
  __esModule: true,
  isWebBrowser: () => mockIsWebBrowser,
  useWebSSO: () => ({
    checkSSO: async () => null,
    signInWithFedCM: async () => null,
    isChecking: false,
    isFedCMSupported: false,
  }),
}));

import type { OxyServices } from '@oxyhq/core';
import {
  createInSessionRefreshHandler,
  startTokenRefreshScheduler,
  TOKEN_REFRESH_LEAD_MS,
} from '../../src/ui/context/inSessionTokenRefresh';

const ACTIVE_AUTHUSER_KEY = 'oxy_active_authuser';
const FRESH_TOKEN = 'FRESH_ACCESS_TOKEN';

interface RefreshAllAccountStub {
  authuser: number;
  accessToken: string;
  expiresAt: string;
  sessionId: string;
  user: { id: string; username: string; avatar: null; color: null };
}

interface StubShape {
  getAccessToken: jest.Mock<string | null, []>;
  getAccessTokenExpiry: jest.Mock<number | null, []>;
  onTokensChanged: jest.Mock;
  isFedCMSupported: jest.Mock<boolean, []>;
  silentSignIn: jest.Mock;
  silentSignInWithFedCM: jest.Mock;
  refreshAllSessions: jest.Mock;
  signInWithSharedIdentity: jest.Mock;
  httpService: {
    setTokens: jest.Mock;
    setAuthRefreshHandler: jest.Mock;
    refreshAccessToken: jest.Mock;
  };
}

function buildStub(overrides: Partial<StubShape> = {}): StubShape {
  return {
    getAccessToken: jest.fn(() => FRESH_TOKEN),
    getAccessTokenExpiry: jest.fn(() => Math.floor(Date.now() / 1000) + 3600),
    onTokensChanged: jest.fn(() => () => undefined),
    isFedCMSupported: jest.fn(() => false),
    silentSignIn: jest.fn(async () => null),
    silentSignInWithFedCM: jest.fn(async () => null),
    refreshAllSessions: jest.fn(async () => ({ accounts: [] as RefreshAllAccountStub[] })),
    signInWithSharedIdentity: jest.fn(async () => null),
    httpService: {
      setTokens: jest.fn(),
      setAuthRefreshHandler: jest.fn(),
      refreshAccessToken: jest.fn(async () => FRESH_TOKEN),
    },
    ...overrides,
  };
}

const asOxy = (stub: StubShape): OxyServices => stub as unknown as OxyServices;

const sessionResult = { sessionId: 's1', user: { id: 'u1' }, accessToken: FRESH_TOKEN };

function account(authuser: number, accessToken: string): RefreshAllAccountStub {
  return {
    authuser,
    accessToken,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    sessionId: `sess_${authuser}`,
    user: { id: `user_${authuser}`, username: `u${authuser}`, avatar: null, color: null },
  };
}

beforeEach(() => {
  mockIsWebBrowser = true;
  window.localStorage.clear();
});

describe('createInSessionRefreshHandler — web arms', () => {
  it('arm 1: the per-apex silent iframe wins and returns the freshly planted token; later arms are not tried', async () => {
    const stub = buildStub({ silentSignIn: jest.fn(async () => sessionResult) });
    const handler = createInSessionRefreshHandler(asOxy(stub));

    const token = await handler('response-401');

    expect(token).toBe(FRESH_TOKEN);
    expect(stub.silentSignIn).toHaveBeenCalledTimes(1);
    // Pointed at the PER-APEX IdP derived from the page apex, not the central host.
    expect(stub.silentSignIn.mock.calls[0][0]).toMatchObject({
      authWebUrlOverride: 'https://auth.mention.earth',
    });
    expect(stub.silentSignInWithFedCM).not.toHaveBeenCalled();
    expect(stub.refreshAllSessions).not.toHaveBeenCalled();
  });

  it('arm 2: falls through to FedCM silent when the iframe finds nothing', async () => {
    const stub = buildStub({
      silentSignIn: jest.fn(async () => null),
      isFedCMSupported: jest.fn(() => true),
      silentSignInWithFedCM: jest.fn(async () => sessionResult),
    });
    const handler = createInSessionRefreshHandler(asOxy(stub));

    const token = await handler('preflight');

    expect(token).toBe(FRESH_TOKEN);
    expect(stub.silentSignIn).toHaveBeenCalledTimes(1);
    expect(stub.silentSignInWithFedCM).toHaveBeenCalledTimes(1);
    expect(stub.refreshAllSessions).not.toHaveBeenCalled();
  });

  it('arm 3: falls through to the same-apex refresh cookie and plants the active account token', async () => {
    window.localStorage.setItem(ACTIVE_AUTHUSER_KEY, '1');
    const stub = buildStub({
      refreshAllSessions: jest.fn(async () => ({
        accounts: [account(0, 'TOKEN_0'), account(1, 'TOKEN_1')],
      })),
    });
    const handler = createInSessionRefreshHandler(asOxy(stub));

    const token = await handler('response-401');

    expect(token).toBe(FRESH_TOKEN);
    // The PERSISTED authuser (slot 1) token is planted, not slot 0.
    expect(stub.httpService.setTokens).toHaveBeenCalledWith('TOKEN_1');
  });

  it('returns null when every web arm fails (so the dead session reconciles)', async () => {
    const stub = buildStub();
    const handler = createInSessionRefreshHandler(asOxy(stub));

    const token = await handler('response-401');

    expect(token).toBeNull();
    expect(stub.silentSignIn).toHaveBeenCalledTimes(1);
    expect(stub.refreshAllSessions).toHaveBeenCalledTimes(1);
    expect(stub.httpService.setTokens).not.toHaveBeenCalled();
  });

  it('continues to later arms when an arm throws (does not abort the chain)', async () => {
    const stub = buildStub({
      silentSignIn: jest.fn(async () => {
        throw new Error('iframe blocked');
      }),
      refreshAllSessions: jest.fn(async () => ({ accounts: [account(0, 'TOKEN_0')] })),
    });
    const handler = createInSessionRefreshHandler(asOxy(stub));

    const token = await handler('preflight');

    expect(token).toBe(FRESH_TOKEN);
    expect(stub.httpService.setTokens).toHaveBeenCalledWith('TOKEN_0');
  });
});

describe('createInSessionRefreshHandler — native arm', () => {
  beforeEach(() => {
    mockIsWebBrowser = false;
  });

  it('re-mints via the shared cross-app identity key and never touches the web iframe', async () => {
    const stub = buildStub({ signInWithSharedIdentity: jest.fn(async () => sessionResult) });
    const handler = createInSessionRefreshHandler(asOxy(stub));

    const token = await handler('response-401');

    expect(token).toBe(FRESH_TOKEN);
    expect(stub.signInWithSharedIdentity).toHaveBeenCalledTimes(1);
    expect(stub.silentSignIn).not.toHaveBeenCalled();
    expect(stub.silentSignInWithFedCM).not.toHaveBeenCalled();
    expect(stub.refreshAllSessions).not.toHaveBeenCalled();
  });

  it('returns null when the device holds no shared identity', async () => {
    const stub = buildStub({ signInWithSharedIdentity: jest.fn(async () => null) });
    const handler = createInSessionRefreshHandler(asOxy(stub));

    const token = await handler('response-401');

    expect(token).toBeNull();
    expect(stub.silentSignIn).not.toHaveBeenCalled();
  });
});

describe('startTokenRefreshScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('fires a preflight refresh one lead-window before expiry, then reschedules', async () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 120;
    const stub = buildStub({ getAccessTokenExpiry: jest.fn(() => expSeconds) });

    const handle = startTokenRefreshScheduler(asOxy(stub));

    // Just before the scheduled fire time nothing has happened yet.
    jest.advanceTimersByTime(120_000 - TOKEN_REFRESH_LEAD_MS - 1000);
    expect(stub.httpService.refreshAccessToken).not.toHaveBeenCalled();

    // Crossing the lead boundary fires exactly one preflight refresh.
    jest.advanceTimersByTime(1000);
    expect(stub.httpService.refreshAccessToken).toHaveBeenCalledWith('preflight');
    expect(stub.httpService.refreshAccessToken).toHaveBeenCalledTimes(1);

    handle.dispose();
  });

  it('no-ops when there is no access token', () => {
    const stub = buildStub({ getAccessToken: jest.fn(() => null) });

    const handle = startTokenRefreshScheduler(asOxy(stub));
    jest.advanceTimersByTime(60 * 60_000);

    expect(stub.httpService.refreshAccessToken).not.toHaveBeenCalled();
    handle.dispose();
  });

  it('no-ops for an opaque token with no decodable expiry', () => {
    const stub = buildStub({ getAccessTokenExpiry: jest.fn(() => null) });

    const handle = startTokenRefreshScheduler(asOxy(stub));
    jest.advanceTimersByTime(60 * 60_000);

    expect(stub.httpService.refreshAccessToken).not.toHaveBeenCalled();
    handle.dispose();
  });

  it('dispose() cancels the pending timer and unsubscribes from token changes', () => {
    const unsubscribe = jest.fn();
    const expSeconds = Math.floor(Date.now() / 1000) + 120;
    const stub = buildStub({
      getAccessTokenExpiry: jest.fn(() => expSeconds),
      onTokensChanged: jest.fn(() => unsubscribe),
    });

    const handle = startTokenRefreshScheduler(asOxy(stub));
    handle.dispose();

    jest.advanceTimersByTime(120_000);
    expect(stub.httpService.refreshAccessToken).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('refreshes immediately on tab-foreground when already inside the lead window', () => {
    // Token already within the lead window → a foreground event refreshes now.
    const expSeconds = Math.floor(Date.now() / 1000) + 30;
    const stub = buildStub({ getAccessTokenExpiry: jest.fn(() => expSeconds) });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    const handle = startTokenRefreshScheduler(asOxy(stub));
    stub.httpService.refreshAccessToken.mockClear();

    document.dispatchEvent(new Event('visibilitychange'));

    expect(stub.httpService.refreshAccessToken).toHaveBeenCalledWith('preflight');
    handle.dispose();
  });
});
