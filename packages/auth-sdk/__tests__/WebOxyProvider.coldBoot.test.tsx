/**
 * @jest-environment-options {"url": "https://mention.earth/"}
 *
 * Cold-boot orchestration for `WebOxyProvider` — TRUE central cross-domain SSO.
 *
 * The provider drives session recovery through `runColdBoot` (from
 * `@oxyhq/core`) with three ordered steps that mirror the web-only subset of
 * services `OxyContext` (consistency mandate). The legacy access-token redirect
 * callback is intentionally not a session source anymore; redirect auth returns
 * through the opaque-code SSO fragment consumed by `sso-return`. FedCM was
 * removed from the client cold-boot path entirely (Chrome-only; the source of a
 * real production sign-in loop — see `CrossDomainAuth`'s doc comment in
 * `@oxyhq/core`), so there is NO `fedcm-silent` step.
 *
 *   0. sso-return     — parse `location.hash`; on `ok` exchange the opaque code
 *                       and commit; on `none`/`error`/mismatch set NO_SESSION.
 *   1. silent-iframe  — first-party `/auth/silent` iframe at the PER-APEX IdP
 *                       (the durable cross-domain AND same-apex reload-restore
 *                       path). This IS cold boot's durable restore path — the
 *                       ladder never reads the oxy_rt refresh cookie and never
 *                       attempts FedCM.
 *   2. sso-bounce     — TERMINAL top-level navigation to `auth.oxy.so/sso`.
 *
 * These tests pin the contract:
 *   1. The first step that yields a real session wins; later steps never run.
 *   2. `silent-iframe` MUST hydrate a real user (non-empty id + sessionId)
 *      before committing — a placeholder user is never exposed (R4).
 *   3. `sso-return` `ok` exchanges the code and commits; `none` and
 *      state-mismatch set the NO_SESSION flag and skip.
 *   4. `sso-bounce` fires exactly ONCE for a logged-out visitor (loop proof),
 *      and is disabled once NO_SESSION is set.
 *   5. Once a session is committed (any ladder step) the post-ladder
 *      `SessionClient` handoff registers the account (`addCurrentAccount`),
 *      starts the client (`start`), and projects its state — but ONLY when a
 *      session was actually acquired; an anonymous visitor never touches the
 *      client's `start`/`addCurrentAccount`.
 *
 * `@oxyhq/core` is mocked so the orchestration can be observed deterministically
 * while the REAL `runColdBoot`, `resolveCentralAuthUrl`, `CENTRAL_AUTH_URL`,
 * `parseSsoReturnFragment`, and `logger` run. `createSessionClient` is the ONE
 * mocked seam (mirrors `sessionClientWiring.test.tsx`) — swapped per-test for a
 * controllable fake client so the post-ladder handoff can be asserted
 * precisely; every test that doesn't care about it gets a harmless default fake
 * (via `beforeEach`) whose `addCurrentAccount`/`start` resolve without altering
 * state.
 *
 * The fixed jsdom origin is a cross-domain RP (`mention.earth`) so the
 * `sso-bounce` step (disabled on the central IdP itself) is exercisable. Each
 * test uses a UNIQUE `baseURL` so the per-origin bounce sessionStorage keys
 * (state/guard/dest/attempted) never leak between tests.
 */

import { render, waitFor, act } from '@testing-library/react';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import type { DeviceSessionState } from '@oxyhq/contracts';

// ---------------------------------------------------------------------------
// Controllable @oxyhq/core mock. Real cold-boot + SSO helpers; stubbed
// service/auth surfaces. `stubs.baseURL` is read by the mocked
// `OxyServices.getBaseURL()` so the run-once guard key tracks the active test.
// ---------------------------------------------------------------------------

interface CoreStubs {
  getCurrentUser: jest.Mock<Promise<User | null>, []>;
  handleRedirectCallback: jest.Mock<SessionLoginResponse | null, []>;
  silentSignIn: jest.Mock<Promise<SessionLoginResponse | null>, [unknown?]>;
  exchangeSsoCode: jest.Mock<Promise<SessionLoginResponse>, [string]>;
  generateSsoState: jest.Mock<string, []>;
  getUsersByIds: jest.Mock<Promise<User[]>, [string[]]>;
  baseURL: string;
}

