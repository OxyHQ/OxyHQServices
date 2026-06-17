import { CrossDomainAuth } from '../CrossDomainAuth';
import type { OxyServices } from '../OxyServices';
import type { SessionLoginResponse } from '../models/session';

interface MockServices {
  signInWithFedCM: jest.Mock;
  signInWithRedirect: jest.Mock;
  silentSignInWithFedCM: jest.Mock;
  isFedCMSupported: jest.Mock;
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
    signInWithRedirect: jest.fn(),
    silentSignInWithFedCM: jest.fn(async () => null),
    isFedCMSupported: jest.fn(() => true),
    getCurrentUser: jest.fn(),
    handleAuthCallback: jest.fn(() => null),
    restoreSession: jest.fn(() => false),
    getStoredSessionId: jest.fn(() => ''),
    ...overrides,
  };
}

describe('CrossDomainAuth', () => {
  it('uses FedCM for an explicit FedCM sign-in', async () => {
    const services = createMockServices();
    const auth = new CrossDomainAuth(services as unknown as OxyServices);

    const session = await auth.signIn({ method: 'fedcm' });

    expect(session).toBeTruthy();
    expect(services.signInWithFedCM).toHaveBeenCalledTimes(1);
    expect(services.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('initiates redirect and returns null for an explicit redirect sign-in', async () => {
    const services = createMockServices();
    const auth = new CrossDomainAuth(services as unknown as OxyServices);

    const result = await auth.signIn({ method: 'redirect', redirectUri: 'https://app.oxy.so' });

    expect(result).toBeNull();
    expect(services.signInWithRedirect).toHaveBeenCalledWith({
      redirectUri: 'https://app.oxy.so',
      mode: 'login',
    });
  });

  it('uses FedCM first in auto mode when supported', async () => {
    const services = createMockServices();
    const auth = new CrossDomainAuth(services as unknown as OxyServices);
    const selected: string[] = [];

    const session = await auth.signIn({
      method: 'auto',
      onMethodSelected: (method) => selected.push(method),
    });

    expect(session?.sessionId).toBe('fedcm-sess');
    expect(selected).toEqual(['fedcm']);
    expect(services.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('falls back to redirect in auto mode when FedCM fails', async () => {
    const services = createMockServices({
      signInWithFedCM: jest.fn(async () => { throw new Error('fedcm fail'); }),
    });
    const auth = new CrossDomainAuth(services as unknown as OxyServices);
    const selected: string[] = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await auth.signIn({
      method: 'auto',
      onMethodSelected: (method) => selected.push(method),
    });

    expect(result).toBeNull();
    expect(selected).toEqual(['fedcm', 'redirect']);
    expect(services.signInWithRedirect).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
