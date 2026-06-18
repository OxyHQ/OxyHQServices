/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * Regression: a successful web sign-in MUST persist its session
 * into the multi-session store (`oxy_session_session_ids` + the active-session
 * key) so the session survives a page reload and cross-app SSO can see it.
 *
 * The accounts web app previously signed users in fine but, on reload, had no
 * session to restore — `oxy_session_session_ids` was empty. Root cause:
 * `handleWebSession` / `handleWebSSOSession` guarded its storage write on the
 * `storage` React state, which is `null` for a brief window after mount while
 * `createPlatformStorage()` resolves. A sign-in firing inside that window (e.g.
 * an interactive sign-in tapped the instant the screen mounts) silently skipped
 * persistence. The provider now awaits a ready-storage promise, so persistence
 * is never dropped because it raced storage init.
 *
 * CASE A: storage already ready  → persists.
 * CASE B: sign-in fires before storage state populates → STILL persists (the fix).
 * CASE C: returning user whose stale session fails validation (restore clears
 *         the store to []), then a fresh FedCM sign-in → re-persists.
 * CASE D: the durable write happens BEFORE the profile fetch / auth-state-change
 *         tail. So even if `getCurrentUser` rejects (and we fall back to the
 *         minimal session user) the session id is STILL persisted. This guards
 *         the ordering fix: persistence must not depend on the post-navigation
 *         tail running. In production the `onAuthStateChange` callback triggers
 *         a route navigation that can interrupt the still-pending write if
 *         persistence ran last — moving it first is what makes it reliable.
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import type { SessionLoginResponse } from '@oxyhq/core';

const SESSION_IDS_KEY = 'oxy_session_session_ids';
const ACTIVE_SESSION_KEY = 'oxy_session_active_session_id';

// Exact server response shape from POST /fedcm/exchange (note: no refreshToken).
const FEDCM_SESSION: SessionLoginResponse = {
  sessionId: 'sess_fedcm_1',
  deviceId: 'dev_fedcm_1',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  user: { id: 'user_123', username: 'tester' },
  accessToken: 'header.payload.sig',
} as SessionLoginResponse;

let capturedHandleWebSession: ((s: SessionLoginResponse) => Promise<void>) | null = null;
let capturedStorageReady = false;

function Capture() {
  const { handleWebSession, isStorageReady } = useOxy();
  capturedHandleWebSession = handleWebSession;
  capturedStorageReady = isStorageReady;
  return null;
}

function baseStub() {
  return {
    config: { authWebUrl: 'https://auth.oxy.so' },
    httpService: { setTokens: jest.fn() },
    getBaseURL: () => 'https://api.oxy.so',
    getAccessToken: () => 'header.payload.sig',
    onTokensChanged: () => () => undefined,
    setTokens: jest.fn(),
    clearTokens: jest.fn(),
    clearCache: jest.fn(),
    // Disable FedCM so the provider's auto silent-SSO does not fire; these tests
    // drive the persistence path explicitly via handleWebSession.
    isFedCMSupported: () => false,
    getCurrentUser: jest.fn(async () => ({ id: 'user_123', username: 'tester' })),
    validateSession: jest.fn(async () => ({
      valid: true,
      user: { id: 'user_123', username: 'tester' },
    })),
    setActingAs: jest.fn(),
    getManagedAccounts: jest.fn(async () => []),
  };
}

function renderProvider(oxyServices: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OxyContextProvider oxyServices={oxyServices as never} baseURL="https://api.oxy.so">
        <Capture />
      </OxyContextProvider>
    </QueryClientProvider>,
  );
}

describe('web session persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    capturedHandleWebSession = null;
    capturedStorageReady = false;
  });

  it('CASE A: persists the session id + active id when storage is ready', async () => {
    renderProvider(baseStub());
    await waitFor(() => expect(capturedHandleWebSession).not.toBeNull());
    await waitFor(() => expect(capturedStorageReady).toBe(true));

    await act(async () => {
      await capturedHandleWebSession!(FEDCM_SESSION);
    });

    expect(window.localStorage.getItem(SESSION_IDS_KEY)).toBe(JSON.stringify(['sess_fedcm_1']));
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBe('sess_fedcm_1');
  });

  it('CASE B: persists even when sign-in fires BEFORE storage state populates', async () => {
    renderProvider(baseStub());
    await waitFor(() => expect(capturedHandleWebSession).not.toBeNull());
    // Intentionally do NOT wait for storage to be ready — race storage init.
    await act(async () => {
      await capturedHandleWebSession!(FEDCM_SESSION);
    });

    expect(window.localStorage.getItem(SESSION_IDS_KEY)).toBe(JSON.stringify(['sess_fedcm_1']));
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBe('sess_fedcm_1');
  });

  it('CASE C: re-persists after a stale session is cleared by restore', async () => {
    // Returning user with a stale session id on disk.
    window.localStorage.setItem(SESSION_IDS_KEY, JSON.stringify(['stale_sess']));
    window.localStorage.setItem(ACTIVE_SESSION_KEY, 'stale_sess');

    const stub = baseStub();
    stub.validateSession = jest.fn(async (sessionId: string) => {
      if (sessionId === 'stale_sess') {
        const err = new Error('Session not found') as Error & { status?: number };
        err.status = 401;
        throw err;
      }
      return { valid: true, user: { id: 'user_123', username: 'tester' } };
    }) as never;

    renderProvider(stub);
    await waitFor(() => expect(capturedHandleWebSession).not.toBeNull());
    await waitFor(() => expect(capturedStorageReady).toBe(true));

    // Restore validates the stale id, fails, and clears the store to [].
    await waitFor(() => {
      const raw = window.localStorage.getItem(SESSION_IDS_KEY);
      expect(raw === JSON.stringify([]) || raw === null).toBe(true);
    });

    // A fresh FedCM sign-in must repopulate the store.
    await act(async () => {
      await capturedHandleWebSession!(FEDCM_SESSION);
    });

    expect(window.localStorage.getItem(SESSION_IDS_KEY)).toBe(JSON.stringify(['sess_fedcm_1']));
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBe('sess_fedcm_1');
  });

  it('CASE D: persists even when the profile fetch (post-write tail) rejects', async () => {
    // getCurrentUser rejecting models the navigation/teardown tail failing or
    // being interrupted right after the durable write. Because persistence now
    // runs BEFORE getCurrentUser/loginSuccess/onAuthStateChange, the session id
    // must already be on disk regardless of what the tail does.
    const stub = baseStub();
    stub.getCurrentUser = jest.fn(async () => {
      throw new Error('network down during profile fetch');
    });
    // onAuthStateChange throwing simulates a navigation side effect that tears
    // down before the (now-earlier) write could have completed if it ran last.
    const onAuthStateChange = jest.fn(() => {
      throw new Error('navigated away / teardown');
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OxyContextProvider
          oxyServices={stub as never}
          baseURL="https://api.oxy.so"
          onAuthStateChange={onAuthStateChange}
        >
          <Capture />
        </OxyContextProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(capturedHandleWebSession).not.toBeNull());
    await waitFor(() => expect(capturedStorageReady).toBe(true));

    // The handler itself may reject because onAuthStateChange throws in the tail;
    // that is fine — the durable write already happened earlier in the function.
    await act(async () => {
      await capturedHandleWebSession!(FEDCM_SESSION).catch(() => undefined);
    });

    expect(window.localStorage.getItem(SESSION_IDS_KEY)).toBe(JSON.stringify(['sess_fedcm_1']));
    expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBe('sess_fedcm_1');
  });
});
