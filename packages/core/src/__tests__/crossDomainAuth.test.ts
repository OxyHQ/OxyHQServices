/**
 * CrossDomainAuth orphan-popup cleanup regression tests.
 *
 * Locks in the security-review fix for issue #1: when a caller pre-opens a
 * popup (the standard §6c pattern in WebOxyProvider / services useAuth) and
 * then explicitly requests `signIn({ method: 'fedcm' })` or
 * `signIn({ method: 'redirect' })`, the popup is unused — it must be closed
 * so it doesn't linger as an orphaned blank window over the app UI.
 *
 * Equally important: the `'auto'` mode already handled this for the
 * FedCM-wins path, but these tests pin the EXPLICIT-method behaviour so the
 * gap (an early `return this.signInWithFedCM(options)` that skipped the
 * cleanup) cannot regress.
 */

import { CrossDomainAuth } from '../CrossDomainAuth';
import type { OxyServices } from '../OxyServices';
import type { SessionLoginResponse } from '../models/session';

interface MockPopup {
  closed: boolean;
  close: jest.Mock;
}

function createMockPopup(): MockPopup {
  return {
    closed: false,
    close: jest.fn(function (this: MockPopup) { this.closed = true; }),
  };
}

interface MockServices {
  signInWithFedCM: jest.Mock;
  signInWithPopup: jest.Mock;
  signInWithRedirect: jest.Mock;
  silentSignInWithFedCM: jest.Mock;
  isFedCMSupported: jest.Mock;
  openBlankPopup: jest.Mock;
  getCurrentUser: jest.Mock;
  handleAuthCallback: jest.Mock;
  restoreSession: jest.Mock;
  getStoredSessionId: jest.Mock;
}

function fakeSession(id: string): SessionLoginResponse {
  return {
    sessionId: id,
    deviceId: 'dev',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    accessToken: 'tok',
    user: { id: 'u', username: 'tester' },
  } as unknown as SessionLoginResponse;
}

function createMockServices(overrides: Partial<MockServices> = {}): MockServices {
  return {
    signInWithFedCM: jest.fn(async () => fakeSession('fedcm-sess')),
    signInWithPopup: jest.fn(async () => fakeSession('popup-sess')),
    signInWithRedirect: jest.fn(),
    silentSignInWithFedCM: jest.fn(async () => null),
    isFedCMSupported: jest.fn(() => true),
    openBlankPopup: jest.fn(() => null),
    getCurrentUser: jest.fn(),
    handleAuthCallback: jest.fn(() => null),
    restoreSession: jest.fn(() => false),
    getStoredSessionId: jest.fn(() => ''),
    ...overrides,
  };
}

describe('CrossDomainAuth — orphan popup cleanup on explicit method', () => {
  it('closes the pre-opened popup after a successful explicit FedCM sign-in', async () => {
    const popup = createMockPopup();
    const services = createMockServices();
    const auth = new CrossDomainAuth(services as unknown as OxyServices);

    const session = await auth.signIn({
      method: 'fedcm',
      popup: popup as unknown as Window,
    });

    expect(session).toBeTruthy();
    expect(services.signInWithFedCM).toHaveBeenCalledTimes(1);
    expect(services.signInWithPopup).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(popup.closed).toBe(true);
  });

  it('closes the pre-opened popup even when explicit FedCM sign-in fails', async () => {
    const popup = createMockPopup();
    const services = createMockServices({
      signInWithFedCM: jest.fn(async () => {
        throw new Error('user cancelled FedCM');
      }),
    });
    const auth = new CrossDomainAuth(services as unknown as OxyServices);

    await expect(
      auth.signIn({ method: 'fedcm', popup: popup as unknown as Window })
    ).rejects.toThrow(/user cancelled FedCM/);

    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(popup.closed).toBe(true);
  });

  it('closes the pre-opened popup before initiating a redirect sign-in', async () => {
    const popup = createMockPopup();
    const services = createMockServices();
    const auth = new CrossDomainAuth(services as unknown as OxyServices);

    const result = await auth.signIn({
      method: 'redirect',
      popup: popup as unknown as Window,
    });

    // Redirect resolves to null (page is navigating).
    expect(result).toBeNull();
    expect(services.signInWithRedirect).toHaveBeenCalledTimes(1);
    // Popup was closed BEFORE the redirect call (no point leaving a blank
    // window over the in-flight navigation).
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(popup.closed).toBe(true);
  });

  it('does NOT close the popup on explicit popup method (it is the active channel)', async () => {
    const popup = createMockPopup();
    const services = createMockServices();
    const auth = new CrossDomainAuth(services as unknown as OxyServices);

    await auth.signIn({ method: 'popup', popup: popup as unknown as Window });

    expect(services.signInWithPopup).toHaveBeenCalledTimes(1);
    // The popup is the active sign-in channel for this method — it must be
    // left for the underlying `signInWithPopup` to manage (it cleans up via
    // its own `waitForPopupAuth` cleanup path).
    expect(popup.close).not.toHaveBeenCalled();
  });

  it('does not throw when no popup is supplied for explicit FedCM', async () => {
    const services = createMockServices();
    const auth = new CrossDomainAuth(services as unknown as OxyServices);

    await expect(auth.signIn({ method: 'fedcm' })).resolves.toBeTruthy();
  });

  it('does not call `close()` on an already-closed pre-opened popup', async () => {
    const popup = createMockPopup();
    popup.closed = true;
    const services = createMockServices();
    const auth = new CrossDomainAuth(services as unknown as OxyServices);

    await auth.signIn({ method: 'fedcm', popup: popup as unknown as Window });

    // Already-closed handle: skip the `close()` call entirely.
    expect(popup.close).not.toHaveBeenCalled();
  });
});

describe('CrossDomainAuth — orphan popup cleanup in auto mode (regression)', () => {
  it('closes the pre-opened popup when FedCM wins under auto mode', async () => {
    const popup = createMockPopup();
    const services = createMockServices();
    const auth = new CrossDomainAuth(services as unknown as OxyServices);

    await auth.signIn({ method: 'auto', popup: popup as unknown as Window });

    expect(services.signInWithFedCM).toHaveBeenCalledTimes(1);
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it('closes the pre-opened popup before redirect fallback when FedCM and popup both fail', async () => {
    const popup = createMockPopup();
    const services = createMockServices({
      signInWithFedCM: jest.fn(async () => { throw new Error('fedcm fail'); }),
      signInWithPopup: jest.fn(async () => { throw new Error('popup fail'); }),
    });
    const auth = new CrossDomainAuth(services as unknown as OxyServices);

    // Suppress the expected console.warn from the auto-mode fallback path.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await auth.signIn({ method: 'auto', popup: popup as unknown as Window });

    expect(result).toBeNull();
    expect(services.signInWithRedirect).toHaveBeenCalledTimes(1);
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(popup.closed).toBe(true);

    warnSpy.mockRestore();
  });
});
