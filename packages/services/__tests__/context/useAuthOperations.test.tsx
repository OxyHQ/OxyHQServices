/**
 * Tests for `useAuthOperations`.
 *
 * Covers the three exported operations:
 *   - signIn (online happy path, offline fallback, error path)
 *   - logout (current session, duplicate-session edge case, 401 fast-path)
 *   - logoutAll (no-active-session early-out, success, error)
 *
 * `DeviceManager`, `SignatureService`, `fetchSessionsWithFallback`, and
 * the OxyServices network methods are mocked so the test exercises the
 * orchestration logic only — actual network and crypto work belongs to
 * `@oxyhq/core` and is covered by its own tests.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import type { ClientSession, SessionLoginResponse, User } from '@oxyhq/core';

jest.mock('@oxyhq/core', () => {
  return {
    __esModule: true,
    DeviceManager: {
      getDeviceFingerprint: jest.fn(() => ({
        userAgent: 'jest',
        platform: 'test',
      })),
      getDeviceInfo: jest.fn(async () => ({ deviceName: 'Test Device' })),
      getDefaultDeviceName: jest.fn(() => 'Default Device'),
    },
    SignatureService: {
      generateChallenge: jest.fn(async () => 'local-challenge'),
      signChallenge: jest.fn(async (challenge: string) => ({
        challenge: `signed:${challenge}`,
        timestamp: 1234567890,
      })),
    },
  };
});

jest.mock('expo-crypto', () => ({
  __esModule: true,
  getRandomUUID: jest.fn(() => 'test-uuid-0000'),
}), { virtual: true });

jest.mock('../../src/ui/utils/sessionHelpers', () => ({
  __esModule: true,
  fetchSessionsWithFallback: jest.fn(),
  mapSessionsToClient: jest.fn((sessions) => sessions),
}));

import { useAuthOperations } from '../../src/ui/context/hooks/useAuthOperations';
import * as sessionHelpers from '../../src/ui/utils/sessionHelpers';

interface FakeServices {
  requestChallenge: jest.Mock;
  verifyChallenge: jest.Mock;
  setTokens: jest.Mock;
  getTokenBySession: jest.Mock;
  getUserBySession: jest.Mock;
  logoutSession: jest.Mock;
  logoutAllSessions: jest.Mock;
}

const makeOxyServices = (overrides: Partial<FakeServices> = {}): FakeServices => ({
  requestChallenge: jest.fn(async () => ({ challenge: 'server-challenge' })),
  // The real `/auth/verify` always returns the first access token in its
  // body, and `OxyServices.verifyChallenge` now PLANTS that token internally
  // (mirroring `claimSessionByToken`). The sign-in flow therefore relies on
  // `verifyChallenge` to authenticate the client and must NOT re-fetch the
  // token from the bearer-protected `GET /session/token/:sessionId` (which
  // 401s before a token exists). The mock returns the token to mirror the
  // real response shape, but the consumer no longer reads it directly.
  verifyChallenge: jest.fn(async (): Promise<SessionLoginResponse> => ({
    sessionId: 'new-session',
    deviceId: 'device-1',
    expiresAt: '2030-01-01',
    accessToken: 'verify-access-token',
    refreshToken: 'verify-refresh-token',
    user: { id: 'user-1', username: 'alice' },
  })),
  setTokens: jest.fn(),
  getTokenBySession: jest.fn(async () => ({ accessToken: 'tok' })),
  getUserBySession: jest.fn(async (): Promise<User> => ({
    id: 'user-1',
    username: 'alice',
    privacySettings: {},
  } as User)),
  logoutSession: jest.fn(async () => undefined),
  logoutAllSessions: jest.fn(async () => undefined),
  ...overrides,
});

interface SetupOpts {
  oxyServices?: Partial<FakeServices>;
  sessions?: ClientSession[];
  activeSessionId?: string | null;
}

const setup = (opts: SetupOpts = {}) => {
  const oxyServices = makeOxyServices(opts.oxyServices);
  const setActiveSessionId = jest.fn();
  const updateSessions = jest.fn();
  const saveActiveSessionId = jest.fn(async () => undefined);
  const clearSessionState = jest.fn(async () => undefined);
  const switchSession = jest.fn(async () => ({
    id: 'user-1',
    username: 'alice',
    privacySettings: {},
  } as User));
  const applyLanguagePreference = jest.fn(async () => undefined);
  const onAuthStateChange = jest.fn();
  const onError = jest.fn();
  const loginSuccess = jest.fn();
  const loginFailure = jest.fn();
  const logoutStore = jest.fn();
  const setAuthState = jest.fn();
  const logger = jest.fn();

  // Reset session helper mocks
  (sessionHelpers.fetchSessionsWithFallback as jest.Mock).mockResolvedValue([]);

  const { result } = renderHook(() =>
    useAuthOperations({
      // biome-ignore lint/suspicious/noExplicitAny: fake services match the runtime interface but TypeScript can't see through mixin composition
      oxyServices: oxyServices as any,
      storage: null,
      sessions: opts.sessions ?? [],
      activeSessionId: opts.activeSessionId ?? null,
      setActiveSessionId,
      updateSessions,
      saveActiveSessionId,
      clearSessionState,
      switchSession,
      applyLanguagePreference,
      onAuthStateChange,
      onError,
      loginSuccess,
      loginFailure,
      logoutStore,
      setAuthState,
      logger,
    }),
  );

  return {
    result,
    oxyServices,
    setActiveSessionId,
    updateSessions,
    saveActiveSessionId,
    clearSessionState,
    switchSession,
    applyLanguagePreference,
    onAuthStateChange,
    onError,
    loginSuccess,
    loginFailure,
    setAuthState,
    logger,
  };
};

describe('useAuthOperations.signIn — online flow', () => {
  it('authenticates via verifyChallenge and never calls the bearer-protected token fetch', async () => {
    (sessionHelpers.fetchSessionsWithFallback as jest.Mock).mockResolvedValueOnce([
      { sessionId: 'new-session', deviceId: 'device-1', userId: 'user-1', isCurrent: true },
    ]);

    const helpers = setup();

    let signedInUser: User | undefined;
    await act(async () => {
      signedInUser = await helpers.result.current.signIn('pubkey-1');
    });

    expect(helpers.oxyServices.requestChallenge).toHaveBeenCalledWith('pubkey-1');
    expect(helpers.oxyServices.verifyChallenge).toHaveBeenCalled();
    // `verifyChallenge` now plants the first access token internally (asserted
    // in @oxyhq/core's auth mixin tests), so the consumer no longer touches
    // `setTokens` directly...
    expect(helpers.oxyServices.setTokens).not.toHaveBeenCalled();
    // ...and critically must NEVER call the bearer-protected
    // `GET /session/token/:sessionId`, which 401s for a brand-new identity
    // that has no bearer yet. Regression guard for the
    // AUTH_REQUIRED_OFFLINE_SESSION onboarding break.
    expect(helpers.oxyServices.getTokenBySession).not.toHaveBeenCalled();
    expect(helpers.oxyServices.getUserBySession).toHaveBeenCalledWith('new-session');
    expect(helpers.setActiveSessionId).toHaveBeenCalledWith('new-session');
    expect(helpers.saveActiveSessionId).toHaveBeenCalledWith('new-session');
    expect(helpers.loginSuccess).toHaveBeenCalled();
    expect(helpers.onAuthStateChange).toHaveBeenCalled();
    expect(signedInUser?.id).toBe('user-1');
    expect(helpers.setAuthState).toHaveBeenCalledWith({ isLoading: true, error: null });
    expect(helpers.setAuthState).toHaveBeenLastCalledWith({ isLoading: false });
  });

  it('does not call getTokenBySession even when the verify response omits an access token', async () => {
    (sessionHelpers.fetchSessionsWithFallback as jest.Mock).mockResolvedValueOnce([
      { sessionId: 'new-session', deviceId: 'device-1', userId: 'user-1', isCurrent: true },
    ]);

    const helpers = setup({
      oxyServices: {
        // A token-less new identity (onboarding): verify returns no access
        // token. The consumer must still proceed to fetch the user WITHOUT
        // hitting the bearer-protected session-token endpoint — that endpoint
        // 401s pre-bearer and previously broke onboarding.
        verifyChallenge: jest.fn(async (): Promise<SessionLoginResponse> => ({
          sessionId: 'new-session',
          deviceId: 'device-1',
          expiresAt: '2030-01-01',
          user: { id: 'user-1', username: 'alice' },
        })),
      },
    });

    let signedInUser: User | undefined;
    await act(async () => {
      signedInUser = await helpers.result.current.signIn('pubkey-1');
    });

    expect(helpers.oxyServices.setTokens).not.toHaveBeenCalled();
    expect(helpers.oxyServices.getTokenBySession).not.toHaveBeenCalled();
    expect(helpers.oxyServices.getUserBySession).toHaveBeenCalledWith('new-session');
    expect(signedInUser?.id).toBe('user-1');
  });

  it('rejects with the original error when verifyChallenge throws', async () => {
    const helpers = setup({
      oxyServices: {
        verifyChallenge: jest.fn(async () => {
          throw new Error('signature mismatch');
        }),
      },
    });

    let caught: unknown;
    await act(async () => {
      try {
        await helpers.result.current.signIn('pubkey-1');
      } catch (error) {
        caught = error;
      }
    });

    expect((caught as Error).message).toBe('signature mismatch');
    expect(helpers.loginFailure).toHaveBeenCalledWith('signature mismatch');
    expect(helpers.onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'LOGIN_ERROR',
    }));
  });

  it('switches to an existing session for the same user instead of duplicating', async () => {
    (sessionHelpers.fetchSessionsWithFallback as jest.Mock).mockResolvedValueOnce([
      { sessionId: 'old-session', deviceId: 'device-1', userId: 'user-1', isCurrent: false },
      { sessionId: 'new-session', deviceId: 'device-1', userId: 'user-1', isCurrent: true },
    ]);

    const helpers = setup();

    await act(async () => {
      await helpers.result.current.signIn('pubkey-1');
    });

    // Should have killed the newly-created duplicate and switched to the existing one
    expect(helpers.oxyServices.logoutSession).toHaveBeenCalledWith('new-session', 'new-session');
    expect(helpers.switchSession).toHaveBeenCalledWith('old-session');
    expect(helpers.updateSessions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: 'old-session' }),
      ]),
      { merge: false },
    );
  });
});

describe('useAuthOperations.signIn — offline flow', () => {
  it('falls back to a local session when the network is unavailable', async () => {
    const helpers = setup({
      oxyServices: {
        requestChallenge: jest.fn(async () => {
          throw new Error('Network request failed');
        }),
      },
    });

    let signedInUser: User | undefined;
    await act(async () => {
      signedInUser = await helpers.result.current.signIn('offline-pubkey');
    });

    // Online endpoints must NOT be hit when offline
    expect(helpers.oxyServices.verifyChallenge).not.toHaveBeenCalled();
    expect(helpers.oxyServices.getTokenBySession).not.toHaveBeenCalled();
    expect(helpers.oxyServices.getUserBySession).not.toHaveBeenCalled();

    expect(signedInUser?.id).toBe('offline-pubkey');
    expect(signedInUser?.publicKey).toBe('offline-pubkey');

    expect(helpers.setActiveSessionId).toHaveBeenCalledWith(
      expect.stringMatching(/^offline_/),
    );
    expect(helpers.loginSuccess).toHaveBeenCalled();
    expect(helpers.onAuthStateChange).toHaveBeenCalled();
  });

  it('re-throws non-network errors from requestChallenge without going offline', async () => {
    const helpers = setup({
      oxyServices: {
        requestChallenge: jest.fn(async () => {
          throw new Error('bad request (400)');
        }),
      },
    });

    await expect(
      act(async () => {
        await helpers.result.current.signIn('pubkey-1');
      }),
    ).rejects.toThrow('bad request');

    // Did NOT switch to offline flow
    expect(helpers.setActiveSessionId).not.toHaveBeenCalled();
  });
});

describe('useAuthOperations.logout', () => {
  const currentSessions: ClientSession[] = [
    { sessionId: 'session-1', deviceId: 'd1', expiresAt: '2030', lastActive: '2025', userId: 'u1', isCurrent: true },
    { sessionId: 'session-2', deviceId: 'd1', expiresAt: '2030', lastActive: '2025', userId: 'u1', isCurrent: false },
  ];

  it('no-ops when there is no active session', async () => {
    const helpers = setup({ activeSessionId: null });
    await act(async () => {
      await helpers.result.current.logout();
    });
    expect(helpers.oxyServices.logoutSession).not.toHaveBeenCalled();
    expect(helpers.clearSessionState).not.toHaveBeenCalled();
  });

  it('switches to the next session when logging out the active one', async () => {
    const helpers = setup({ activeSessionId: 'session-1', sessions: currentSessions });
    await act(async () => {
      await helpers.result.current.logout();
    });
    expect(helpers.oxyServices.logoutSession).toHaveBeenCalledWith('session-1', 'session-1');
    expect(helpers.updateSessions).toHaveBeenCalledWith(
      [expect.objectContaining({ sessionId: 'session-2' })],
      { merge: false },
    );
    expect(helpers.switchSession).toHaveBeenCalledWith('session-2');
    expect(helpers.clearSessionState).not.toHaveBeenCalled();
  });

  it('clears session state when the last session is logged out', async () => {
    const helpers = setup({ activeSessionId: 'session-1', sessions: [currentSessions[0]] });
    await act(async () => {
      await helpers.result.current.logout();
    });
    expect(helpers.clearSessionState).toHaveBeenCalledTimes(1);
    expect(helpers.switchSession).not.toHaveBeenCalled();
  });

  it('logs out a specific non-active session without disturbing the active one', async () => {
    const helpers = setup({ activeSessionId: 'session-1', sessions: currentSessions });
    await act(async () => {
      await helpers.result.current.logout('session-2');
    });
    expect(helpers.oxyServices.logoutSession).toHaveBeenCalledWith('session-1', 'session-2');
    expect(helpers.switchSession).not.toHaveBeenCalled();
    expect(helpers.clearSessionState).not.toHaveBeenCalled();
    expect(helpers.updateSessions).toHaveBeenCalledWith(
      [expect.objectContaining({ sessionId: 'session-1' })],
      { merge: false },
    );
  });

  it('clears local state when the server reports the session as invalid (401 fast-path)', async () => {
    const helpers = setup({
      activeSessionId: 'session-1',
      sessions: currentSessions,
      oxyServices: {
        logoutSession: jest.fn(async () => {
          const err: Error & { status?: number } = new Error('HTTP 401: invalid session');
          err.status = 401;
          throw err;
        }),
      },
    });

    await act(async () => {
      await helpers.result.current.logout('session-1');
    });

    expect(helpers.clearSessionState).toHaveBeenCalledTimes(1);
    expect(helpers.onError).not.toHaveBeenCalled();
  });

  it('reports unexpected errors via onError', async () => {
    const helpers = setup({
      activeSessionId: 'session-1',
      sessions: currentSessions,
      oxyServices: {
        logoutSession: jest.fn(async () => {
          throw new Error('boom');
        }),
      },
    });

    await act(async () => {
      await helpers.result.current.logout('session-1');
    });

    expect(helpers.onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'LOGOUT_ERROR',
    }));
  });
});

describe('useAuthOperations.logoutAll', () => {
  it('throws when there is no active session', async () => {
    const helpers = setup({ activeSessionId: null });
    await expect(
      act(async () => {
        await helpers.result.current.logoutAll();
      }),
    ).rejects.toThrow(/No active session/);
    expect(helpers.onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'LOGOUT_ALL_ERROR',
      status: 404,
    }));
  });

  it('clears all session state on success', async () => {
    const helpers = setup({ activeSessionId: 'session-1' });
    await act(async () => {
      await helpers.result.current.logoutAll();
    });
    expect(helpers.oxyServices.logoutAllSessions).toHaveBeenCalledWith('session-1');
    expect(helpers.clearSessionState).toHaveBeenCalledTimes(1);
  });

  it('re-throws and reports when the server fails', async () => {
    const helpers = setup({
      activeSessionId: 'session-1',
      oxyServices: {
        logoutAllSessions: jest.fn(async () => {
          throw new Error('server down');
        }),
      },
    });

    await expect(
      act(async () => {
        await helpers.result.current.logoutAll();
      }),
    ).rejects.toThrow('server down');

    expect(helpers.onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'LOGOUT_ALL_ERROR',
    }));
  });
});
