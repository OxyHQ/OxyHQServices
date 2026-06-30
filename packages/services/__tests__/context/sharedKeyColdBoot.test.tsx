/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * Cold-boot `shared-key-signin` step (Workstream C1).
 *
 * A native sibling app (the Commons identity vault) can write a cross-app
 * shared identity into the device keychain; this provider then mints ITS session
 * from that shared key with no user interaction, via
 * `oxyServices.signInWithSharedIdentity()`. The cold-boot step that drives it is
 * inserted IMMEDIATELY AFTER `stored-session` and BEFORE the web-only probes,
 * and is NATIVE-ONLY (`enabled: () => !isWebBrowser() && !storedSessionRestored`).
 *
 * This pins the contract:
 *   1. NATIVE, no stored bearer: `stored-session` skips → `shared-key-signin`
 *      runs, mints a session, and the app becomes authenticated as the shared
 *      identity's user. No web step runs (no FedCM / cookie / bounce).
 *   2. NATIVE, valid stored bearer: `stored-session` WINS first →
 *      `signInWithSharedIdentity` is NEVER called (proving the step is AFTER
 *      stored-session and short-circuits behind it).
 *   3. WEB: the step is disabled (`!isWebBrowser()`), so
 *      `signInWithSharedIdentity` is NEVER called even though the stub exposes
 *      it — the web path / `WebOxyProvider` are entirely unaffected.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// `isWebBrowser` is module-mocked and TOGGLED per test so one file can attest
// both the native (steps run) and web (step disabled) behaviour. `useWebSSO` is
// stubbed to a no-op hook (it never runs on native; on web it must not perturb
// the cold-boot path under test).
let isWeb = false;
jest.mock('../../src/ui/hooks/useWebSSO', () => ({
  __esModule: true,
  isWebBrowser: () => isWeb,
  useWebSSO: () => ({
    checkSSO: async () => null,
    signInWithFedCM: async () => null,
    isChecking: false,
    isFedCMSupported: false,
  }),
}));

import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';

const API_BASE_URL = 'https://api.mention.earth';
const SESSION_IDS_KEY = 'oxy_session_session_ids';
const ACTIVE_SESSION_KEY = 'oxy_session_active_session_id';

const SHARED_USER_ID = 'user_shared_1';
const STORED_USER_ID = 'user_stored_1';

const sharedSession: SessionLoginResponse = {
  sessionId: 'sess_shared',
  deviceId: 'dev_shared',
  accessToken: 'shared.access.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: SHARED_USER_ID, username: 'shareduser' },
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
  signInWithSharedIdentity: () => Promise<SessionLoginResponse | null>;
  validUser?: string;
  initialAccessToken?: string | null;
}

function buildStub(cfg: StubConfig) {
  const signInWithSharedIdentitySpy = jest.fn(cfg.signInWithSharedIdentity);
  const silentSignInWithFedCMSpy = jest.fn(async () => null);
  const silentSignInSpy = jest.fn(async () => null);
  const refreshAllSessionsSpy = jest.fn(async () => ({ accounts: [] as unknown[] }));
  const validateSessionSpy = jest.fn(async () => ({
    valid: true,
    user: { id: cfg.validUser ?? STORED_USER_ID, username: 'storeduser' },
  }));
  return {
    signInWithSharedIdentitySpy,
    silentSignInWithFedCMSpy,
    silentSignInSpy,
    refreshAllSessionsSpy,
    validateSessionSpy,
    stub: {
      config: { authWebUrl: 'https://auth.oxy.so' },
      httpService: { setTokens: jest.fn() },
      getBaseURL: () => API_BASE_URL,
      getSessionBaseUrl: () => API_BASE_URL,
      getAccessToken: jest.fn(() => cfg.initialAccessToken ?? null),
      onTokensChanged: () => () => undefined,
      setTokens: jest.fn(),
      clearTokens: jest.fn(),
      clearCache: jest.fn(),
      isFedCMSupported: jest.fn(() => false),
      handleAuthCallback: jest.fn(() => null),
      signInWithSharedIdentity: signInWithSharedIdentitySpy,
      silentSignInWithFedCM: silentSignInWithFedCMSpy,
      silentSignIn: silentSignInSpy,
      refreshAllSessions: refreshAllSessionsSpy,
      exchangeSsoCode: jest.fn(async () => null),
      generateSsoState: jest.fn(() => 'state-token-xyz'),
      validateSession: validateSessionSpy,
      refreshTokenViaCookie: jest.fn(async () => null),
      getCurrentUser: jest.fn(async (): Promise<User> => ({ id: SHARED_USER_ID, username: 'shareduser' } as User)),
      getUserBySession: jest.fn(async (): Promise<User> => ({ id: cfg.validUser ?? STORED_USER_ID, username: 'storeduser' } as User)),
      getSessionsBySessionId: jest.fn(async () => []),
      getUserSessions: jest.fn(async () => []),
      getDeviceSessions: jest.fn(async () => []),
      listAccounts: jest.fn(async () => []),
    },
  };
}

