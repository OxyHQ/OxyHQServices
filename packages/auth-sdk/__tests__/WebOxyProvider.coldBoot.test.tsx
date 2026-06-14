/**
 * @jest-environment-options {"url": "https://mention.earth/"}
 *
 * Cold-boot orchestration for `WebOxyProvider` — TRUE central cross-domain SSO.
 *
 * The provider drives session recovery through `runColdBoot` (from
 * `@oxyhq/core`) with five ordered steps that mirror the services `OxyContext`
 * (consistency mandate). The services `stored-session` bearer-restore step is
 * omitted on web — it is native's only restore path and was a guaranteed no-op
 * here (web is cookie-only), so it was dropped:
 *
 *   0. redirect       — popup `?access_token=` query callback.
 *   1. sso-return     — parse `location.hash`; on `ok` exchange the opaque code
 *                       and commit; on `none`/`error`/mismatch set NO_SESSION.
 *   2. fedcm-silent   — silent FedCM against the CENTRAL `auth.oxy.so` (Chrome).
 *   3. cookie-restore — refresh-cookie restore (first-party only on *.oxy.so).
 *   4. sso-bounce     — TERMINAL top-level navigation to `auth.oxy.so/sso`.
 *
 * These tests pin the contract:
 *   1. The first step that yields a real session wins; later steps never run.
 *   2. `redirect` / `cookie-restore` MUST hydrate a real user (non-empty id)
 *      before committing — a placeholder user is never exposed (R4).
 *   3. `sso-return` `ok` exchanges the code and commits; `none` and
 *      state-mismatch set the NO_SESSION flag and skip.
 *   4. `sso-bounce` fires exactly ONCE for a logged-out visitor (loop proof),
 *      and is disabled once NO_SESSION is set.
 *
 * `@oxyhq/core` is mocked so the orchestration can be observed deterministically
 * while the REAL `runColdBoot`, `resolveCentralAuthUrl`, `CENTRAL_AUTH_URL`,
 * `parseSsoReturnFragment`, and `logger` run.
 *
 * The fixed jsdom origin is a cross-domain RP (`mention.earth`) so the
 * `sso-bounce` step (disabled on the central IdP itself) is exercisable. The
 * `fedcm-silent` run-once guard is module-level and keyed on `origin|baseURL`;
 * each test uses a UNIQUE `baseURL` to get an independent budget — except the
 * run-once tests, which deliberately reuse one key to prove deduplication.
 */

import { render, waitFor } from '@testing-library/react';
import type { SessionLoginResponse, User } from '@oxyhq/core';

// ---------------------------------------------------------------------------
// Controllable @oxyhq/core mock. Real cold-boot + SSO helpers; stubbed
// service/auth surfaces. `stubs.baseURL` is read by the mocked
// `OxyServices.getBaseURL()` so the run-once guard key tracks the active test.
// ---------------------------------------------------------------------------

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
    // Real cold-boot primitives + SSO helpers. The provider delegates the
    // security-critical CSRF/fragment/exchange/dest sequence to the REAL
    // `consumeSsoReturn`, and reads the REAL per-origin key derivation + bounce
    // helpers — so these tests exercise the exact production logic.
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
    // Stubbed service / auth surfaces.
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

// Import AFTER the mock is registered. The SSO helpers resolve to the REAL
// `@oxyhq/core` implementations (passed through the mock above) — the same ones
// the provider consumes — so the per-origin keys and bounce URL match exactly.
import { WebOxyProvider, useAuth } from '../src/WebOxyProvider';
import {
  ssoStateKey,
  ssoNoSessionKey,
  ssoGuardKey,
  ssoDestKey,
  ssoAttemptedKey,
  SSO_CALLBACK_PATH,
  buildSsoBounceUrl,
} from '@oxyhq/core';

const ORIGIN = 'https://mention.earth';
const realUser: User = { id: 'u1', username: 'tester' } as User;

function makeSession(user: Partial<User>): SessionLoginResponse {
  return {
    sessionId: 'sess_1',
    deviceId: 'dev_1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: user as User,
  };
}

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

// jsdom navigates legitimately via `history.replaceState`/`pushState`, which
// correctly update `window.location` — that is how the fixed
// `@jest-environment-options` url + the provider's fragment-strip work. The
// ONLY navigation jsdom refuses is `window.location.assign` (it logs a
// "Not implemented: navigation" virtual-console warning and no-ops; it cannot
// be spied because the property is non-configurable and read-only).
//
// So the TERMINAL `sso-bounce` is observed by its deterministic synchronous
// side effects instead of the un-spyable `assign`: `oxyServices.generateSsoState`
// is called EXACTLY ONCE per bounce (and nowhere else), and the
// state/guard/dest sessionStorage keys are written before `assign`. The actual
// bounce URL is asserted via the pure `buildSsoBounceUrl` helper.
//
// `bounced()` is the canonical "a bounce was triggered" probe.
function bounced(): boolean {
  return stubs.generateSsoState.mock.calls.length > 0;
}

