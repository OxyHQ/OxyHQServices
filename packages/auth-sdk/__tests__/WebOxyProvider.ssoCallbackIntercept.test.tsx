/**
 * @jest-environment-options {"url": "https://mention.earth/__oxy/sso-callback#oxy_sso=none&state=s"}
 *
 * EAGER, universal SSO-callback interception (`WebOxyProvider`).
 *
 * The provider mounts ON the internal callback path (`/__oxy/sso-callback`) with
 * the IdP result in the URL fragment — exactly what the browser delivers after a
 * top-level bounce to `auth.oxy.so/sso`. NO app declares this route, so without
 * eager interception the app's router would flash its +not-found screen.
 *
 * The eager once-on-mount effect runs the SAME `runSsoReturn` kernel the instant
 * we land on the callback path — BEFORE the init effect's cold boot — so it
 * strips the `#oxy_sso` fragment, consumes the real pre-bounce destination, and
 * on a `none` outcome sets the per-origin loop-breaker flags. Non-ok outcomes
 * leave the internal callback route with a hard navigation in the browser; jsdom
 * does not perform that navigation, so this test asserts the synchronous
 * side-effects instead. No terminal bounce fires while we are resolving a return
 * on the callback path.
 *
 * This mirrors `WebOxyProvider.coldBoot.test.tsx`: `@oxyhq/core` is mocked so the
 * REAL cold-boot + SSO helpers run against stubbed service/auth surfaces. jsdom
 * navigates legitimately via `history.replaceState` (how the fragment-strip +
 * dest-restore work); the only navigation it refuses is `window.location.assign`
 * (the terminal bounce), which is observed via `generateSsoState` instead.
 */

import { render, waitFor } from '@testing-library/react';
import type { SessionLoginResponse, User } from '@oxyhq/core';

interface CoreStubs {
  getCurrentUser: jest.Mock<Promise<User | null>, []>;
  handleRedirectCallback: jest.Mock<SessionLoginResponse | null, []>;
  exchangeSsoCode: jest.Mock<Promise<SessionLoginResponse>, [string]>;
  generateSsoState: jest.Mock<string, []>;
  baseURL: string;
}

const stubs: CoreStubs = {
  getCurrentUser: jest.fn(async () => null),
  handleRedirectCallback: jest.fn(() => null),
  exchangeSsoCode: jest.fn(async () => ({}) as SessionLoginResponse),
  generateSsoState: jest.fn(() => 'state-fixed'),
  baseURL: 'https://api.oxy.so',
};

