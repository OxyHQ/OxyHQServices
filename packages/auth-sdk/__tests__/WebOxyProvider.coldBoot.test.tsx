/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * Cold-boot orchestration for `WebOxyProvider`.
 *
 * The provider drives session recovery through `runColdBoot` (from
 * `@oxyhq/core`) with three ordered steps — `redirect`, `fedcm-silent`,
 * `cookie`. These tests pin the contract that was previously hand-rolled in an
 * imperative `useEffect`:
 *
 *   1. The first step that yields a real session wins; later steps never run.
 *   2. `redirect` / `cookie` MUST hydrate a real user (non-empty id) before
 *      committing — a placeholder user is never exposed (R4 fix).
 *   3. The composite silent step fires AT MOST ONCE per page load, keyed on
 *      `origin|baseURL`, surviving provider remounts.
 *   4. Two providers on the SAME origin but DIFFERENT API base URLs each get
 *      their own one-shot silent budget.
 *
 * `@oxyhq/core` is mocked so the orchestration can be observed deterministically
 * while the REAL `runColdBoot`, `autoDetectAuthWebUrl`, and `logger` run.
 *
 * The silent-SSO run-once guard inside `WebOxyProvider` is module-level and
 * intentionally never cleared (only a fresh page load resets it). The guard is
 * keyed on `origin|baseURL`; the jsdom origin is fixed for the whole file, so
 * each test uses a UNIQUE `baseURL` to get an independent guard budget — except
 * the run-once tests, which deliberately reuse one key to prove deduplication.
 */

import { render, waitFor } from '@testing-library/react';
import type { SessionLoginResponse, User } from '@oxyhq/core';

// ---------------------------------------------------------------------------
// Controllable @oxyhq/core mock.
//
// `runColdBoot`, `autoDetectAuthWebUrl`, and `logger` come from the REAL module
// so the orchestration under test is exercised end-to-end. Only the
// service/auth surfaces are stubbed. `stubs.baseURL` is read by the mocked
// `OxyServices.getBaseURL()` so the run-once guard key tracks the active test.
// ---------------------------------------------------------------------------

interface CoreStubs {
  getCurrentUser: jest.Mock<Promise<User | null>, []>;
  handleRedirectCallback: jest.Mock<SessionLoginResponse | null, []>;
  silentSignIn: jest.Mock<Promise<SessionLoginResponse | null>, []>;
  managerInitialize: jest.Mock<Promise<User | null>, []>;
  getActiveAccount: jest.Mock<{ sessionId: string } | null, []>;
  baseURL: string;
}

const stubs: CoreStubs = {
  getCurrentUser: jest.fn(async () => null),
  handleRedirectCallback: jest.fn(() => null),
  silentSignIn: jest.fn(async () => null),
  managerInitialize: jest.fn(async () => null),
  getActiveAccount: jest.fn(() => null),
  baseURL: 'https://api.oxy.so',
};

function resetStubs(baseURL: string): void {
  stubs.getCurrentUser = jest.fn(async () => null);
  stubs.handleRedirectCallback = jest.fn(() => null);
  stubs.silentSignIn = jest.fn(async () => null);
  stubs.managerInitialize = jest.fn(async () => null);
  stubs.getActiveAccount = jest.fn(() => null);
  stubs.baseURL = baseURL;
}

jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return {
    __esModule: true,
    // Real cold-boot primitives + helpers.
    runColdBoot: actual.runColdBoot,
    autoDetectAuthWebUrl: actual.autoDetectAuthWebUrl,
    logger: actual.logger,
    // Stubbed service / auth surfaces.
    OxyServices: class {
      getBaseURL(): string {
        return stubs.baseURL;
      }
      getCurrentUser(): Promise<User | null> {
        return stubs.getCurrentUser();
      }
    },
    CrossDomainAuth: class {
      handleRedirectCallback(): SessionLoginResponse | null {
        return stubs.handleRedirectCallback();
      }
      silentSignIn(): Promise<SessionLoginResponse | null> {
        return stubs.silentSignIn();
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

// Import AFTER the mock is registered.
import { WebOxyProvider, useAuth } from '../src/WebOxyProvider';

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

/** Probe component that surfaces the resolved auth state for assertions. */
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

describe('WebOxyProvider cold boot', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('1) redirect step wins and short-circuits later steps', async () => {
    resetStubs('https://api.test-1');
    stubs.handleRedirectCallback.mockReturnValue(makeSession({ id: '', username: '' }));
    stubs.getCurrentUser.mockResolvedValue(realUser);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(true));
    expect(latest.userId).toBe('u1');
    // Later steps must never run once redirect wins.
    expect(stubs.silentSignIn).not.toHaveBeenCalled();
    expect(stubs.managerInitialize).not.toHaveBeenCalled();
  });

  it('2) redirect returns skip (NOT a placeholder session) when hydration fails — R4', async () => {
    resetStubs('https://api.test-2');
    // Placeholder user from handleAuthCallback; getCurrentUser throws.
    stubs.handleRedirectCallback.mockReturnValue(makeSession({ id: '', username: '' }));
    stubs.getCurrentUser.mockRejectedValue(new Error('bearer rejected'));
    // No fallback session anywhere.
    stubs.silentSignIn.mockResolvedValue(null);
    stubs.managerInitialize.mockResolvedValue(null);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isLoading).toBe(false));
    // A placeholder session must NEVER be committed.
    expect(latest.isAuthenticated).toBe(false);
    expect(latest.userId).toBeNull();
    // Falls through to later steps.
    expect(stubs.silentSignIn).toHaveBeenCalledTimes(1);
    expect(stubs.managerInitialize).toHaveBeenCalledTimes(1);
  });

  it('3) fedcm-silent step wins when redirect skips (carries real user)', async () => {
    resetStubs('https://api.test-3');
    stubs.handleRedirectCallback.mockReturnValue(null);
    stubs.silentSignIn.mockResolvedValue(makeSession({ id: 'u1', username: 'tester' }));

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(true));
    expect(latest.userId).toBe('u1');
    // Cookie step must not run once silent wins.
    expect(stubs.managerInitialize).not.toHaveBeenCalled();
  });

  it('4) cookie step hydrates a real user and commits when prior steps skip', async () => {
    resetStubs('https://api.test-4');
    stubs.handleRedirectCallback.mockReturnValue(null);
    stubs.silentSignIn.mockResolvedValue(null);
    stubs.managerInitialize.mockResolvedValue(realUser);
    stubs.getActiveAccount.mockReturnValue({ sessionId: 'sess_cookie' });
    stubs.getCurrentUser.mockResolvedValue(realUser);

    let latest: ProbeState = { isAuthenticated: false, userId: null, isLoading: true };
    renderProvider(stubs.baseURL, (s) => { latest = s; });

    await waitFor(() => expect(latest.isAuthenticated).toBe(true));
    expect(latest.userId).toBe('u1');
  });

  it('5) silent step fires AT MOST ONCE across remounts (origin|baseURL run-once guard)', async () => {
    resetStubs('https://api.test-5');
    stubs.handleRedirectCallback.mockReturnValue(null);
    stubs.silentSignIn.mockResolvedValue(null);
    stubs.managerInitialize.mockResolvedValue(null);

    const first = renderProvider(stubs.baseURL, () => undefined);
    await waitFor(() => expect(stubs.silentSignIn).toHaveBeenCalledTimes(1));
    first.unmount();

    for (let i = 0; i < 5; i++) {
      const r = renderProvider(stubs.baseURL, () => undefined);
      r.unmount();
    }
    // Still exactly one silent attempt for this origin|baseURL.
    expect(stubs.silentSignIn).toHaveBeenCalledTimes(1);
  });

  it('6) same origin + DIFFERENT baseURL each get their own silent budget', async () => {
    resetStubs('https://api.test-6-alpha');
    stubs.handleRedirectCallback.mockReturnValue(null);
    stubs.silentSignIn.mockResolvedValue(null);
    stubs.managerInitialize.mockResolvedValue(null);

    // First provider: baseURL alpha.
    const a = renderProvider('https://api.test-6-alpha', () => undefined);
    await waitFor(() => expect(stubs.silentSignIn).toHaveBeenCalledTimes(1));
    a.unmount();

    // Second provider, SAME origin (jsdom url is fixed) but DIFFERENT baseURL.
    stubs.baseURL = 'https://api.test-6-beta';
    const b = renderProvider('https://api.test-6-beta', () => undefined);
    // A distinct origin|baseURL signature → a second silent attempt is allowed.
    await waitFor(() => expect(stubs.silentSignIn).toHaveBeenCalledTimes(2));
    b.unmount();
  });
});
