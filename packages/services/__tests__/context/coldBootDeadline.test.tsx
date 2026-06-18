/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * Cold-boot HARD OVERALL DEADLINE — production-hang regression.
 *
 * A cold-boot step whose `run()` promise NEVER settles (the production
 * `navigator.credentials.get()` that ignored its abort signal) must NOT be able
 * to hang the whole cold boot forever. `runColdBoot` is given an
 * `overallDeadlineMs` (`COLD_BOOT_OVERALL_DEADLINE`) in `OxyContext`: when a step
 * exceeds it, the runner abandons that step, falls through to the terminal
 * `sso-bounce` (whose navigation side effect runs synchronously, so the
 * cross-domain fallback is preserved), and the restore `finally` flips the
 * auth-resolution gate so the user never sits on an indefinite spinner.
 *
 * This test lives in its OWN file (its own Jest module registry) because it
 * drives fake timers against a never-settling promise — keeping it isolated
 * prevents that state from leaking into the order-contract suite.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';

const BASE_URL = 'https://api.mention.earth/case-hang';
const USER_ID = 'hang_user_1';

interface CapturedState {
  isAuthResolved: boolean;
  isTokenReady: boolean;
  isAuthenticated: boolean;
}

let captured: CapturedState = { isAuthResolved: false, isTokenReady: false, isAuthenticated: false };

function Capture() {
  const { isAuthResolved, isTokenReady, isAuthenticated } = useOxy();
  captured = { isAuthResolved, isTokenReady, isAuthenticated };
  return null;
}

function buildHangingStub() {
  return {
    config: { authWebUrl: 'https://auth.oxy.so' },
    httpService: { setTokens: jest.fn() },
    getBaseURL: () => BASE_URL,
    getSessionBaseUrl: () => BASE_URL,
    getAccessToken: () => null,
    onTokensChanged: () => () => undefined,
    setTokens: jest.fn(),
    clearTokens: jest.fn(),
    clearCache: jest.fn(),
    // FedCM supported + no stored session → the chain reaches `fedcm-silent`.
    isFedCMSupported: jest.fn(() => true),
    handleAuthCallback: jest.fn(() => null),
    // The production hang: the FedCM-silent step's promise NEVER settles.
    silentSignInWithFedCM: jest.fn(() => new Promise<SessionLoginResponse | null>(() => {})),
    silentSignIn: jest.fn(async () => null),
    refreshAllSessions: jest.fn(async () => ({ accounts: [] as unknown[] })),
    generateSsoState: jest.fn(() => 'state-token-hang'),
    exchangeSsoCode: jest.fn(async () => null),
    getCurrentUser: jest.fn(async (): Promise<User> => ({ id: USER_ID, username: 't' } as User)),
    validateSession: jest.fn(async () => ({ valid: true, user: { id: USER_ID, username: 't' } })),
    getDeviceSessions: jest.fn(async () => []),
    getSessionsBySessionId: jest.fn(async () => []),
    getUserBySession: jest.fn(async (): Promise<User> => ({ id: USER_ID, username: 't' } as User)),
    refreshTokenViaCookie: jest.fn(async () => null),
    setActingAs: jest.fn(),
    getManagedAccounts: jest.fn(async () => []),
  };
}

describe('Cold-boot overall deadline (production hang regression)', () => {
  let assignSpy: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    captured = { isAuthResolved: false, isTokenReady: false, isAuthenticated: false };
    useAuthStore.getState().logout();
    assignSpy = jest.spyOn(oxyCore, 'ssoNavigate').mockImplementation(() => undefined);
  });

  afterEach(() => {
    assignSpy.mockRestore();
  });

  it('a never-settling fedcm-silent step cannot hang cold boot — the deadline trips, the terminal /sso bounce still fires, and auth resolves', async () => {
    jest.useFakeTimers();
    try {
      const stub = buildHangingStub();
      // Seed a login hint so `silentSignInWithFedCM` would NOT fast-skip
      // (mirrors a real associated browser); the stub itself models the hang.
      window.localStorage.setItem('oxy_fedcm_login_hint', 'prior-user');

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <OxyContextProvider oxyServices={stub as never} baseURL={BASE_URL}>
            <Capture />
          </OxyContextProvider>
        </QueryClientProvider>,
      );

      // Drain storage-init + the early cold-boot steps so the chain reaches the
      // hung `fedcm-silent` step. The deferred + several awaits resolve across
      // multiple event-loop turns; advance in small slices until it is in flight.
      for (let i = 0; i < 20 && (stub.silentSignInWithFedCM as jest.Mock).mock.calls.length === 0; i++) {
        await jest.advanceTimersByTimeAsync(50);
      }

      // The hung step is in flight; nothing has resolved yet (auth undetermined).
      expect(stub.silentSignInWithFedCM).toHaveBeenCalledTimes(1);
      expect(assignSpy).not.toHaveBeenCalled();
      expect(captured.isAuthResolved).toBe(false);

      // Advance past the 20s overall cold-boot deadline. The runner abandons the
      // hung step, falls through to the terminal `sso-bounce` (synchronous
      // navigation), and the `finally` backstop flips the auth-resolution gate.
      await jest.advanceTimersByTimeAsync(21000);

      // Cross-domain fallback preserved: the terminal bounce fired once.
      expect(assignSpy).toHaveBeenCalledTimes(1);
      const assigned = new URL(assignSpy.mock.calls[0][0] as string);
      expect(assigned.origin).toBe('https://auth.oxy.so');
      expect(assigned.pathname).toBe('/sso');

      // Auth resolution is no longer stuck — the gate flipped (no indefinite spinner).
      expect(captured.isAuthResolved).toBe(true);
      expect(captured.isTokenReady).toBe(true);
      expect(captured.isAuthenticated).toBe(false);
    } finally {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    }
  });
});
