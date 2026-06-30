/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * Central SSO bounce — loop prevention + 30s self-heal at the integration level.
 *
 * The terminal `sso-bounce` step must fire AT MOST ONCE for a logged-out RP.
 * Its `enabled()` gate disables the bounce when:
 *   - the per-origin NO_SESSION flag is set (a prior `none`/`error` return), OR
 *   - a bounce guard is still ACTIVE (< 30s old — a bounce is already in flight).
 *
 * It re-enables (self-heals) once the guard's 30s TTL lapses, so an interrupted
 * bounce (user navigated back mid-redirect) is not permanently stuck.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';

const ORIGIN = 'https://app.mention.earth';
const GUARD_KEY = `oxy_sso_guard:${ORIGIN}`;
const NO_SESSION_KEY = `oxy_sso_no_session:${ORIGIN}`;
const ATTEMPTED_KEY = `oxy_sso_attempted:${ORIGIN}`;
// Durable returning-user hint (default `oxy_session` storage prefix). The
// terminal `sso-bounce` is now SMART-gated: only a RETURNING visitor (hint set)
// is bounced. Every guard/loop-proof case below models a returning user.
const PRIOR_SESSION_KEY = 'oxy_session_prior_session';

interface CapturedState {
  isTokenReady: boolean;
}
let captured: CapturedState = { isTokenReady: false };
function Capture() {
  const { isTokenReady } = useOxy();
  captured = { isTokenReady };
  return null;
}

function buildStub(baseURL: string) {
  return {
    config: { authWebUrl: 'https://auth.oxy.so' },
    httpService: { setTokens: jest.fn() },
    getBaseURL: () => baseURL,
    getSessionBaseUrl: () => baseURL,
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
    exchangeSsoCode: jest.fn(async () => null),
    getCurrentUser: jest.fn(async (): Promise<User> => ({ id: 'u', username: 't' } as User)),
    validateSession: jest.fn(async () => ({ valid: true, user: { id: 'u' } })),
    listAccounts: jest.fn(async () => []),
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

describe('SSO bounce guard (loop prevention + self-heal)', () => {
  let assignSpy: jest.SpyInstance;
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // Seed the returning-user hint so the smart `sso-bounce` gate is satisfied;
    // these tests isolate the per-tab loop guards (NO_SESSION / guard / attempted),
    // not the first-time-visitor suppression (covered by its own test below).
    window.localStorage.setItem(PRIOR_SESSION_KEY, '1');
    captured = { isTokenReady: false };
    useAuthStore.getState().logout();
    window.history.replaceState(null, '', '/');
    assignSpy = jest.spyOn(oxyCore, 'ssoNavigate').mockImplementation(() => undefined);
  });

  afterEach(() => {
    assignSpy.mockRestore();
    nowSpy?.mockRestore();
  });

  it('does NOT bounce a truly first-time anonymous visitor (no prior-session hint)', async () => {
    // Override the returning-user default: a device with NO prior-session hint
    // and no local session is a first-time visitor → smart gate suppresses the
    // forced redirect so it can browse anonymously.
    window.localStorage.removeItem(PRIOR_SESSION_KEY);
    const stub = buildStub('https://api.mention.earth/guard-first-time');

    renderProvider(stub, 'https://api.mention.earth/guard-first-time');

    await waitFor(() => expect(captured.isTokenReady).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(assignSpy).not.toHaveBeenCalled();
    // The step never ran, so no probe state was stamped.
    expect(window.sessionStorage.getItem(ATTEMPTED_KEY)).toBeNull();
  });

  it('does NOT bounce when NO_SESSION is already set', async () => {
    window.sessionStorage.setItem(NO_SESSION_KEY, '1');
    const stub = buildStub('https://api.mention.earth/guard-nosession');

    renderProvider(stub, 'https://api.mention.earth/guard-nosession');

    await waitFor(() => expect(captured.isTokenReady).toBe(true));
    // Settle any trailing microtasks from cold boot before asserting "never".
    await new Promise((r) => setTimeout(r, 0));
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('does NOT bounce while a guard set <30s ago is still active', async () => {
    const t0 = 5_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    // A guard set 10s ago — still within the 30s TTL → bounce disabled.
    window.sessionStorage.setItem(GUARD_KEY, String(t0 - 10_000));
    const stub = buildStub('https://api.mention.earth/guard-active');

    renderProvider(stub, 'https://api.mention.earth/guard-active');

    await waitFor(() => expect(captured.isTokenReady).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('does NOT bounce when the attempted-flag is already set (runs at most once)', async () => {
    // Only the outcome-independent attempted-flag is set — NO NO_SESSION key and
    // NO guard. The bounce must still be disabled (the definitive loop breaker).
    window.sessionStorage.setItem(ATTEMPTED_KEY, '1');
    const stub = buildStub('https://api.mention.earth/guard-attempted');

    renderProvider(stub, 'https://api.mention.earth/guard-attempted');

    await waitFor(() => expect(captured.isTokenReady).toBe(true));
    // Settle any trailing microtasks from cold boot before asserting "never".
    await new Promise((r) => setTimeout(r, 0));
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('LOOP PROOF: a fresh cold boot bounces once + sets the attempted-flag, and never re-bounces even after the 30s guard TTL lapses', async () => {
    const t0 = 12_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);

    // First render: a genuinely fresh cold boot (no flags). It bounces exactly
    // once AND stamps the attempted-flag before navigating.
    const firstStub = buildStub('https://api.mention.earth/loop-proof-1');
    const first = renderProvider(firstStub, 'https://api.mention.earth/loop-proof-1');

    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(ATTEMPTED_KEY)).toBe('1');
    first.unmount();

    // Advance Date.now past the original guard's 30s TTL so the self-heal guard
    // would otherwise have lapsed (cf. the `self-heals` test, which DOES
    // re-bounce because it has no attempted-flag). The attempted-flag — which
    // survives the guard TTL — must keep the bounce suppressed.
    nowSpy.mockReturnValue(t0 + 31_000);

    // Second render in the SAME sessionStorage (NOT cleared between renders).
    // A distinct baseURL avoids the useWebSSO module-level guard interfering.
    const secondStub = buildStub('https://api.mention.earth/loop-proof-2');
    renderProvider(secondStub, 'https://api.mention.earth/loop-proof-2');

    await waitFor(() => expect(captured.isTokenReady).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    // Total assigns still 1 — the attempted-flag broke the loop.
    expect(assignSpy).toHaveBeenCalledTimes(1);
  });

  it('self-heals: bounces again once the 30s guard TTL has lapsed', async () => {
    const t0 = 9_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    // A guard set 31s ago — past the 30s TTL → treated as stale → fresh bounce.
    window.sessionStorage.setItem(GUARD_KEY, String(t0 - 31_000));
    const stub = buildStub('https://api.mention.earth/guard-stale');

    renderProvider(stub, 'https://api.mention.earth/guard-stale');

    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(1));
    // The fresh bounce re-stamped the guard with the current time.
    expect(window.sessionStorage.getItem(GUARD_KEY)).toBe(String(t0));
  });
});