const stubs: CoreStubs = {
  getCurrentUser: jest.fn(async () => null),
  handleRedirectCallback: jest.fn(() => null),
  silentSignIn: jest.fn(async () => null),
  exchangeSsoCode: jest.fn(async () => ({}) as SessionLoginResponse),
  generateSsoState: jest.fn(() => 'state-fixed'),
  getUsersByIds: jest.fn(async () => []),
  baseURL: 'https://api.oxy.so',
};

function resetStubs(baseURL: string): void {
  stubs.getCurrentUser = jest.fn(async () => null);
  stubs.handleRedirectCallback = jest.fn(() => null);
  stubs.silentSignIn = jest.fn(async () => null);
  stubs.exchangeSsoCode = jest.fn(async () => ({}) as SessionLoginResponse);
  stubs.generateSsoState = jest.fn(() => 'state-fixed');
  stubs.getUsersByIds = jest.fn(async () => []);
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
    ssoPriorSessionKey: actual.ssoPriorSessionKey,
    ssoSignedOutKey: actual.ssoSignedOutKey,
    ssoOutcomeKey: actual.ssoOutcomeKey,
    silentRestoreSuppressed: actual.silentRestoreSuppressed,
    isCentralIdPOrigin: actual.isCentralIdPOrigin,
    guardActive: actual.guardActive,
    allowSsoBounce: actual.allowSsoBounce,
    buildSsoBounceUrl: actual.buildSsoBounceUrl,
    logger: actual.logger,
    // Pure host-detection helper — REAL implementation. Deterministic given
    // the fixed jsdom origin (`mention.earth` → `https://auth.mention.earth`);
    // no network/DOM side effects on its own.
    autoDetectAuthWebUrl: actual.autoDetectAuthWebUrl,
    // Pure projection helpers — REAL implementations (mirrors
    // `sessionClientWiring.test.tsx`).
    deviceStateToClientSessions: actual.deviceStateToClientSessions,
    activeSessionIdOf: actual.activeSessionIdOf,
    activeUserOf: actual.activeUserOf,
    accountIdsOf: actual.accountIdsOf,
    // `createSessionClient` is the ONE mocked seam — swapped per-test for a
    // controllable fake client/host pair (mirrors `sessionClientWiring.test.tsx`).
    createSessionClient: jest.fn(),
    // Stubbed service / auth surfaces. No `AuthManager`/`createAuthManager`
    // export: `WebOxyProvider` no longer imports them (Fase 4 cutover, Task
    // 5) — if it ever did again, this suite would fail immediately with a
    // hard runtime error instead of silently reintroducing the retired
    // hybrid.
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
      silentSignIn(options?: unknown): Promise<SessionLoginResponse | null> {
        return stubs.silentSignIn(options);
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
      getUsersByIds(ids: string[]): Promise<User[]> {
        return stubs.getUsersByIds(ids);
      }
    },
    CrossDomainAuth: class {
      handleRedirectCallback(): SessionLoginResponse | null {
        return stubs.handleRedirectCallback();
      }
    },
  };
});

// Import AFTER the mock is registered. The SSO helpers resolve to the REAL
// `@oxyhq/core` implementations (passed through the mock above) — the same ones
// the provider consumes — so the per-origin keys and bounce URL match exactly.
import { WebOxyProvider, useAuth, useWebOxy, type WebOxyContextValue } from '../src/WebOxyProvider';
import {
  ssoStateKey,
  ssoNoSessionKey,
  ssoGuardKey,
  ssoDestKey,
  ssoAttemptedKey,
  ssoPriorSessionKey,
  ssoSignedOutKey,
  SSO_CALLBACK_PATH,
  buildSsoBounceUrl,
  createSessionClient,
} from '@oxyhq/core';

const mockedCreateSessionClient = createSessionClient as jest.MockedFunction<typeof createSessionClient>;

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

type StateListener = (state: DeviceSessionState | null) => void;

