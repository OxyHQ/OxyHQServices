/**
 * `OxyContextProvider` cold-boot opt-out (IdP mode).
 *
 * The provider is the ecosystem's device-first session authority by default:
 * it runs `runSessionColdBoot` on mount. The IdP host (`auth.oxy.so`) is NOT a
 * session authority, so it mounts the provider with `coldBoot={false}` — the
 * cold boot must never run (so the bearer-authenticated device socket never
 * starts), yet interactive sign-in must still commit a normal session on that
 * origin.
 */
import { render, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices, runSessionColdBoot, AUTH_STATE_STORAGE_KEY } from '@oxyhq/core';
import type { User } from '@oxyhq/core';
import type { LoginSessionResult } from '@oxyhq/contracts';
import { OxyContextProvider, useOxy, type OxyContextState } from '../OxyContext';
import { createSessionClient } from '../../session';

// Spy on the device-first cold boot without touching the rest of core.
jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return {
    __esModule: true,
    ...actual,
    runSessionColdBoot: jest.fn(() => Promise.resolve()),
  };
});

// Replace the real SessionClient with an inert fake so no socket connects and
// no network is hit. `getState()` returns null, so `syncFromClient` short-
// circuits and never reaches profile resolution.
jest.mock('../../session', () => {
  const actual = jest.requireActual('../../session');
  return {
    __esModule: true,
    ...actual,
    createSessionClient: jest.fn(() => {
      const listeners = new Set<() => void>();
      const client = {
        getState: jest.fn(() => null),
        subscribe: jest.fn((listener: () => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        }),
        start: jest.fn(() => Promise.resolve()),
        bootstrap: jest.fn(() => Promise.resolve()),
        addCurrentAccount: jest.fn(() => Promise.resolve()),
        registerAndActivate: jest.fn(() => Promise.resolve()),
        switchAccount: jest.fn(() => Promise.resolve()),
      };
      const host = { setCurrentAccountId: jest.fn(), setDeviceCredential: jest.fn(), getDeviceCredential: () => null };
      return { client, host };
    }),
  };
});

const coldBootMock = runSessionColdBoot as jest.Mock;
const createSessionClientMock = createSessionClient as jest.Mock;

function renderProvider(props: { coldBoot?: boolean; oxyServices: OxyServices }) {
  let latest: OxyContextState | null = null;
  const Probe = (): ReactNode => {
    latest = useOxy();
    return null;
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <OxyContextProvider oxyServices={props.oxyServices} coldBoot={props.coldBoot}>
        <Probe />
      </OxyContextProvider>
    </QueryClientProvider>,
  );
  return { ...view, getState: (): OxyContextState | null => latest };
}

/** The most recently constructed fake SessionClient. */
function lastSessionClient(): { start: jest.Mock } {
  const results = createSessionClientMock.mock.results;
  return results[results.length - 1].value.client as { start: jest.Mock };
}

beforeEach(() => {
  coldBootMock.mockClear();
  createSessionClientMock.mockClear();
});

describe('OxyContextProvider coldBoot opt-out (IdP mode)', () => {
  it('coldBoot={false}: never runs the cold boot and resolves auth immediately as signed out', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.test.local' });
    const { getState } = renderProvider({ coldBoot: false, oxyServices: oxy });

    await waitFor(() => {
      expect(getState()?.isAuthResolved).toBe(true);
    });

    expect(coldBootMock).not.toHaveBeenCalled();
    expect(getState()?.isAuthenticated).toBe(false);
    expect(getState()?.user).toBeNull();
    // No boot spinner: private-API readiness settles to a definitive "no".
    expect(getState()?.isPrivateApiPending).toBe(false);
    expect(getState()?.canUsePrivateApi).toBe(false);
    // IdP mode never runs the cold boot and never signs in, so the device
    // socket is never started.
    expect(lastSessionClient().start).not.toHaveBeenCalled();
  });

  it('coldBoot={false}: interactive password sign-in still commits a normal session', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.test.local' });
    const loginResult: LoginSessionResult = {
      sessionId: 's-1',
      deviceId: 'd-1',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      accessToken: 'access-1',
      deviceSecret: 'ds-1',
      user: { id: 'u-1', username: 'alice' },
    };
    jest.spyOn(oxy, 'passwordSignIn').mockResolvedValue(loginResult);
    jest.spyOn(oxy, 'getCurrentUser').mockResolvedValue({
      id: 'u-1',
      username: 'alice',
      name: { displayName: 'Alice' },
    } as User);

    const { getState } = renderProvider({ coldBoot: false, oxyServices: oxy });
    await waitFor(() => {
      expect(getState()?.isAuthResolved).toBe(true);
    });

    const state = getState();
    if (!state) {
      throw new Error('context did not resolve');
    }
    await act(async () => {
      const result = await state.signInWithPassword('alice', 'secret');
      expect(result.status).toBe('ok');
    });

    await waitFor(() => {
      expect(getState()?.isAuthenticated).toBe(true);
    });
    expect(getState()?.user?.id).toBe('u-1');
    // Zero-cookie cutover: no `deviceToken` is threaded into `passwordSignIn`.
    expect(oxy.passwordSignIn).toHaveBeenCalledWith('alice', 'secret', {
      deviceName: undefined,
      deviceFingerprint: undefined,
    });
  });

  it('default (coldBoot omitted): runs the device-first cold boot', async () => {
    window.localStorage.setItem(
      AUTH_STATE_STORAGE_KEY,
      JSON.stringify({ sessionId: '', userId: '', deviceId: 'd-test', deviceSecret: 's-test' }),
    );
    const oxy = new OxyServices({ baseURL: 'https://api.test.local' });
    const { getState } = renderProvider({ oxyServices: oxy });

    await waitFor(() => {
      expect(coldBootMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(getState()?.isAuthResolved).toBe(true);
    });
  });
});
