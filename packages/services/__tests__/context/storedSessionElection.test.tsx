/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * P0 REGRESSION — stored-session cold-boot self-heal.
 *
 * `restoreStoredSession` used to (a) BAIL before any network validation on web
 * whenever the local `activeSessionId` OR the (now-deleted) `activeAuthuser`
 * marker was missing, and (b) never elect a replacement active session when the
 * stored active id was absent or rejected. Post-cutover nothing writes the
 * `activeAuthuser` marker and the server owns the active account, so those local
 * markers are only fast-path hints — a missing/stale hint must NOT strand valid
 * sessions on the sign-in screen. See the guard + election in
 * `OxyContext.restoreStoredSession`.
 *
 * These tests drive the REAL token-acquisition ladder against a controllable
 * `oxyServices` stub (mirrors `coldBootOrder.test.tsx`) and mock
 * `createSessionClient` (mirrors `coldBootSessionClient.test.tsx`) so the
 * post-ladder handoff is inert and the assertions reflect `restoreStoredSession`
 * alone. Each test uses a UNIQUE `baseURL` so the module-level silent-SSO
 * run-once guard from a prior test does not pre-disable this one.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionLoginResponse, User } from '@oxyhq/core';
import * as oxyCore from '@oxyhq/core';

jest.mock('../../src/ui/session', () => {
  const actual = jest.requireActual('../../src/ui/session');
  return { ...actual, createSessionClient: jest.fn() };
});

import { OxyContextProvider, useOxy } from '../../src/ui/context/OxyContext';
import { useAuthStore } from '../../src/ui/stores/authStore';
import { createSessionClient } from '../../src/ui/session';

const mockedCreateSessionClient = createSessionClient as jest.MockedFunction<typeof createSessionClient>;

const ACTIVE_SESSION_KEY = 'oxy_session_active_session_id';
const SESSION_IDS_KEY = 'oxy_session_session_ids';

const silentSession: SessionLoginResponse = {
  sessionId: 'sess_silent',
  deviceId: 'dev_silent',
  accessToken: 'silent.access.token',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: 'silent_user', username: 'silentuser' },
} as SessionLoginResponse;

interface CapturedState {
  isAuthenticated: boolean;
  isTokenReady: boolean;
  userId: string | undefined;
}
let captured: CapturedState = { isAuthenticated: false, isTokenReady: false, userId: undefined };
function Capture() {
  const { isAuthenticated, isTokenReady, user } = useOxy();
  captured = { isAuthenticated, isTokenReady, userId: user?.id };
  return null;
}

/**
 * An INERT SessionClient: `start()` is a no-op and `getState()` stays `null`, so
 * the post-ladder handoff's `syncFromClient` short-circuits and never overwrites
 * what `restoreStoredSession` planted. This isolates the election under test.
 */
function inertClient() {
  return {
    client: {
      getState: () => null,
      subscribe: () => () => undefined,
      addCurrentAccount: jest.fn(async () => undefined),
      start: jest.fn(async () => undefined),
    } as never,
    host: { setCurrentAccountId: jest.fn() } as never,
  };
}

interface StubConfig {
  token: string | null;
  validIds: string[];
  silent?: SessionLoginResponse | null;
  baseURL: string;
}

function buildStub(cfg: StubConfig) {
  let currentToken = cfg.token;
  const validateSession = jest.fn(async (sessionId: string) => {
    if (cfg.validIds.includes(sessionId)) {
      return { valid: true, user: { id: `u-${sessionId}`, username: sessionId } };
    }
    return { valid: false };
  });
  return {
    validateSession,
    stub: {
      config: { authWebUrl: 'https://auth.oxy.so' },
      httpService: { setTokens: (t: string) => { currentToken = t; } },
      getBaseURL: () => cfg.baseURL,
      getSessionBaseUrl: () => cfg.baseURL,
      getAccessToken: () => currentToken,
      onTokensChanged: () => () => undefined,
      setTokens: (t: string) => { currentToken = t; },
      clearTokens: () => { currentToken = null; },
      clearCache: jest.fn(),
      handleAuthCallback: jest.fn(() => null),
      silentSignIn: jest.fn(async () => cfg.silent ?? null),
      refreshAllSessions: jest.fn(async () => ({ accounts: [] as unknown[] })),
      generateSsoState: jest.fn(() => 'state-token-xyz'),
      exchangeSsoCode: jest.fn(async () => null),
      getCurrentUser: jest.fn(async (): Promise<User> => ({ id: 'silent_user', username: 'silentuser' } as User)),
      validateSession,
      getDeviceSessions: jest.fn(async () => []),
      getSessionsBySessionId: jest.fn(async () => []),
      getUserBySession: jest.fn(async (): Promise<User> => ({ id: 'silent_user', username: 'silentuser' } as User)),
      refreshTokenViaCookie: jest.fn(async () => null),
      listAccounts: jest.fn(async () => []),
      getUsersByIds: jest.fn(async (ids: string[]): Promise<User[]> => ids.map((id) => ({ id, username: id } as User))),
    },
  };
}

