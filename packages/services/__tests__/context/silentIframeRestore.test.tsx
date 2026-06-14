/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * Durable cross-domain reload restore via the PER-APEX silent iframe (web).
 *
 * THE BUG (R3): after the SDK signs in via the `/sso` opaque-code bounce, the
 * session did not survive a reload without re-bouncing — the only durable
 * refresh-cookie infra (`oxy_rt`, `Domain=oxy.so`) is THIRD-PARTY on
 * `mention.earth` (Safari ITP / Firefox TCP block it), so every reload
 * re-bounced (a flash; a loop in a backgrounded tab).
 *
 * THE FIX (Option A): `auth.<rp-apex>` (e.g. `auth.mention.earth`, same
 * registrable domain as the RP → FIRST-PARTY) carries its OWN host-only
 * `fedcm_session` cookie established during the `/sso` bounce. Reloads restore
 * via a FIRST-PARTY `/auth/silent` iframe pointed at that per-apex host — not a
 * top-level navigation, so it works in Safari/Firefox AND in a backgrounded
 * tab with NO flash. The new `silent-iframe` cold-boot step owns this path.
 *
 * The OxyServices instance is configured with the CENTRAL auth URL
 * (`auth.oxy.so`, for the bounce + FedCM), so the step explicitly points the
 * iframe at the per-apex host via `autoDetectAuthWebUrl()` →
 * `silentSignIn({ authWebUrlOverride })`.
 *
 * This file pins (web; the NATIVE attestation lives in
 * `silentIframeNativeSkip.test.tsx`):
 *   CASE 1: a per-apex silent iframe that returns a session restores it and the
 *     terminal `sso-bounce` does NOT fire (no re-bounce loop, no flash).
 *     `silentSignIn` is called with the PER-APEX override (`auth.mention.earth`),
 *     NOT the central `auth.oxy.so`.
 *   CASE 2: when the per-apex iframe finds nothing, the step skips and the
 *     terminal `sso-bounce` fires (first cross-domain entry).
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';

const API_BASE_URL = 'https://api.mention.earth';
const IFRAME_USER_ID = 'iframe_user_1';
const PER_APEX_AUTH_URL = 'https://auth.mention.earth';

const setTokensSpy = jest.fn();
const silentSignInSpy = jest.fn();

const iframeSession: SessionLoginResponse = {
  sessionId: 'sess_iframe',
  deviceId: 'dev_iframe',
  accessToken: 'iframe.access.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: IFRAME_USER_ID, username: 'iframeuser' },
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
  silentIframe?: SessionLoginResponse | null;
  currentUserId?: string;
  // The module-level silent guard is keyed on `origin|baseURL`; each test uses a
  // UNIQUE baseURL so its steps aren't pre-disabled by a prior test in the same
  // module scope.
  baseURL?: string;
}

function buildStub(cfg: StubConfig) {
  const baseURL = cfg.baseURL ?? API_BASE_URL;
  silentSignInSpy.mockImplementation(async () => cfg.silentIframe ?? null);
  return {
    baseURL,
    stub: {
      config: { authWebUrl: 'https://auth.oxy.so' },
      httpService: { setTokens: setTokensSpy },
      getBaseURL: () => baseURL,
      getSessionBaseUrl: () => baseURL,
      getAccessToken: () => null,
      onTokensChanged: () => () => undefined,
      setTokens: jest.fn(),
      clearTokens: jest.fn(),
      clearCache: jest.fn(),
      // FedCM unsupported so the `fedcm-silent` step skips and the
      // `silent-iframe` step is exercised next.
      isFedCMSupported: jest.fn(() => false),
      handleAuthCallback: jest.fn(() => null),
      silentSignInWithFedCM: jest.fn(async () => null),
      silentSignIn: silentSignInSpy,
      refreshAllSessions: jest.fn(async () => ({ accounts: [] as unknown[] })),
      generateSsoState: jest.fn(() => 'state-token-xyz'),
      exchangeSsoCode: jest.fn(async () => null),
      getTokenBySession: jest.fn(async () => 'unused.token'),
      getCurrentUser: jest.fn(
        async (): Promise<User> =>
          ({ id: cfg.currentUserId ?? IFRAME_USER_ID, username: 'tester' } as User),
      ),
      validateSession: jest.fn(async () => ({ valid: true, user: { id: IFRAME_USER_ID } })),
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

describe('Cold-boot per-apex silent iframe (durable cross-domain reload restore)', () => {
  let ssoNavigateSpy: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    captured = { isAuthenticated: false, userId: undefined };
    setTokensSpy.mockClear();
    silentSignInSpy.mockReset();
    useAuthStore.getState().logout();
    ssoNavigateSpy = jest.spyOn(oxyCore, 'ssoNavigate').mockImplementation(() => undefined);
  });

  afterEach(() => {
    ssoNavigateSpy.mockRestore();
  });

  it('restores via the PER-APEX silent iframe and the SSO bounce does NOT fire', async () => {
    const { stub, baseURL } = buildStub({
      silentIframe: iframeSession,
      currentUserId: IFRAME_USER_ID,
      baseURL: 'https://api.mention.earth/case-iframe-restore',
    });

    renderProvider(stub, baseURL);

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(IFRAME_USER_ID);

    // The iframe step ran and won.
    expect(silentSignInSpy).toHaveBeenCalledTimes(1);

    // CRITICAL: it targeted the PER-APEX host (`auth.mention.earth`), NOT the
    // central `auth.oxy.so` the instance is configured with.
    expect(silentSignInSpy).toHaveBeenCalledWith(
      expect.objectContaining({ authWebUrlOverride: PER_APEX_AUTH_URL }),
    );

    // The durable reload path won → the terminal central bounce NEVER fired,
    // so there is no flash and no re-bounce loop.
    expect(ssoNavigateSpy).not.toHaveBeenCalled();
  });

  it('when the per-apex iframe finds nothing the step skips → terminal SSO bounce fires once', async () => {
    const { stub, baseURL } = buildStub({
      silentIframe: null,
      baseURL: 'https://api.mention.earth/case-iframe-empty',
    });

    renderProvider(stub, baseURL);

    // The iframe step is reached and attempted, returns no session, then every
    // later step skips and the terminal bounce fires exactly once.
    await waitFor(() => expect(ssoNavigateSpy).toHaveBeenCalledTimes(1));
    expect(silentSignInSpy).toHaveBeenCalledTimes(1);
    expect(silentSignInSpy).toHaveBeenCalledWith(
      expect.objectContaining({ authWebUrlOverride: PER_APEX_AUTH_URL }),
    );

    const assigned = new URL(ssoNavigateSpy.mock.calls[0][0] as string);
    expect(assigned.origin).toBe('https://auth.oxy.so');
    expect(assigned.pathname).toBe('/sso');
    expect(assigned.searchParams.get('prompt')).toBe('none');

    expect(captured.isAuthenticated).toBe(false);
  });
});