function resetStubs(baseURL: string): void {
  stubs.getCurrentUser = jest.fn(async () => null);
  stubs.handleRedirectCallback = jest.fn(() => null);
  stubs.exchangeSsoCode = jest.fn(async () => ({}) as SessionLoginResponse);
  stubs.generateSsoState = jest.fn(() => 'state-fixed');
  stubs.baseURL = baseURL;
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
    isCentralIdPOrigin: actual.isCentralIdPOrigin,
    guardActive: actual.guardActive,
    buildSsoBounceUrl: actual.buildSsoBounceUrl,
    logger: actual.logger,
    // Session-sync integration layer (Fase 4 wiring, additive + inert this
    // task): the REAL factory + pure projection helpers. `createSessionClient`
    // is never invoked with a live backend in these tests — it is only
    // constructed (never `.start()`ed), so wiring it through as the real
    // implementation is side-effect-free here.
    createSessionClient: actual.createSessionClient,
    deviceStateToClientSessions: actual.deviceStateToClientSessions,
    activeSessionIdOf: actual.activeSessionIdOf,
    activeUserOf: actual.activeUserOf,
    accountIdsOf: actual.accountIdsOf,
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
      // The REAL `createSessionClient` factory is wired through in this
      // suite (see above) — its `SessionClientHost.makeRequest` reaches this.
      // A rejected promise (not a real backend) is caught by
      // `handleAuthSuccess`'s best-effort registration try/catch.
      makeRequest(): Promise<never> {
        return Promise.reject(new Error('not implemented in test'));
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
import {
  ssoStateKey,
  ssoDestKey,
  ssoNoSessionKey,
  ssoAttemptedKey,
  SSO_CALLBACK_PATH,
} from '@oxyhq/core';

const ORIGIN = 'https://mention.earth';
const DEST_PATH = '/explore';

interface ProbeState {
  isAuthenticated: boolean;
  userId: string | null;
  isLoading: boolean;
}

function Probe({ onState }: { onState: (s: ProbeState) => void }) {
  const { isAuthenticated, user, isLoading } = useAuth();
  onState({ isAuthenticated, userId: user?.id ?? null, isLoading });
  return null;
}

function renderProvider(baseURL: string, onState: (s: ProbeState) => void) {
  return render(
    <WebOxyProvider baseURL={baseURL}>
      <Probe onState={onState} />
    </WebOxyProvider>
  );
}

/** `generateSsoState` is minted exactly once per terminal bounce, nowhere else. */
function bounced(): boolean {
  return stubs.generateSsoState.mock.calls.length > 0;
}

function setLocation(href: string): void {
  window.history.replaceState(null, '', new URL(href, ORIGIN).href);
}

describe('WebOxyProvider eager SSO callback interception', () => {
  let popStateSpy: jest.Mock;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    setLocation(`${ORIGIN}${SSO_CALLBACK_PATH}#oxy_sso=none&state=s`);
    popStateSpy = jest.fn();
    window.addEventListener('popstate', popStateSpy);
  });

  afterEach(() => {
    window.removeEventListener('popstate', popStateSpy);
  });

  it('none: eagerly consumes callback, strips fragment, sets loop-breakers, no bounce', async () => {
    resetStubs('https://api.intercept-none');
    window.sessionStorage.setItem(ssoStateKey(ORIGIN), 's');
    window.sessionStorage.setItem(ssoDestKey(ORIGIN), `${ORIGIN}${DEST_PATH}`);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(window.sessionStorage.getItem(ssoNoSessionKey(ORIGIN))).toBe('1'));

    // No `window.location.assign` bounce fired (observed via generateSsoState).
    expect(bounced()).toBe(false);
    // Fragment stripped; CSRF state + dest consumed.
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem(ssoStateKey(ORIGIN))).toBeNull();
    expect(window.sessionStorage.getItem(ssoDestKey(ORIGIN))).toBeNull();
    // `none` sets BOTH per-origin loop breakers.
    expect(window.sessionStorage.getItem(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(window.sessionStorage.getItem(ssoAttemptedKey(ORIGIN))).toBe('1');
    // No exchange, no session committed. Popstate is only for ok soft restores;
    // non-ok outcomes leave through hard navigation in real browsers.
    expect(stubs.exchangeSsoCode).not.toHaveBeenCalled();
    expect(latest.isAuthenticated).toBe(false);
    expect(popStateSpy).not.toHaveBeenCalled();

    // Settle trailing microtasks; still no bounce.
    await new Promise((r) => setTimeout(r, 0));
    expect(bounced()).toBe(false);
  });

  it('ok: eagerly shares callback exchange but commits the SSO session only once', async () => {
    resetStubs('https://api.intercept-ok');
    window.sessionStorage.setItem(ssoStateKey(ORIGIN), 's');
    window.sessionStorage.setItem(ssoDestKey(ORIGIN), `${ORIGIN}${DEST_PATH}`);
    setLocation(`${ORIGIN}${SSO_CALLBACK_PATH}#oxy_sso=ok&code=code-1&state=s`);

    const user = { id: 'user-1', username: 'u1', name: { displayName: 'User One' } } as User;
    stubs.exchangeSsoCode = jest.fn(async () => ({
      user,
      sessionId: 'session-1',
      token: 'token-1',
    }) as SessionLoginResponse);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (state) => { latest = state; });

    await waitFor(() => expect(latest.userId).toBe('user-1'));

    // Exchanged exactly once despite the eager interceptor and the cold-boot
    // `sso-return` step both racing to consume the same callback.
    expect(stubs.exchangeSsoCode).toHaveBeenCalledTimes(1);
    expect(latest.isAuthenticated).toBe(true);
  });

});
