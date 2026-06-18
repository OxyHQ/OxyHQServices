/**
 * @jest-environment-options {"url": "https://app.mention.earth/__oxy/sso-callback"}
 *
 * Central cross-domain SSO — `sso-return` exchange + loop prevention.
 *
 * The provider lands on the RP callback path with the IdP result in the URL
 * fragment. The `sso-return` cold-boot step:
 *   - on `#oxy_sso=ok&code=…&state=…` (state matching) exchanges the opaque code
 *     via `exchangeSsoCode` and commits the session;
 *   - on `#oxy_sso=none` / `#oxy_sso=error` sets the per-origin NO_SESSION flag
 *     and skips — and the terminal `sso-bounce` is then DISABLED (loop proof);
 *   - on a state MISMATCH (forged/replayed fragment) refuses the exchange, sets
 *     NO_SESSION, and skips.
 *
 * Each case seeds the URL fragment + matching sessionStorage state before
 * render. `window.location.assign` is stubbed so a terminal bounce (if it were
 * to fire) is observable rather than crashing jsdom.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';

const ORIGIN = 'https://app.mention.earth';
const EXCHANGED_USER_ID = 'sso_user_1';

const STATE_KEY = `oxy_sso_state:${ORIGIN}`;
const GUARD_KEY = `oxy_sso_guard:${ORIGIN}`;
const DEST_KEY = `oxy_sso_dest:${ORIGIN}`;
const NO_SESSION_KEY = `oxy_sso_no_session:${ORIGIN}`;

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
  isTokenReady: boolean;
}

let captured: CapturedState = { isAuthenticated: false, userId: undefined, isTokenReady: false };

function Capture() {
  const { isAuthenticated, user, isTokenReady } = useOxy();
  captured = { isAuthenticated, userId: user?.id, isTokenReady };
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

function setHash(hash: string) {
  window.location.hash = hash;
}

describe('Central SSO return (sso-return step)', () => {
  let assignSpy: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    captured = { isAuthenticated: false, userId: undefined, isTokenReady: false };
    useAuthStore.getState().logout();
    // Reset the URL to the callback path with no fragment.
    window.history.replaceState(null, '', '/__oxy/sso-callback');
    // Spy the navigation seam so a terminal bounce (if one fired) is observable
    // and never tears down jsdom.
    assignSpy = jest.spyOn(oxyCore, 'ssoNavigate').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setHash('');
    assignSpy.mockRestore();
  });

  it('ok + matching state → exchanges code, commits, strips fragment, restores dest, no bounce', async () => {
    const { stub, exchangeSsoCode } = buildStub({ baseURL: 'https://api.mention.earth/case-ok' });
    window.sessionStorage.setItem(STATE_KEY, 'expected-state');
    window.sessionStorage.setItem(DEST_KEY, 'https://app.mention.earth/feed?tab=home');
    setHash('#oxy_sso=ok&code=opaque-code-123&state=expected-state');

    renderProvider(stub, 'https://api.mention.earth/case-ok');

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(EXCHANGED_USER_ID);
    expect(exchangeSsoCode).toHaveBeenCalledWith('opaque-code-123');

    // Fragment stripped; CSRF state + dest consumed; no NO_SESSION; no bounce.
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem(STATE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(DEST_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(NO_SESSION_KEY)).toBeNull();
    expect(assignSpy).not.toHaveBeenCalled();

    // Destination restored (same-origin) off the callback path.
    expect(window.location.pathname).toBe('/feed');
    expect(window.location.search).toBe('?tab=home');
  });

  it('none → sets NO_SESSION, never exchanges, and the bounce is DISABLED (loop proof)', async () => {
    const { stub, exchangeSsoCode } = buildStub({ baseURL: 'https://api.mention.earth/case-none' });
    window.sessionStorage.setItem(STATE_KEY, 'expected-state');
    setHash('#oxy_sso=none&state=expected-state');

    renderProvider(stub, 'https://api.mention.earth/case-none');

    // Wait on the deterministic post-cold-boot signal: NO_SESSION set.
    await waitFor(() => expect(window.sessionStorage.getItem(NO_SESSION_KEY)).toBe('1'));

    expect(captured.isAuthenticated).toBe(false);
    expect(exchangeSsoCode).not.toHaveBeenCalled();
    // NO_SESSION set → terminal bounce disabled → no navigation → no loop.
    expect(assignSpy).not.toHaveBeenCalled();
    // Fragment stripped + CSRF state cleared.
    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem(STATE_KEY)).toBeNull();
  });

  it('error → sets NO_SESSION, never exchanges, bounce disabled', async () => {
    const { stub, exchangeSsoCode } = buildStub({ baseURL: 'https://api.mention.earth/case-error' });
    window.sessionStorage.setItem(STATE_KEY, 'expected-state');
    setHash('#oxy_sso=error&state=expected-state');

    renderProvider(stub, 'https://api.mention.earth/case-error');

    await waitFor(() => expect(window.sessionStorage.getItem(NO_SESSION_KEY)).toBe('1'));

    expect(captured.isAuthenticated).toBe(false);
    expect(exchangeSsoCode).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('state mismatch (forged fragment) → refuses exchange, sets NO_SESSION, bounce disabled', async () => {
    const { stub, exchangeSsoCode } = buildStub({
      baseURL: 'https://api.mention.earth/case-mismatch',
    });
    window.sessionStorage.setItem(STATE_KEY, 'expected-state');
    // Attacker-supplied fragment with a different state and a stolen code.
    setHash('#oxy_sso=ok&code=stolen-code&state=attacker-state');

    renderProvider(stub, 'https://api.mention.earth/case-mismatch');

    await waitFor(() => expect(window.sessionStorage.getItem(NO_SESSION_KEY)).toBe('1'));

    expect(captured.isAuthenticated).toBe(false);
    expect(exchangeSsoCode).not.toHaveBeenCalled();
    expect(assignSpy).not.toHaveBeenCalled();
    // The forged fragment is still stripped from the URL.
    expect(window.location.hash).toBe('');
  });

  it('a failed exchange (network/forged code) → sets NO_SESSION, stays signed-out, no loop', async () => {
    const { stub, exchangeSsoCode } = buildStub({
      baseURL: 'https://api.mention.earth/case-exchange-fail',
      exchangeImpl: async () => {
        throw new Error('exchange rejected');
      },
    });
    window.sessionStorage.setItem(STATE_KEY, 'expected-state');
    setHash('#oxy_sso=ok&code=opaque-code-123&state=expected-state');

    renderProvider(stub, 'https://api.mention.earth/case-exchange-fail');

    await waitFor(() => expect(window.sessionStorage.getItem(NO_SESSION_KEY)).toBe('1'));

    expect(exchangeSsoCode).toHaveBeenCalledWith('opaque-code-123');
    expect(captured.isAuthenticated).toBe(false);
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
