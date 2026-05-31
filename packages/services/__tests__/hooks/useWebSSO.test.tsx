/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * Behaviour of the web silent-SSO hook.
 *
 * The accounts web app previously rendered blank with an accelerating
 * `[FedCM] requestIdentityCredential` retry storm, caused by a routing
 * redirect loop that remounted the provider and re-fired silent SSO.
 *
 * The page-load run-once guarantee — silent SSO invoking
 * `navigator.credentials.get` AT MOST ONCE per page load across remounts /
 * StrictMode / multiple consumers — now lives in `@oxyhq/core`'s
 * `silentSignInWithFedCM` (memoized on `origin + baseURL`). The hook no longer
 * owns a module-level guard; it keeps only a per-instance `hasCheckedRef`
 * fast-path. These tests pin the HOOK's contract (the core memo is covered by
 * core's own FedCM tests, which exercise the real method rather than a mock):
 *
 *   1. Silent SSO fires exactly once per mount (the per-instance fast-path
 *      prevents duplicate fires from effect re-runs within one mount).
 *   2. `onSessionFound` is invoked when the browser returns a session.
 *   3. The hook does not fire when disabled.
 */

import { renderHook, waitFor } from '@testing-library/react';
import type { OxyServices, SessionLoginResponse } from '@oxyhq/core';
import { useWebSSO } from '../../src/ui/hooks/useWebSSO';

interface StubServices {
  isFedCMSupported: jest.Mock<boolean, []>;
  silentSignInWithFedCM: jest.Mock<Promise<SessionLoginResponse | null>, []>;
  signInWithFedCM: jest.Mock<Promise<SessionLoginResponse | null>, []>;
  getBaseURL: jest.Mock<string, []>;
  config: { authWebUrl?: string };
}

function makeServices(
  session: SessionLoginResponse | null,
  baseURL = 'https://api.oxy.so'
): StubServices {
  return {
    isFedCMSupported: jest.fn(() => true),
    silentSignInWithFedCM: jest.fn(async () => session),
    signInWithFedCM: jest.fn(async () => session),
    getBaseURL: jest.fn(() => baseURL),
    config: { authWebUrl: 'https://auth.oxy.so' },
  };
}

const fakeSession: SessionLoginResponse = {
  sessionId: 'sess_1',
  deviceId: 'dev_1',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: { id: 'u1', username: 'tester' },
} as SessionLoginResponse;

describe('useWebSSO behaviour', () => {
  it('fires silent SSO exactly once per mount and resolves a session', async () => {
    const services = makeServices(fakeSession, 'https://api.oxy.so/once-1');
    const onSessionFound = jest.fn(async () => undefined);

    renderHook(() =>
      useWebSSO({
        oxyServices: services as unknown as OxyServices,
        onSessionFound,
        enabled: true,
      })
    );

    await waitFor(() => expect(services.silentSignInWithFedCM).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSessionFound).toHaveBeenCalledWith(fakeSession));

    // No duplicate fire from effect re-runs within the same mount.
    expect(services.silentSignInWithFedCM).toHaveBeenCalledTimes(1);
  });

  it('delegates the page-load run-once guarantee to core (calls through per mount)', async () => {
    // The hook deliberately no longer owns a module-level guard: run-once per
    // page load is enforced inside the REAL `silentSignInWithFedCM` (memoized
    // on origin + baseURL). With a mock standing in for that method there is
    // no memo, so the hook calls through once per fresh mount — the
    // per-instance `hasCheckedRef` only suppresses re-fires within one mount.
    // This pins that the hook itself adds no cross-mount suppression.
    const services = makeServices(null, 'https://api.oxy.so/delegates-core');
    const onSessionFound = jest.fn(async () => undefined);

    const first = renderHook(() =>
      useWebSSO({
        oxyServices: services as unknown as OxyServices,
        onSessionFound,
        enabled: true,
      })
    );
    await waitFor(() => expect(services.silentSignInWithFedCM).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderHook(() =>
      useWebSSO({
        oxyServices: services as unknown as OxyServices,
        onSessionFound,
        enabled: true,
      })
    );
    await waitFor(() => expect(services.silentSignInWithFedCM).toHaveBeenCalledTimes(2));
    second.unmount();
  });

  it('does not fire when disabled', async () => {
    const services = makeServices(null, 'https://api.oxy.so/disabled-1');
    const onSessionFound = jest.fn(async () => undefined);

    renderHook(() =>
      useWebSSO({
        oxyServices: services as unknown as OxyServices,
        onSessionFound,
        enabled: false,
      })
    );

    // Give any (incorrect) async attempt a tick to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(services.silentSignInWithFedCM).not.toHaveBeenCalled();
  });
});