function renderProvider(oxyServices: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OxyContextProvider oxyServices={oxyServices as never} baseURL={API_BASE_URL}>
        <Capture />
      </OxyContextProvider>
    </QueryClientProvider>,
  );
}

describe('Cold-boot shared-key-signin step', () => {
  let ssoNavigateSpy: jest.SpyInstance;
  let getSharedSessionSpy: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    isWeb = false;
    captured = { isAuthenticated: false, userId: undefined };
    useAuthStore.getState().logout();
    ssoNavigateSpy = jest.spyOn(oxyCore, 'ssoNavigate').mockImplementation(() => undefined);
    // No durable shared SecureStore session — force the stored-session step to
    // fall through to `shared-key-signin` (when there are no stored ids).
    getSharedSessionSpy = jest
      .spyOn(oxyCore.KeyManager, 'getSharedSession')
      .mockResolvedValue(null);
  });

  afterEach(() => {
    ssoNavigateSpy.mockRestore();
    getSharedSessionSpy.mockRestore();
  });

  it('NATIVE + no stored bearer: stored-session skips, shared-key-signin mints the session', async () => {
    const { stub, signInWithSharedIdentitySpy, validateSessionSpy, silentSignInWithFedCMSpy, refreshAllSessionsSpy } =
      buildStub({ signInWithSharedIdentity: async () => sharedSession });

    renderProvider(stub);

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(SHARED_USER_ID);

    // The shared-key step won.
    expect(signInWithSharedIdentitySpy).toHaveBeenCalledTimes(1);
    // No stored ids → the stored-session step never validated a bearer.
    expect(validateSessionSpy).not.toHaveBeenCalled();
    // No web step ran on native, and no central SSO bounce.
    expect(silentSignInWithFedCMSpy).not.toHaveBeenCalled();
    expect(refreshAllSessionsSpy).not.toHaveBeenCalled();
    expect(ssoNavigateSpy).not.toHaveBeenCalled();
  });

  it('NATIVE + valid stored bearer: stored-session wins; shared-key-signin is never reached', async () => {
    // Seed a durable stored session so `stored-session` (which runs FIRST) wins
    // and short-circuits the cold boot before `shared-key-signin` is evaluated.
    window.localStorage.setItem(SESSION_IDS_KEY, JSON.stringify(['sess_stored']));
    window.localStorage.setItem(ACTIVE_SESSION_KEY, 'sess_stored');

    const { stub, signInWithSharedIdentitySpy, validateSessionSpy } = buildStub({
      signInWithSharedIdentity: async () => sharedSession,
      validUser: STORED_USER_ID,
    });

    renderProvider(stub);

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(STORED_USER_ID);

    expect(validateSessionSpy).toHaveBeenCalled();
    // shared-key sits AFTER stored-session — once stored-session wins it never runs.
    expect(signInWithSharedIdentitySpy).not.toHaveBeenCalled();
  });

  it('WEB: shared-key-signin is disabled, so signInWithSharedIdentity is never called', async () => {
    isWeb = true;
    // A valid stored session lets `stored-session` win on web too, so the cold
    // boot never reaches the terminal SSO bounce — keeping the assertion focused
    // purely on the native-only gate.
    window.localStorage.setItem(SESSION_IDS_KEY, JSON.stringify(['sess_stored']));
    window.localStorage.setItem(ACTIVE_SESSION_KEY, 'sess_stored');

    const { stub, signInWithSharedIdentitySpy } = buildStub({
      signInWithSharedIdentity: async () => sharedSession,
      validUser: STORED_USER_ID,
      initialAccessToken: 'stored.web.token',
    });

    renderProvider(stub);

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe(STORED_USER_ID);

    // Native-only step: never invoked on web.
    expect(signInWithSharedIdentitySpy).not.toHaveBeenCalled();
    expect(ssoNavigateSpy).not.toHaveBeenCalled();
  });
});
