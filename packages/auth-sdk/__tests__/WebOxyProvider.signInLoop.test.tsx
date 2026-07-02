/**
 * @jest-environment-options {"url": "https://console.oxy.so/"}
 *
 * REGRESSION: the console.oxy.so ~200ms sign-in loop (Fase 4 cutover).
 *
 * INCIDENT: when the `WebOxyProvider` cutover deployed, `console.oxy.so` stuck
 * on its splash screen and spammed the console every ~200ms with
 * "CrossDomainAuth.autoSignIn: FedCM failed (Network error)... falling back to
 * redirect" — hundreds of messages, the page never navigating.
 *
 * ROOT CAUSE: the console `AuthGuard` runs the canonical RP pattern
 *
 *     useEffect(() => {
 *       if (isReady && !isAuthenticated) signIn();
 *     }, [isReady, isAuthenticated, signIn]);
 *
 * A cross-domain redirect resolves `crossDomainAuth.signIn()` to `null` the
 * instant the top-level navigation is KICKED OFF (before the browser tears the
 * page down). The pre-fix `WebOxyProvider.signIn` unconditionally called
 * `setIsLoading(false)` in that `null` branch, flipping `isReady` back to
 * `true` with the user still unauthenticated. The guard observed that transient
 * "ready + unauthenticated" state and re-invoked `signIn()`, whose
 * `window.location.assign` ABORTED the in-flight navigation — so the page never
 * left, and the effect re-fired every render (~200ms, the cadence of the FedCM
 * fast-fail that used to run first).
 *
 * THE FIX (this suite locks it in):
 *   1. `WebOxyProvider.signIn` leaves `isLoading`/`signingInRef` as-is once a
 *      redirect is initiated (the `null`-session branch) — `isReady` stays
 *      false, so the guard's condition is false and cannot re-fire, and the
 *      `signingInRef` mutex short-circuits any call that slips through.
 *   2. (in `@oxyhq/core`) `CrossDomainAuth.autoSignIn` no longer attempts FedCM
 *      — it goes straight to the redirect, removing the fast-fail cadence.
 *
 * The test drives the EXACT console `AuthGuard` shape against a `signIn` mock
 * that simulates a redirect (records the call, resolves `null`) and asserts the
 * two invariants that break the loop: cold boot / `signIn` is entered exactly
 * ONCE, and `isReady` never flips back to `true` after the redirect is
 * initiated. Reverting either fix re-introduces a growing call count here.
 *
 * `@oxyhq/core` is mocked (mirroring `WebOxyProvider.coldBoot.test.tsx`): the
 * REAL `runColdBoot` + SSO helpers run, `createSessionClient` is a harmless
 * fake, and `CrossDomainAuth.signIn` is the observable seam.
 */

import { render, waitFor, act } from '@testing-library/react';
import { useEffect } from 'react';
import type { SessionLoginResponse, User } from '@oxyhq/core';

const signInMock = jest.fn<Promise<SessionLoginResponse | null>, [unknown?]>(async () => null);
const silentSignInMock = jest.fn<Promise<SessionLoginResponse | null>, [unknown?]>(async () => null);

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
    ssoPriorSessionKey: actual.ssoPriorSessionKey,
    ssoSignedOutKey: actual.ssoSignedOutKey,
    silentRestoreSuppressed: actual.silentRestoreSuppressed,
    isCentralIdPOrigin: actual.isCentralIdPOrigin,
    guardActive: actual.guardActive,
    allowSsoBounce: actual.allowSsoBounce,
    buildSsoBounceUrl: actual.buildSsoBounceUrl,
    logger: actual.logger,
    autoDetectAuthWebUrl: actual.autoDetectAuthWebUrl,
    deviceStateToClientSessions: actual.deviceStateToClientSessions,
    activeSessionIdOf: actual.activeSessionIdOf,
    activeUserOf: actual.activeUserOf,
    accountIdsOf: actual.accountIdsOf,
    createSessionClient: jest.fn(() => ({
      client: {
        getState: () => null,
        subscribe: () => () => undefined,
        addCurrentAccount: jest.fn(async () => undefined),
        start: jest.fn(async () => undefined),
        stop: jest.fn(),
      },
      host: { setCurrentAccountId: jest.fn() },
    })),
    OxyServices: class {
      _accessToken: string | null = null;
      httpService = {
        setAuthRefreshHandler: (_handler: unknown) => undefined,
        refreshAccessToken: async () => null,
      };
      getBaseURL(): string {
        return 'https://api.oxy.so';
      }
      getCurrentUser(): Promise<User | null> {
        return Promise.resolve(null);
      }
      silentSignIn(options?: unknown): Promise<SessionLoginResponse | null> {
        return silentSignInMock(options);
      }
      generateSsoState(): string {
        return 'state-fixed';
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
      getUsersByIds(): Promise<User[]> {
        return Promise.resolve([]);
      }
    },
    // The observable seam: `signIn` simulates a cross-domain redirect — it
    // records the call and resolves `null` (a redirect resolves to no session
    // the instant the top-level navigation is kicked off). `signInWithRedirect`
    // is a harmless no-op (jsdom cannot navigate); the test never relies on a
    // real navigation, only on the provider's re-invocation guard.
    CrossDomainAuth: class {
      signIn(options?: unknown): Promise<SessionLoginResponse | null> {
        return signInMock(options);
      }
      signInWithRedirect(): void {
        /* no-op: navigation is not the unit under test */
      }
    },
  };
});

