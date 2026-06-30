/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * `useOxy().signInWithPassword` on a CROSS-APEX web RP (apex ≠ oxy.so).
 *
 * A direct password sign-in mints a bearer against the Oxy API but establishes
 * no `fedcm_session`, so the session would be lost on reload. On a cross-apex RP
 * the SDK MUST refuse it (throwing `CrossApexDirectSignInError`) instead of
 * silently completing a non-durable sign-in, and MUST NOT call
 * `oxyServices.signIn`. The user is expected to use the durable "Continue with
 * Oxy" IdP popup instead.
 *
 * The same-apex (`accounts.oxy.so`) success path is covered by
 * `signInWithPassword.test.tsx`; this file pins the host to a cross-apex apex via
 * the `@jest-environment-options` docblock so the real `isCrossApexWeb()` gate
 * evaluates true.
 */

import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Force the NATIVE cold-boot branch so the provider resolves quickly to
// unauthenticated without running web SSO machinery. The cross-apex gate under
// test keys on `window.location.hostname` (the docblock URL), not on this flag,
// so it still trips on `app.mention.earth`.
jest.mock('../../src/ui/hooks/useWebSSO', () => ({
  __esModule: true,
  isWebBrowser: () => false,
  useWebSSO: () => ({
    checkSSO: async () => null,
    signInWithFedCM: async () => null,
    isChecking: false,
    isFedCMSupported: false,
  }),
}));

import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { OxyContextState } from '../../src/ui/context/OxyContext';
import { CrossApexDirectSignInError } from '../../src/utils/crossApex';
import { useAuthStore } from '../../src/ui/stores/authStore';
import * as oxyCore from '@oxyhq/core';

const API_BASE_URL = 'https://api.oxy.so';

let capturedContext: OxyContextState | null = null;

function Capture() {
  capturedContext = useOxy();
  return null;
}

const signInSpy = jest.fn(async () => ({ sessionId: 's', user: { id: 'u' } }));

const stub = {
  config: {},
  httpService: { setTokens: jest.fn() },
  getBaseURL: () => API_BASE_URL,
  getSessionBaseUrl: () => API_BASE_URL,
  getAccessToken: jest.fn(() => null),
  onTokensChanged: () => () => undefined,
  setTokens: jest.fn(),
  clearTokens: jest.fn(),
  clearCache: jest.fn(),
  isFedCMSupported: jest.fn(() => false),
  signIn: signInSpy,
  validateSession: jest.fn(async () => ({ valid: false })),
  getCurrentUser: jest.fn(async () => ({ id: 'u', username: 'u' })),
  getSessionsBySessionId: jest.fn(async () => []),
  getUserSessions: jest.fn(async () => []),
  getDeviceSessions: jest.fn(async () => []),
  setActingAs: jest.fn(),
  listAccounts: jest.fn(async () => []),
};

function renderProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OxyContextProvider oxyServices={stub as never} baseURL={API_BASE_URL}>
        <Capture />
      </OxyContextProvider>
    </QueryClientProvider>,
  );
}

describe('useOxy().signInWithPassword on a cross-apex RP', () => {
  let getSharedSessionSpy: jest.SpyInstance;

  beforeEach(() => {
    window.localStorage.clear();
    capturedContext = null;
    signInSpy.mockClear();
    useAuthStore.getState().logout();
    getSharedSessionSpy = jest
      .spyOn(oxyCore.KeyManager, 'getSharedSession')
      .mockResolvedValue(null);
  });

  afterEach(() => {
    getSharedSessionSpy.mockRestore();
  });

  it('rejects with CrossApexDirectSignInError and never calls oxyServices.signIn', async () => {
    renderProvider();

    await waitFor(() => expect(capturedContext?.isAuthResolved).toBe(true));

    let thrown: unknown;
    await act(async () => {
      try {
        await capturedContext?.signInWithPassword('pwuser', 'hunter2');
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeInstanceOf(CrossApexDirectSignInError);
    expect(signInSpy).not.toHaveBeenCalled();
    expect(capturedContext?.isAuthenticated).toBe(false);
  });
});