/**
 * A controllable stand-in for `SessionClient`, mirroring
 * `sessionClientWiring.test.tsx`'s `buildFakeClient` plus the two methods the
 * Fase 4 cold-boot handoff now calls: `addCurrentAccount` and `start`. Both
 * default to resolving without altering `state` and without notifying
 * subscribers — tests that care about the projection call `setState` +
 * `fire()` (or configure `onAddCurrentAccount`/`onStart`) explicitly.
 */
function buildFakeClient(options: {
  initialState?: DeviceSessionState | null;
  onAddCurrentAccount?: () => void;
  onStart?: () => void;
} = {}) {
  let state = options.initialState ?? null;
  const listeners = new Set<StateListener>();
  const fire = () => {
    for (const listener of listeners) listener(state);
  };
  return {
    fakeClient: {
      getState: () => state,
      subscribe: (listener: StateListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      addCurrentAccount: jest.fn(async () => {
        options.onAddCurrentAccount?.();
        fire();
      }),
      start: jest.fn(async () => {
        options.onStart?.();
        fire();
      }),
      stop: jest.fn(),
    },
    setState(next: DeviceSessionState | null) {
      state = next;
    },
    fire,
  };
}

function buildDeviceState(accountId: string): DeviceSessionState {
  return {
    deviceId: 'dev-1',
    accounts: [{ accountId, sessionId: 'sess_1', authuser: 0 }],
    activeAccountId: accountId,
    revision: 1,
    updatedAt: Date.now(),
  };
}

interface ProbeState {
  isAuthenticated: boolean;
  userId: string | null;
  isLoading: boolean;
  /** Only asserted by the SessionClient-handoff tests; omitted elsewhere. */
  sessionsLength?: number;
  activeSessionId?: string | null;
}

function Probe({ onState }: { onState: (s: ProbeState) => void }) {
  const { isAuthenticated, user, isLoading, sessions, activeSessionId } = useAuth();
  onState({
    isAuthenticated,
    userId: user?.id ?? null,
    isLoading,
    sessionsLength: sessions.length,
    activeSessionId,
  });
  return null;
}

function renderProvider(baseURL: string, onState: (s: ProbeState) => void) {
  return render(
    <WebOxyProvider baseURL={baseURL}>
      <Probe onState={onState} />
    </WebOxyProvider>
  );
}

/** Captures the full context (including `commitClaimedSession`) for direct invocation. */
function CaptureContext({ onReady }: { onReady: (ctx: WebOxyContextValue) => void }) {
  const ctx = useWebOxy();
  onReady(ctx);
  return null;
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
    // The terminal `sso-bounce` is now SMART-gated (`allowSsoBounce`): a truly
    // first-time anonymous visitor is NOT bounced. Every loop-proof test below
    // models a RETURNING user (the realistic case where the cross-domain bounce
    // matters), so seed the durable prior-session hint by default. The dedicated
    // "first-time" and "hard opt-out" tests override this explicitly.
    window.localStorage.setItem(ssoPriorSessionKey(ORIGIN), '1');
    // Reset the URL/hash to the bare RP origin between tests.
    setLocation(`${ORIGIN}/`);
    // Default SessionClient fake: harmless no-op `addCurrentAccount`/`start`
    // that never alter/notify state. Tests exercising the post-ladder handoff
    // override this per-test with `mockedCreateSessionClient.mockReturnValue`.
    mockedCreateSessionClient.mockReset();
    const defaultFake = buildFakeClient();
    mockedCreateSessionClient.mockReturnValue({
      client: defaultFake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });
  });

  it('0) legacy redirect callback data is not committed by cold boot', async () => {
    resetStubs('https://api.test-0');
    stubs.handleRedirectCallback.mockReturnValue(makeSession({ id: '', username: '' }));
    stubs.getCurrentUser.mockResolvedValue(realUser);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(bounced()).toBe(true));
    expect(latest.isAuthenticated).toBe(false);
    expect(latest.userId).toBeNull();
    expect(stubs.handleRedirectCallback).not.toHaveBeenCalled();
    expect(stubs.exchangeSsoCode).not.toHaveBeenCalled();
  });

  it('1) legacy redirect placeholder data is never exposed when hydration fails — R4', async () => {
    resetStubs('https://api.test-1');
    stubs.handleRedirectCallback.mockReturnValue(makeSession({ id: '', username: '' }));
    stubs.getCurrentUser.mockRejectedValue(new Error('bearer rejected'));

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    // No SSO fragment, no silent-iframe session, no cookie → falls through to bounce.
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

  it('5b) DELIBERATELY-SIGNED-OUT gate: silent-iframe is SKIPPED when the signed-out flag is set', async () => {
    resetStubs('https://api.test-5b');
    // The silent-iframe restore WOULD succeed — but the user deliberately
    // signed out, so silent restore must NOT run and must NOT sign them back
    // in on this cold boot.
    stubs.silentSignIn.mockResolvedValue(makeSession({ id: 'u1', username: 'tester' }));
    window.localStorage.setItem(ssoSignedOutKey(ORIGIN), '1');

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    // The chain falls through to the terminal bounce (the beforeEach seeds the
    // returning-visitor hint), proving silent-iframe did not silently restore.
    await waitFor(() => expect(bounced()).toBe(true));
    expect(stubs.silentSignIn).not.toHaveBeenCalled();
    expect(latest.isAuthenticated).toBe(false);
  });

  it('6) silent-iframe hydrates a real user and commits when prior steps skip (replaces retired cookie-restore)', async () => {
    resetStubs('https://api.test-6');
    stubs.silentSignIn.mockResolvedValue(makeSession({ id: 'u1', username: 'tester' }));

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(true));
    expect(latest.userId).toBe('u1');
    // The per-apex host (mention.earth's registrable apex) is passed as the
    // override — the CENTRAL auth URL cannot read the per-apex cookie.
    expect(stubs.silentSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ authWebUrlOverride: 'https://auth.mention.earth' }),
    );
    expect(bounced()).toBe(false);
  });

  it('6b) silent-iframe skips (falls through to bounce) when it returns no session', async () => {
    resetStubs('https://api.test-6b');
    stubs.silentSignIn.mockResolvedValue(null);

    renderProvider(stubs.baseURL, () => undefined);

    await waitFor(() => expect(bounced()).toBe(true));
    expect(stubs.silentSignIn).toHaveBeenCalled();
  });

  it('7) LOOP PROOF: a logged-out visitor bounces exactly ONCE and sets guard/state/dest', async () => {
    resetStubs('https://api.test-7');
    // Land on a real destination so the dest capture is meaningful.
    setLocation(`${ORIGIN}/feed?tab=home`);
    // Everything skips: no redirect, no fragment, no silent-iframe session, no cookie.

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

  it('12) SMART GATE: a truly first-time anonymous visitor (no prior-session hint) does NOT bounce', async () => {
    resetStubs('https://api.test-12');
    // Override the beforeEach default: NO prior-signed-in hint → first-time
    // visitor. Everything else skips (no redirect, fragment, silent-iframe, cookie).
    window.localStorage.removeItem(ssoPriorSessionKey(ORIGIN));

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    // Smart default: no forced redirect to the central IdP — anonymous browse.
    await waitFor(() => expect(latest.isLoading).toBe(false));
    expect(bounced()).toBe(false);
    expect(latest.isAuthenticated).toBe(false);
    // No probe state was stamped because the step never ran.
    expect(window.sessionStorage.getItem(ssoAttemptedKey(ORIGIN))).toBeNull();
  });

  it('13) SMART GATE: a returning visitor (prior-session hint) DOES bounce once', async () => {
    resetStubs('https://api.test-13');
    // The beforeEach already seeded the prior-session hint; make it explicit so
    // the contract is readable: hint present → returning user → one bounce.
    expect(window.localStorage.getItem(ssoPriorSessionKey(ORIGIN))).toBe('1');

    renderProvider(stubs.baseURL, () => undefined);

    await waitFor(() => expect(bounced()).toBe(true));
    expect(stubs.generateSsoState).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(ssoAttemptedKey(ORIGIN))).toBe('1');
  });

  // -------------------------------------------------------------------------
  // Post-ladder SessionClient handoff (Task 2 of the Fase 4 cutover): once the
  // token-acquisition ladder above acquires a session, `addCurrentAccount` +
  // `start` + `syncFromClient` register/bootstrap/project the server-authoritative
  // device-session set. These tests swap in a CONTROLLABLE fake client (via the
  // mocked `createSessionClient` seam) to assert the handoff precisely.
  // -------------------------------------------------------------------------

  it('a) silent-iframe win: post-ladder handoff registers via addCurrentAccount, then starts the client, and projects state', async () => {
    resetStubs('https://api.test-handoff-a');
    stubs.silentSignIn.mockResolvedValue(makeSession({ id: 'u1', username: 'tester' }));
    stubs.getUsersByIds.mockResolvedValue([{ id: 'u1', username: 'tester' } as User]);

    const fake = buildFakeClient({
      onAddCurrentAccount: () => fake.setState(buildDeviceState('u1')),
    });
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(true));
    await waitFor(() => expect(fake.fakeClient.addCurrentAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fake.fakeClient.start).toHaveBeenCalledTimes(1));

    // `addCurrentAccount` registers BEFORE `start` bootstraps (handleAuthSuccess
    // registers inline; the post-ladder handoff then only calls `start`, skipping
    // a redundant second `addCurrentAccount` via `registeredDuringBootRef`).
    const addOrder = fake.fakeClient.addCurrentAccount.mock.invocationCallOrder[0];
    const startOrder = fake.fakeClient.start.mock.invocationCallOrder[0];
    expect(addOrder).toBeLessThan(startOrder);

    // The resulting DeviceSessionState projects onto sessions/activeSessionId.
    await waitFor(() => expect(latest.sessionsLength).toBe(1));
    expect(latest.activeSessionId).toBe('sess_1');
    expect(stubs.getUsersByIds).toHaveBeenCalledWith(['u1']);
    expect(bounced()).toBe(false);
  });

  it('b) commitClaimedSession (Commons device-flow) registers via addCurrentAccount — commit, not switch', async () => {
    resetStubs('https://api.test-handoff-b');
    const fake = buildFakeClient();
    const switchAccountSpy = jest.fn();
    mockedCreateSessionClient.mockReturnValue({
      client: { ...fake.fakeClient, switchAccount: switchAccountSpy } as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });

    let ctx: WebOxyContextValue | null = null;
    render(
      <WebOxyProvider baseURL={stubs.baseURL}>
        <CaptureContext onReady={(c) => { ctx = c; }} />
      </WebOxyProvider>,
    );

    // Let the (unrelated) cold boot settle first — nothing wins this boot, so
    // it reaches the terminal bounce (the beforeEach seeds the returning-user
    // hint). The claim below arrives out-of-band, independent of the ladder.
    await waitFor(() => expect(bounced()).toBe(true));
    if (!ctx) {
      throw new Error('WebOxyProvider context was never captured');
    }

    await act(async () => {
      if (!ctx) {
        throw new Error('WebOxyProvider context was never captured');
      }
      await ctx.commitClaimedSession({
        accessToken: 'tok-claim',
        sessionId: 'sess_claim',
        deviceId: 'dev_claim',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        user: { id: 'u9', username: 'claimed' } as User,
      });
    });

    // Registration (commit), never an account-SWITCH — a freshly-claimed
    // session is not yet a member of this device's session set.
    expect(fake.fakeClient.addCurrentAccount).toHaveBeenCalledTimes(1);
    expect(switchAccountSpy).not.toHaveBeenCalled();
  });

  it('c) no session recovered: the handoff never touches the client (start/addCurrentAccount are never called)', async () => {
    resetStubs('https://api.test-handoff-c');
    const fake = buildFakeClient();
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isLoading).toBe(false));
    expect(fake.fakeClient.start).not.toHaveBeenCalled();
    expect(fake.fakeClient.addCurrentAccount).not.toHaveBeenCalled();
  });
});