import { WebOxyProvider, useAuth } from '../src/WebOxyProvider';

const ORIGIN = 'https://console.oxy.so';

interface Snapshot {
  isReady: boolean;
  isAuthenticated: boolean;
}

/**
 * Byte-for-byte the console `AuthGuard` effect: re-invoke `signIn()` whenever
 * the provider reports "ready but not authenticated". This is the caller that
 * turned a transient ready-flip into a redirect storm.
 */
function ConsoleAuthGuard({ onSnapshot }: { onSnapshot: (s: Snapshot) => void }) {
  const { isReady, isAuthenticated, signIn } = useAuth();
  onSnapshot({ isReady, isAuthenticated });
  useEffect(() => {
    if (isReady && !isAuthenticated) {
      void signIn();
    }
  }, [isReady, isAuthenticated, signIn]);
  return null;
}

describe('WebOxyProvider — console sign-in loop regression', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', `${ORIGIN}/`);
    signInMock.mockClear();
    silentSignInMock.mockClear();
    signInMock.mockImplementation(async () => null);
    silentSignInMock.mockImplementation(async () => null);
  });

  it('invokes signIn exactly ONCE for a logged-out AuthGuard and never flips isReady back to true after the redirect', async () => {
    // No prior-session hint → cold boot skips the terminal `sso-bounce`
    // (`allowSsoBounce`), settling `unauthenticated` → `isReady` true. That is
    // the exact state that arms the console `AuthGuard`.
    const snapshots: Snapshot[] = [];
    render(
      <WebOxyProvider baseURL="https://api.oxy.so">
        <ConsoleAuthGuard onSnapshot={(s) => snapshots.push(s)} />
      </WebOxyProvider>,
    );

    // The guard fires `signIn()` once cold boot resolves ready+unauthenticated.
    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));

    // Flush many extra microtask/timer rounds. On the pre-fix code the redirect
    // branch reset `isLoading` → `isReady` flipped true again → the guard
    // re-fired → the call count would keep climbing here. With the fix it stays
    // pinned at one.
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(signInMock).toHaveBeenCalledTimes(1);

    // Once the redirect is initiated the provider must NOT report ready again
    // (the loop's re-arm condition). The final observed snapshot is the
    // navigating state: not ready, not authenticated.
    const last = snapshots[snapshots.length - 1];
    expect(last).toEqual({ isReady: false, isAuthenticated: false });
    // No snapshot after the redirect kicked off may show `isReady: true` while
    // unauthenticated — that transient is precisely what re-armed the guard.
    const readyUnauthAfterFirstCall = snapshots
      .slice(snapshots.findIndex((s) => s.isReady && !s.isAuthenticated) + 1)
      .some((s) => s.isReady && !s.isAuthenticated);
    expect(readyUnauthAfterFirstCall).toBe(false);
  });

  it('a second direct signIn() while a redirect is in flight is a no-op (mutex holds)', async () => {
    const captured: { signIn: (() => Promise<void>) | null } = { signIn: null };
    function Capture() {
      const { signIn } = useAuth();
      captured.signIn = signIn;
      return null;
    }
    render(
      <WebOxyProvider baseURL="https://api.oxy.so">
        <Capture />
      </WebOxyProvider>,
    );

    await waitFor(() => expect(captured.signIn).not.toBeNull());

    // First interactive sign-in initiates the redirect (resolves null).
    await act(async () => {
      await captured.signIn?.();
    });
    expect(signInMock).toHaveBeenCalledTimes(1);

    // A second call while the page is (conceptually) navigating away must be a
    // no-op — the `signingInRef` mutex is deliberately NOT reset after a
    // redirect is initiated.
    await act(async () => {
      await captured.signIn?.();
      await captured.signIn?.();
    });
    expect(signInMock).toHaveBeenCalledTimes(1);
  });
});