function renderProvider(stub: unknown, baseURL: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OxyContextProvider oxyServices={stub as never} baseURL={baseURL}>
        <Capture />
      </OxyContextProvider>
    </QueryClientProvider>,
  );
}

describe('restoreStoredSession self-heal (P0)', () => {
  let assignSpy: jest.SpyInstance;
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    captured = { isAuthenticated: false, isTokenReady: false, userId: undefined };
    useAuthStore.getState().logout();
    mockedCreateSessionClient.mockReset();
    mockedCreateSessionClient.mockReturnValue(inertClient());
    // The terminal `sso-bounce` navigates via `ssoNavigate`; spy it so the
    // logged-out fall-through path never tears down jsdom.
    assignSpy = jest.spyOn(oxyCore, 'ssoNavigate').mockImplementation(() => undefined);
  });
  afterEach(() => assignSpy.mockRestore());

  it('(a) elects the sole valid session when NO active id and NO authuser are stored (bearer available)', async () => {
    // sessionIds survive but the active-id marker is absent (e.g. cleared after a
    // server-side revocation). A bearer is available this boot, so activation can
    // complete — the missing markers must not block restore.
    window.localStorage.setItem(SESSION_IDS_KEY, JSON.stringify(['s1']));
    const { stub, validateSession } = buildStub({
      token: 'bearer.tok',
      validIds: ['s1'],
      baseURL: 'https://api.mention.earth/election-a',
    });

    renderProvider(stub, 'https://api.mention.earth/election-a');

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe('u-s1');
    // The elected session was activated and persisted as the new active id.
    await waitFor(() => expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBe('s1'));
    expect(validateSession).toHaveBeenCalledWith('s1', { useHeaderValidation: true });
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('(b) drops an invalid stored active id and elects a surviving valid sibling (bearer available)', async () => {
    window.localStorage.setItem(SESSION_IDS_KEY, JSON.stringify(['dead', 's2']));
    window.localStorage.setItem(ACTIVE_SESSION_KEY, 'dead');
    const { stub } = buildStub({
      token: 'bearer.tok',
      validIds: ['s2'], // 'dead' is invalid
      baseURL: 'https://api.mention.earth/election-b',
    });

    renderProvider(stub, 'https://api.mention.earth/election-b');

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    expect(captured.userId).toBe('u-s2');
    // The dead active id was replaced by the elected valid sibling.
    await waitFor(() => expect(window.localStorage.getItem(ACTIVE_SESSION_KEY)).toBe('s2'));
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('(c) fresh-sign-in-reload shape (active id present, NO authuser, no bearer): validation now runs and the silent iframe recovers', async () => {
    // The exact shape Fase 3-B broke: persistSessionDurably wrote the active id
    // but nothing wrote `activeAuthuser`. The OLD guard bailed here before any
    // network call; the fix drops that gate so validation runs, and — with no
    // in-memory bearer on web — recovery defers to the silent iframe.
    window.localStorage.setItem(SESSION_IDS_KEY, JSON.stringify(['s1']));
    window.localStorage.setItem(ACTIVE_SESSION_KEY, 's1');
    const { stub, validateSession } = buildStub({
      token: null,
      validIds: ['s1'],
      silent: silentSession,
      baseURL: 'https://api.mention.earth/election-c',
    });

    renderProvider(stub, 'https://api.mention.earth/election-c');

    await waitFor(() => expect(captured.isAuthenticated).toBe(true));
    // The authuser gate is gone: the stored session WAS validated over the network.
    expect(validateSession).toHaveBeenCalledWith('s1', { useHeaderValidation: true });
    // Recovery completed via the per-apex silent iframe (no bearer to activate locally).
    expect(stub.silentSignIn).toHaveBeenCalledTimes(1);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('(d) truly signed out (no active id, no session ids): no restore and no validation network calls', async () => {
    const { stub, validateSession } = buildStub({
      token: null,
      validIds: [],
      baseURL: 'https://api.mention.earth/election-d',
    });

    renderProvider(stub, 'https://api.mention.earth/election-d');

    // Cold boot resolves (backstop) but no session is recovered and nothing was validated.
    await waitFor(() => expect(captured.isTokenReady).toBe(true));
    expect(captured.isAuthenticated).toBe(false);
    expect(validateSession).not.toHaveBeenCalled();
  });
});
