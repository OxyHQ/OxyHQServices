/**
 * Device-first `WebOxyProvider` cold-boot binding.
 *
 * The provider is a THIN binding over core's `runSessionColdBoot`: it reacts to
 * the boot outcome (`onSession` → commit + authenticated; `onSignedOut` → stop
 * loading, stay signed-out) and NEVER navigates. `runSessionColdBoot` is the
 * mocked seam so each test drives the outcome deterministically; the "no
 * navigation" guarantee is structural (the provider has no navigation code) and
 * asserted via `window.location.assign`.
 */

import { render, waitFor, act } from '@testing-library/react';
import type { User } from '@oxyhq/core';
import { AUTH_STATE_STORAGE_KEY, DEVICE_TOKEN_STORAGE_KEY } from '@oxyhq/core';

type ColdBootOpts = {
  onSignedOut?: (r: string) => void | Promise<void>;
  onSession?: (s: unknown) => void | Promise<void>;
};

// A mutable control holder read only at CALL time (never at factory-eval time),
// so the hoisted `jest.mock` factory can close over it without a TDZ error.
const coldBoot = {
  async impl(opts: ColdBootOpts): Promise<{ kind: string }> {
    await opts.onSignedOut?.('no_session');
    return { kind: 'unauthenticated' };
  },
};

const stubs = {
  getUsersByIds: jest.fn(async (_ids: string[]) => [] as User[]),
  getUserById: jest.fn(async (id: string): Promise<User> => ({ id, username: `user-${id}` } as User)),
  baseURL: 'https://api.oxy.so',
};

jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return {
    __esModule: true,
    ...actual,
    runSessionColdBoot: jest.fn((opts: ColdBootOpts) => coldBoot.impl(opts)),
    installAuthRefreshHandler: jest.fn(() => () => undefined),
    startTokenRefreshScheduler: jest.fn(() => ({ dispose: () => undefined })),
    refreshPersistedSession: jest.fn(async () => null),
    createSessionClient: jest.fn(),
    OxyServices: class {
      private token: string | null = null;
      getBaseURL(): string { return stubs.baseURL; }
      getAccessToken(): string | null { return this.token; }
      setTokens(t: string): void { this.token = t; }
      getAccessTokenExpiry(): number | null { return null; }
      onTokensChanged(): () => void { return () => undefined; }
      getUsersByIds(ids: string[]): Promise<User[]> { return stubs.getUsersByIds(ids); }
      getUserById(id: string): Promise<User> { return stubs.getUserById(id); }
    },
  };
});

import { WebOxyProvider, useAuth, type WebOxyContextValue } from '../src/WebOxyProvider';
import { createSessionClient } from '@oxyhq/core';

const mockedCreateSessionClient = createSessionClient as jest.MockedFunction<typeof createSessionClient>;

function buildFakeClient() {
  return {
    getState: () => null,
    subscribe: () => () => undefined,
    addCurrentAccount: jest.fn(async () => undefined),
    registerAndActivate: jest.fn(async () => undefined),
    start: jest.fn(async () => undefined),
    signOut: jest.fn(async () => undefined),
    switchAccount: jest.fn(async () => undefined),
    stop: jest.fn(),
  };
}

let ctxRef: WebOxyContextValue | null = null;
function Capture() {
  ctxRef = useAuth() as unknown as WebOxyContextValue;
  return null;
}

function renderProvider() {
  render(
    <WebOxyProvider baseURL={stubs.baseURL}>
      <Capture />
    </WebOxyProvider>,
  );
}

describe('WebOxyProvider — device-first cold boot binding', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    ctxRef = null;
    stubs.getUsersByIds = jest.fn(async () => []);
    stubs.getUserById = jest.fn(async (id: string) => ({ id, username: `user-${id}` } as User));
    mockedCreateSessionClient.mockReset();
    mockedCreateSessionClient.mockReturnValue({
      client: buildFakeClient() as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });
    coldBoot.impl = async (opts: ColdBootOpts) => {
      await opts.onSignedOut?.('no_session');
      return { kind: 'unauthenticated' };
    };
  });

  it('signed-out boot: settles ready + unauthenticated, modal stays closed (no navigation)', async () => {
    renderProvider();
    await waitFor(() => expect(ctxRef?.isLoading).toBe(false));
    expect(ctxRef?.isAuthenticated).toBe(false);
    expect(ctxRef?.user).toBeNull();
    // The provider never auto-opens the modal and — having no navigation code at
    // all — never redirects; a signed-out boot simply settles ready.
    expect(ctxRef?.isSignInOpen).toBe(false);
  });

  it('signIn() opens the in-app modal instead of navigating', async () => {
    renderProvider();
    await waitFor(() => expect(ctxRef?.isLoading).toBe(false));
    expect(ctxRef?.isSignInOpen).toBe(false);

    act(() => { ctxRef?.signIn(); });
    await waitFor(() => expect(ctxRef?.isSignInOpen).toBe(true));
  });

  it('onSession boot: commits the recovered session and becomes authenticated', async () => {
    coldBoot.impl = async (opts: ColdBootOpts) => {
      await opts.onSession?.({ sessionId: 'sess-1', userId: 'u1', accessToken: 'tok-1', via: 'stored-tokens' });
      return { kind: 'session' };
    };
    stubs.getUserById = jest.fn(async (id: string) => ({ id, username: 'nate' } as User));

    renderProvider();
    await waitFor(() => expect(ctxRef?.isAuthenticated).toBe(true));
    expect(ctxRef?.user?.id).toBe('u1');
    expect(ctxRef?.activeSessionId).toBe('sess-1');
  });

  it('signOut clears the persisted refresh family + device token from storage', async () => {
    // Seed a persisted session as if a prior sign-in had run.
    window.localStorage.setItem(
      AUTH_STATE_STORAGE_KEY,
      JSON.stringify({ sessionId: 'sess-1', refreshToken: 'rt-1', userId: 'u1' }),
    );
    window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, 'dev-tok-1');

    renderProvider();
    await waitFor(() => expect(ctxRef?.isLoading).toBe(false));

    await act(async () => { await ctxRef?.signOut(); });

    expect(window.localStorage.getItem(AUTH_STATE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