/** Drive jsdom's real location to `href` (relative to the RP origin). */
function setLocation(href: string): void {
  window.history.replaceState(null, '', new URL(href, ORIGIN).href);
}

describe('WebOxyProvider cold boot (central SSO)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // Reset the URL/hash to the bare RP origin between tests.
    setLocation(`${ORIGIN}/`);
  });

  it('0) redirect step wins and short-circuits later steps', async () => {
    resetStubs('https://api.test-0');
    stubs.handleRedirectCallback.mockReturnValue(makeSession({ id: '', username: '' }));
    stubs.getCurrentUser.mockResolvedValue(realUser);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(true));
    expect(latest.userId).toBe('u1');
    // Later steps must never run once redirect wins.
    expect(stubs.exchangeSsoCode).not.toHaveBeenCalled();
    expect(stubs.silentSignInWithFedCM).not.toHaveBeenCalled();
    expect(stubs.managerInitialize).not.toHaveBeenCalled();
    expect(bounced()).toBe(false);
  });

  it('1) redirect returns skip (NOT a placeholder session) when hydration fails — R4', async () => {
    resetStubs('https://api.test-1');
    stubs.handleRedirectCallback.mockReturnValue(makeSession({ id: '', username: '' }));
    stubs.getCurrentUser.mockRejectedValue(new Error('bearer rejected'));

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    // No SSO fragment, FedCM unsupported, no cookie → falls through to bounce.
    await waitFor(() => expect(bounced()).toBe(true));
    // A placeholder session must NEVER be committed.
    expect(latest.isAuthenticated).toBe(false);
    expect(latest.userId).toBeNull();
    // Exactly one bounce.
    expect(stubs.generateSsoState).toHaveBeenCalledTimes(1);
  });

  it('2) sso-return ok: exchanges the opaque code and commits', async () => {
    resetStubs('https://api.test-2');
    // We are back on the callback path with a valid ok fragment + matching state.
    window.sessionStorage.setItem(ssoStateKey(ORIGIN), 'st-2');
    window.sessionStorage.setItem(ssoDestKey(ORIGIN), `${ORIGIN}/feed?tab=home`);
    setLocation(`${ORIGIN}${SSO_CALLBACK_PATH}#oxy_sso=ok&code=opaque-2&state=st-2`);
    stubs.exchangeSsoCode.mockResolvedValue(makeSession({ id: 'u1', username: 'tester' }));
    stubs.getCurrentUser.mockResolvedValue(realUser);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(true));
    expect(stubs.exchangeSsoCode).toHaveBeenCalledWith('opaque-2');
    expect(latest.userId).toBe('u1');
    // The fragment is stripped and the real destination restored.
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/feed');
    expect(window.location.search).toBe('?tab=home');
    // State + dest are consumed; no bounce.
    expect(window.sessionStorage.getItem(ssoStateKey(ORIGIN))).toBeNull();
    expect(window.sessionStorage.getItem(ssoDestKey(ORIGIN))).toBeNull();
    expect(bounced()).toBe(false);
  });

  it('3) sso-return none: sets NO_SESSION, does NOT exchange, does NOT rebounce', async () => {
    resetStubs('https://api.test-3');
    window.sessionStorage.setItem(ssoStateKey(ORIGIN), 'st-3');
    setLocation(`${ORIGIN}${SSO_CALLBACK_PATH}#oxy_sso=none&state=st-3`);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isLoading).toBe(false));
    expect(latest.isAuthenticated).toBe(false);
    expect(stubs.exchangeSsoCode).not.toHaveBeenCalled();
    // NO_SESSION is set → sso-bounce is disabled (loop proof, load2).
    expect(window.sessionStorage.getItem(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(bounced()).toBe(false);
    // Fragment stripped.
    expect(window.location.hash).toBe('');
  });

  it('4) sso-return state-mismatch: sets NO_SESSION, never exchanges (CSRF)', async () => {
    resetStubs('https://api.test-4');
    window.sessionStorage.setItem(ssoStateKey(ORIGIN), 'expected-state');
    setLocation(`${ORIGIN}${SSO_CALLBACK_PATH}#oxy_sso=ok&code=evil&state=attacker-state`);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isLoading).toBe(false));
    expect(latest.isAuthenticated).toBe(false);
    // A mismatched state must NEVER trigger a code exchange.
    expect(stubs.exchangeSsoCode).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(bounced()).toBe(false);
  });

  it('5) fedcm-silent step wins when prior steps skip (carries real user)', async () => {
    resetStubs('https://api.test-5');
    stubs.isFedCMSupported.mockReturnValue(true);
    stubs.silentSignInWithFedCM.mockResolvedValue(makeSession({ id: 'u1', username: 'tester' }));

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(true));
    expect(latest.userId).toBe('u1');
    expect(stubs.managerInitialize).not.toHaveBeenCalled();
    expect(bounced()).toBe(false);
  });

  it('6) cookie-restore hydrates a real user and commits when prior steps skip', async () => {
    resetStubs('https://api.test-6');
    stubs.managerInitialize.mockResolvedValue(realUser);
    stubs.getActiveAccount.mockReturnValue({ sessionId: 'sess_cookie' });
    stubs.getCurrentUser.mockResolvedValue(realUser);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(true));
    expect(latest.userId).toBe('u1');
    expect(bounced()).toBe(false);
  });

  it('7) LOOP PROOF: a logged-out visitor bounces exactly ONCE and sets guard/state/dest', async () => {
    resetStubs('https://api.test-7');
    // Land on a real destination so the dest capture is meaningful.
    setLocation(`${ORIGIN}/feed?tab=home`);
    // Everything skips: no redirect, no fragment, no FedCM, no cookie.

    renderProvider(stubs.baseURL, () => undefined);

    // The bounce mints state EXACTLY ONCE (the canonical bounce signal).
    await waitFor(() => expect(bounced()).toBe(true));
    expect(stubs.generateSsoState).toHaveBeenCalledTimes(1);

    // Guard + state + dest are all written for the round-trip.
    expect(window.sessionStorage.getItem(ssoStateKey(ORIGIN))).toBe('state-fixed');
    expect(window.sessionStorage.getItem(ssoGuardKey(ORIGIN))).not.toBeNull();
    // The real destination (not the bare callback path) is captured for restore.
    expect(window.sessionStorage.getItem(ssoDestKey(ORIGIN))).toBe(`${ORIGIN}/feed?tab=home`);
    // The outcome-independent attempted-flag is stamped BEFORE the bounce
    // navigates — the definitive loop breaker, set regardless of return outcome.
    expect(window.sessionStorage.getItem(ssoAttemptedKey(ORIGIN))).toBe('1');

    // The bounce target the provider builds points at the central IdP /sso with
    // the right params (verified through the same pure helper the provider uses).
    const target = new URL(buildSsoBounceUrl(ORIGIN, 'state-fixed'));
    expect(target.origin).toBe('https://auth.oxy.so');
    expect(target.pathname).toBe('/sso');
    expect(target.searchParams.get('prompt')).toBe('none');
    expect(target.searchParams.get('client_id')).toBe(ORIGIN);
    expect(target.searchParams.get('return_to')).toBe(ORIGIN + SSO_CALLBACK_PATH);
    expect(target.searchParams.get('state')).toBe('state-fixed');
  });

  it('8) LOOP PROOF: an active guard suppresses a second bounce', async () => {
    resetStubs('https://api.test-8');
    // Simulate an in-flight bounce: a fresh guard is present.
    window.sessionStorage.setItem(ssoGuardKey(ORIGIN), String(Date.now()));

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isLoading).toBe(false));
    // The guard is active → no second bounce.
    expect(bounced()).toBe(false);
  });

  it('9) LOOP PROOF: NO_SESSION flag suppresses the bounce entirely', async () => {
    resetStubs('https://api.test-9');
    window.sessionStorage.setItem(ssoNoSessionKey(ORIGIN), '1');

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isLoading).toBe(false));
    expect(bounced()).toBe(false);
  });

  it('11) LOOP PROOF: attempted-flag suppresses the bounce entirely', async () => {
    resetStubs('https://api.test-11');
    // Only the outcome-independent attempted-flag is set — no NO_SESSION, no
    // guard. The bounce must still be suppressed (the definitive loop breaker).
    window.sessionStorage.setItem(ssoAttemptedKey(ORIGIN), '1');

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isLoading).toBe(false));
    expect(bounced()).toBe(false);
  });

  it('10) fedcm-silent fires AT MOST ONCE across remounts (origin|baseURL guard)', async () => {
    resetStubs('https://api.test-10');
    stubs.isFedCMSupported.mockReturnValue(true);
    stubs.silentSignInWithFedCM.mockResolvedValue(null);

    const first = renderProvider(stubs.baseURL, () => undefined);
    await waitFor(() => expect(stubs.silentSignInWithFedCM).toHaveBeenCalledTimes(1));
    first.unmount();

    for (let i = 0; i < 5; i++) {
      const r = renderProvider(stubs.baseURL, () => undefined);
      r.unmount();
    }
    expect(stubs.silentSignInWithFedCM).toHaveBeenCalledTimes(1);
  });
});
