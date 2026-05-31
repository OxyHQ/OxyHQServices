/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * Behaviour of the @oxyhq/auth web silent-SSO hook.
 *
 * Mirrors the @oxyhq/services test. The page-load run-once guarantee — silent
 * SSO invoking `navigator.credentials.get` AT MOST ONCE per page load across
 * remounts / StrictMode / multiple consumers — now lives in `@oxyhq/core`'s
 * `silentSignInWithFedCM` (memoized on `origin + baseURL`). The hook keeps only
 * a per-instance `hasCheckedRef` fast-path; it no longer owns a module-level
 * guard. The core memo is covered by core's own FedCM tests, which exercise the
 * REAL method; these tests pin the hook's per-mount contract.
 */

import { renderHook, waitFor } from '@testing-library/react';
import type { OxyServices, SessionLoginResponse } from '@oxyhq/core';
import { useWebSSO } from '../../src/hooks/useWebSSO';

interface StubServices {
  isFedCMSupported: jest.Mock<boolean, []>;
  silentSignInWithFedCM: jest.Mock<Promise<SessionLoginResponse | null>, []>;
  signInWithFedCM: jest.Mock<Promise<SessionLoginResponse | null>, []>;
  getBaseURL: jest.Mock<string, []>;
}

function makeServices(
  session: SessionLoginResponse | null,
  baseURL: string
): StubServices {
  return {
    isFedCMSupported: jest.fn(() => true),
    silentSignInWithFedCM: jest.fn(async () => session),
    signInWithFedCM: jest.fn(async () => session),
    getBaseURL: jest.fn(() => baseURL),
  };
}

const fakeSession: SessionLoginResponse = {
  sessionId: 'sess_1',
  deviceId: 'dev_1',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: { id: 'u1', username: 'tester' },
} as SessionLoginResponse;

describe('useWebSSO behaviour (auth-sdk)', () => {
  it('fires silent SSO exactly once per mount and resolves a session', async () => {
    const services = makeServices(fakeSession, 'https://api.oxy.so/auth-once-1');
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
    // The hook no longer owns a module-level guard. Run-once per page load is
    // enforced inside the REAL `silentSignInWithFedCM`. With a mock standing in
    // for it there is no memo, so each fresh mount calls through once; the
    // per-instance `hasCheckedRef` only suppresses re-fires within one mount.
    const services = makeServices(null, 'https://api.oxy.so/auth-delegates-core');
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
});
