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
 * strips the `#oxy_sso` fragment, restores the real pre-bounce destination
 * (off the callback path), dispatches a synthetic `popstate` for URL-driven
 * routers, and on a `none` outcome sets the per-origin loop-breaker flags. No
 * terminal bounce fires while we are resolving a return on the callback path.
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
  isFedCMSupported: jest.Mock<boolean, []>;
  silentSignInWithFedCM: jest.Mock<Promise<SessionLoginResponse | null>, []>;
  exchangeSsoCode: jest.Mock<Promise<SessionLoginResponse>, [string]>;
  generateSsoState: jest.Mock<string, []>;
  managerInitialize: jest.Mock<Promise<User | null>, []>;
  getActiveAccount: jest.Mock<{ sessionId: string } | null, []>;
  baseURL: string;
}

const stubs: CoreStubs = {
  getCurrentUser: jest.fn(async () => null),
  handleRedirectCallback: jest.fn(() => null),
  isFedCMSupported: jest.fn(() => false),
  silentSignInWithFedCM: jest.fn(async () => null),
  exchangeSsoCode: jest.fn(async () => ({}) as SessionLoginResponse),
  generateSsoState: jest.fn(() => 'state-fixed'),
  managerInitialize: jest.fn(async () => null),
  getActiveAccount: jest.fn(() => null),
  baseURL: 'https://api.oxy.so',
};

function resetStubs(baseURL: string): void {
  stubs.getCurrentUser = jest.fn(async () => null);
  stubs.handleRedirectCallback = jest.fn(() => null);
  stubs.isFedCMSupported = jest.fn(() => false);
  stubs.silentSignInWithFedCM = jest.fn(async () => null);
  stubs.exchangeSsoCode = jest.fn(async () => ({}) as SessionLoginResponse);
  stubs.generateSsoState = jest.fn(() => 'state-fixed');
  stubs.managerInitialize = jest.fn(async () => null);
  stubs.getActiveAccount = jest.fn(() => null);
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
    OxyServices: class {
      getBaseURL(): string {
        return stubs.baseURL;
      }
      getCurrentUser(): Promise<User | null> {
        return stubs.getCurrentUser();
      }
      isFedCMSupported(): boolean {
        return stubs.isFedCMSupported();
      }
      silentSignInWithFedCM(): Promise<SessionLoginResponse | null> {
        return stubs.silentSignInWithFedCM();
      }
      exchangeSsoCode(code: string): Promise<SessionLoginResponse> {
        return stubs.exchangeSsoCode(code);
      }
      generateSsoState(): string {
        return stubs.generateSsoState();
      }
    },
    CrossDomainAuth: class {
      handleRedirectCallback(): SessionLoginResponse | null {
        return stubs.handleRedirectCallback();
      }
    },
    AuthManager: class {},
    createAuthManager: () => ({
      initialize: () => stubs.managerInitialize(),
      getActiveAccount: () => stubs.getActiveAccount(),
      getAccounts: () => [],
      getActiveAuthuser: () => null,
      handleAuthSuccess: jest.fn(async () => undefined),
      restoreFromCookies: jest.fn(async () => undefined),
      signOutAllViaCookies: jest.fn(async () => undefined),
      destroy: jest.fn(),
    }),
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

  it('none: eagerly restores dest off the callback path, strips fragment, sets loop-breakers, dispatches popstate, no bounce', async () => {
    resetStubs('https://api.intercept-none');
    window.sessionStorage.setItem(ssoStateKey(ORIGIN), 's');
    window.sessionStorage.setItem(ssoDestKey(ORIGIN), `${ORIGIN}${DEST_PATH}`);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    // The eager interception restores the real destination off the callback path.
    await waitFor(() => expect(window.location.pathname).toBe(DEST_PATH));

    // No `window.location.assign` bounce fired (observed via generateSsoState).
    expect(bounced()).toBe(false);
    // Fragment stripped; CSRF state + dest consumed.
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem(ssoStateKey(ORIGIN))).toBeNull();
    expect(window.sessionStorage.getItem(ssoDestKey(ORIGIN))).toBeNull();
    // `none` sets BOTH per-origin loop breakers.
    expect(window.sessionStorage.getItem(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(window.sessionStorage.getItem(ssoAttemptedKey(ORIGIN))).toBe('1');
    // No exchange, no session committed, popstate dispatched for router re-sync.
    expect(stubs.exchangeSsoCode).not.toHaveBeenCalled();
    expect(latest.isAuthenticated).toBe(false);
    expect(popStateSpy).toHaveBeenCalled();

    // Settle trailing microtasks; still no bounce.
    await new Promise((r) => setTimeout(r, 0));
    expect(bounced()).toBe(false);
  });
});
