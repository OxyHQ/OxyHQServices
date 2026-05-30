/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * Run-once guarantees for the web silent-SSO hook.
 *
 * The accounts web app previously rendered blank with an accelerating
 * `[FedCM] requestIdentityCredential` retry storm. The trigger was a routing
 * redirect loop that remounted the provider; each remount reset the
 * per-instance `hasCheckedRef` guard and re-fired silent SSO.
 *
 * `useWebSSO` now backs the run-once guarantee with a MODULE-LEVEL guard keyed
 * on `origin + baseURL`, so silent SSO fires exactly once per page load even
 * across provider remounts / StrictMode double-invoke. These tests pin that
 * behaviour:
 *
 *   1. Silent SSO fires exactly once on a normal mount.
 *   2. After unmount + remount (same origin/API), it does NOT fire again.
 *   3. `onSessionFound` is invoked when the browser returns a session.
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

describe('useWebSSO run-once guarantee', () => {
  it('fires silent SSO exactly once on mount and resolves a session', async () => {
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
  });

  it('does NOT re-fire silent SSO after unmount + remount (same origin/API)', async () => {
    // Distinct baseURL so this test owns its module-guard slot independently
    // of the others, while still sharing the slot across its own remounts.
    const services = makeServices(null, 'https://api.oxy.so/remount-resilience');
    const onSessionFound = jest.fn(async () => undefined);

    const first = renderHook(() =>
      useWebSSO({
        oxyServices: services as unknown as OxyServices,
        onSessionFound,
        enabled: true,
      })
    );
    await waitFor(() => expect(services.silentSignInWithFedCM).toHaveBeenCalledTimes(1));

    // Simulate the redirect-loop remount churn.
    first.unmount();
    for (let i = 0; i < 5; i++) {
      const r = renderHook(() =>
        useWebSSO({
          oxyServices: services as unknown as OxyServices,
          onSessionFound,
          enabled: true,
        })
      );
      r.unmount();
    }

    // Still exactly one silent SSO attempt across all those remounts.
    expect(services.silentSignInWithFedCM).toHaveBeenCalledTimes(1);
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
