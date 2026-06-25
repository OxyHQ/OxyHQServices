/**
 * @jest-environment-options {"url": "https://app.mention.earth/__oxy/sso-callback#oxy_sso=none&state=s"}
 *
 * EAGER, universal SSO-callback interception (services `OxyContext`).
 *
 * The provider mounts ON the internal callback path (`/__oxy/sso-callback`) with
 * the IdP result in the URL fragment — exactly what the browser delivers after a
 * top-level bounce to `auth.oxy.so/sso`. NO app declares this route, so without
 * eager interception the app's router would flash its +not-found screen.
 *
 * The eager once-on-mount effect runs the SAME `runSsoReturn` kernel the instant
 * we land on the callback path — BEFORE the storage-gated cold boot — so it:
 *   - strips the `#oxy_sso` fragment from the URL,
 *   - restores the real pre-bounce destination (stored under the per-origin DEST
 *     key) so the URL leaves `/__oxy/sso-callback`,
 *   - dispatches a synthetic `popstate` so URL-driven routers re-sync,
 *   - on a `none` outcome sets the per-origin NO_SESSION + attempted loop-breaker
 *     flags and NEVER triggers a terminal bounce (`ssoNavigate`),
 *   - on an `ok` outcome exchanges the opaque code and commits the session AND
 *     restores the destination.
 *
 * These are proven with NO per-app callback route — the SDK handles it entirely.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';
import {
  ssoStateKey,
  ssoDestKey,
  ssoNoSessionKey,
  ssoAttemptedKey,
} from '@oxyhq/core';

const ORIGIN = 'https://app.mention.earth';
const CALLBACK_PATH = '/__oxy/sso-callback';
const DEST_PATH = '/explore';
const EXCHANGED_USER_ID = 'sso_user_1';

const exchangedSession: SessionLoginResponse = {
  sessionId: 'sess_sso',
  deviceId: '',
  accessToken: 'sso.access.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: EXCHANGED_USER_ID, username: 'ssouser' },
} as SessionLoginResponse;

interface CapturedState {
  isAuthenticated: boolean;
  userId: string | undefined;
}

let captured: CapturedState = { isAuthenticated: false, userId: undefined };

function Capture() {
  const { isAuthenticated, user } = useOxy();
  captured = { isAuthenticated, userId: user?.id };
  return null;
}

interface StubConfig {
  baseURL: string;
  exchangeImpl?: () => Promise<SessionLoginResponse | null>;
}

function buildStub(cfg: StubConfig) {
  const exchangeSsoCode = jest.fn(cfg.exchangeImpl ?? (async () => exchangedSession));
  return {
    exchangeSsoCode,
    stub: {
      config: { authWebUrl: 'https://auth.oxy.so' },
      httpService: { setTokens: jest.fn() },
      getBaseURL: () => cfg.baseURL,
      getSessionBaseUrl: () => cfg.baseURL,
      getAccessToken: () => null,
      onTokensChanged: () => () => undefined,
      setTokens: jest.fn(),
      clearTokens: jest.fn(),
      clearCache: jest.fn(),
      isFedCMSupported: jest.fn(() => false),
      handleAuthCallback: jest.fn(() => null),
      silentSignInWithFedCM: jest.fn(async () => null),
      refreshAllSessions: jest.fn(async () => ({ accounts: [] as unknown[] })),
      generateSsoState: jest.fn(() => 'fresh-state'),
      exchangeSsoCode,
      getCurrentUser: jest.fn(
        async (): Promise<User> => ({ id: EXCHANGED_USER_ID, username: 'ssouser' } as User),
      ),
      validateSession: jest.fn(async () => ({ valid: true, user: { id: EXCHANGED_USER_ID } })),
      setActingAs: jest.fn(),
      getManagedAccounts: jest.fn(async () => []),
    },
  };
}

function renderProvider(oxyServices: unknown, baseURL: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OxyContextProvider oxyServices={oxyServices as never} baseURL={baseURL}>
        <Capture />
      </OxyContextProvider>
    </QueryClientProvider>,
  );
}

function setLocation(href: string): void {
  window.history.replaceState(null, '', new URL(href, ORIGIN).href);
}

describe('Eager SSO callback interception (services OxyContext)', () => {
  let assignSpy: jest.SpyInstance;
  let popStateSpy: jest.Mock;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    captured = { isAuthenticated: false, userId: undefined };
    useAuthStore.getState().logout();
    // Land on the internal callback path with the IdP fragment — exactly what
    // the @jest-environment-options url seeds, restored here between tests.
    setLocation(`${ORIGIN}${CALLBACK_PATH}#oxy_sso=none&state=s`);
    // The terminal bounce seam — must NEVER fire on the callback path.
    assignSpy = jest.spyOn(oxyCore, 'ssoNavigate').mockImplementation(() => undefined);
    // A router re-sync signal: the dest restore dispatches a real `popstate`.
    popStateSpy = jest.fn();
    window.addEventListener('popstate', popStateSpy);
  });

  afterEach(() => {
    window.removeEventListener('popstate', popStateSpy);
    assignSpy.mockRestore();
  });

  it('none: eagerly consumes callback, strips fragment, sets loop-breakers, never bounces', async () => {
    const { stub, exchangeSsoCode } = buildStub({ baseURL: 'https://api.mention.earth/intercept-none' });
    window.sessionStorage.setItem(ssoStateKey(ORIGIN), 's');
    window.sessionStorage.setItem(ssoDestKey(ORIGIN), `${ORIGIN}${DEST_PATH}`);

    renderProvider(stub, 'https://api.mention.earth/intercept-none');

    // The eager interception consumes the SSO return immediately. Non-ok
    // callback-path navigation is a hard redirect owned by the core kernel and
    // covered in core tests; JSDOM does not perform that navigation.
    await waitFor(() => expect(window.sessionStorage.getItem(ssoNoSessionKey(ORIGIN))).toBe('1'));

    // Fragment stripped; CSRF state + dest consumed.
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem(ssoStateKey(ORIGIN))).toBeNull();
    expect(window.sessionStorage.getItem(ssoDestKey(ORIGIN))).toBeNull();

    // `none` sets BOTH per-origin loop breakers.
    expect(window.sessionStorage.getItem(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(window.sessionStorage.getItem(ssoAttemptedKey(ORIGIN))).toBe('1');

    // No exchange (none), no terminal bounce. Popstate is only for ok soft
    // restores; non-ok outcomes leave the callback path via hard redirect.
    expect(exchangeSsoCode).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
    expect(popStateSpy).not.toHaveBeenCalled();

    // Settle any trailing microtasks (cold boot is a no-op once stripped).
    await new Promise((r) => setTimeout(r, 0));
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('ok: eagerly exchanges the code, commits the session, restores dest, dispatches popstate, never bounces', async () => {
    setLocation(`${ORIGIN}${CALLBACK_PATH}#oxy_sso=ok&code=opaque-code-123&state=s`);
    const { stub, exchangeSsoCode } = buildStub({ baseURL: 'https://api.mention.earth/intercept-ok' });
    window.sessionStorage.setItem(ssoStateKey(ORIGIN), 's');
    window.sessionStorage.setItem(ssoDestKey(ORIGIN), `${ORIGIN}${DEST_PATH}?tab=home`);

    renderProvider(stub, 'https://api.mention.earth/intercept-ok');

    // The exchanged session is committed by the eager interception.
    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(EXCHANGED_USER_ID);
    expect(exchangeSsoCode).toHaveBeenCalledWith('opaque-code-123', 'expected-state');

    // Destination restored off the callback path; fragment stripped; no bounce.
    expect(window.location.pathname).toBe(DEST_PATH);
    expect(window.location.search).toBe('?tab=home');
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem(ssoStateKey(ORIGIN))).toBeNull();
    expect(window.sessionStorage.getItem(ssoDestKey(ORIGIN))).toBeNull();
    expect(window.sessionStorage.getItem(ssoNoSessionKey(ORIGIN))).toBeNull();
    expect(assignSpy).not.toHaveBeenCalled();
    expect(popStateSpy).toHaveBeenCalled();
  });
});
