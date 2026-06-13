/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * NATIVE cold-boot attestation.
 *
 * On React Native `isWebBrowser()` is false (no DOM). The cold-boot sequence
 * MUST therefore run ONLY the `stored-session` step — every web-only step
 * (`redirect`, `fedcm-silent`, `silent-iframe`, `cookie-restore`) is disabled.
 * This test forces the native branch by mocking `isWebBrowser` → false and
 * asserts:
 *
 *   - `validateSession` (the stored-session bearer path) IS called.
 *   - NONE of `handleAuthCallback` / `silentSignInWithFedCM` / `silentSignIn` /
 *     `refreshAllSessions` are EVER called.
 *
 * The jsdom URL is irrelevant here — the mock, not the environment, decides the
 * platform.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Force the NATIVE branch: `isWebBrowser()` is false everywhere it is consumed
// (OxyContext, useSessionManagement, useAuthOperations all import it from here).
// `useWebSSO` is stubbed to a no-op hook — on native it never runs anyway, and
// stubbing it (rather than `jest.requireActual`) avoids loading a duplicate
// module copy whose side effects perturbed storage initialization in the
// provider under test.
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
import type { User } from '@oxyhq/core';
import { useAuthStore } from '../../src/ui/stores/authStore';

const API_BASE_URL = 'https://api.mention.earth';
const STORED_SESSION_ID = 'sess_stored_native';
const STORED_USER_ID = 'user_native_1';
const SESSION_IDS_KEY = 'oxy_session_session_ids';
const ACTIVE_SESSION_KEY = 'oxy_session_active_session_id';

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

const handleAuthCallbackSpy = jest.fn(() => null);
const silentSignInWithFedCMSpy = jest.fn(async () => null);
const silentSignInSpy = jest.fn(async () => null);
const refreshAllSessionsSpy = jest.fn(async () => ({ accounts: [] as unknown[] }));
const validateSessionSpy = jest.fn(async () => ({
  valid: true,
  user: { id: STORED_USER_ID, username: 'nativeuser' },
}));

function buildStub() {
  return {
    config: {},
    httpService: { setTokens: jest.fn() },
    getBaseURL: () => API_BASE_URL,
    getSessionBaseUrl: () => API_BASE_URL,
    getAccessToken: () => null,
    onTokensChanged: () => () => undefined,
    setTokens: jest.fn(),
    clearTokens: jest.fn(),
    clearCache: jest.fn(),
    isFedCMSupported: jest.fn(() => false),
    handleAuthCallback: handleAuthCallbackSpy,
    silentSignInWithFedCM: silentSignInWithFedCMSpy,
    silentSignIn: silentSignInSpy,
    refreshAllSessions: refreshAllSessionsSpy,
    validateSession: validateSessionSpy,
    // `switchSession` in session-management calls `getTokenBySession` +
    // `validateSession` again; provide them.
    getTokenBySession: jest.fn(async () => 'native.token'),
    getUserBySession: jest.fn(async (): Promise<User> => ({ id: STORED_USER_ID, username: 'nativeuser' } as User)),
    getCurrentUser: jest.fn(async (): Promise<User> => ({ id: STORED_USER_ID, username: 'nativeuser' } as User)),
    getSessionsBySessionId: jest.fn(async () => []),
    getUserSessions: jest.fn(async () => []),
    setActingAs: jest.fn(),
    getManagedAccounts: jest.fn(async () => []),
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

describe('Native cold boot runs ONLY the stored-session step', () => {
  beforeEach(() => {
    window.localStorage.clear();
    captured = { isAuthenticated: false, userId: undefined, isTokenReady: false };
    handleAuthCallbackSpy.mockClear();
    silentSignInWithFedCMSpy.mockClear();
    silentSignInSpy.mockClear();
    refreshAllSessionsSpy.mockClear();
    validateSessionSpy.mockClear();
    useAuthStore.getState().logout();
    // Seed a durable stored session so the stored-session step has work to do.
    window.localStorage.setItem(SESSION_IDS_KEY, JSON.stringify([STORED_SESSION_ID]));
    window.localStorage.setItem(ACTIVE_SESSION_KEY, STORED_SESSION_ID);
  });

  it('validates the stored session and never touches any web step', async () => {
    const stub = buildStub();

    renderProvider(stub);

    // The native bearer path runs the stored-session validation. Wait on THAT
    // (not `isTokenReady`, which starts true) so the assertion fires only after
    // cold boot has executed.
    await waitFor(() => expect(validateSessionSpy).toHaveBeenCalled());

    // NONE of the web-only steps were ever invoked.
    expect(handleAuthCallbackSpy).not.toHaveBeenCalled();
    expect(silentSignInWithFedCMSpy).not.toHaveBeenCalled();
    expect(silentSignInSpy).not.toHaveBeenCalled();
    expect(refreshAllSessionsSpy).not.toHaveBeenCalled();
  });
});
