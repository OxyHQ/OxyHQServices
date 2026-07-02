import { SessionClient } from '@oxyhq/core';
import { createSessionClient } from '../createSessionClient';

function fakeOxy() {
  const listeners = new Set<(t: string | null) => void>();
  return {
    makeRequest: jest.fn().mockResolvedValue({ data: undefined }),
    getBaseURL: jest.fn().mockReturnValue('https://api.oxy.so'),
    getAccessToken: jest.fn().mockReturnValue(null),
    setTokens: jest.fn(),
    onTokensChanged: jest.fn((l: (t: string | null) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }),
    silentSignIn: jest.fn().mockResolvedValue(null),
    signInWithSharedIdentity: jest.fn().mockResolvedValue(null),
  };
}

describe('createSessionClient', () => {
  test('wires a SessionClient instance backed by the host + token transport', () => {
    const oxy = fakeOxy();

    const { client, host } = createSessionClient(oxy as never);

    expect(client).toBeInstanceOf(SessionClient);
    expect(typeof client.bootstrap).toBe('function');
    expect(client.getState()).toBeNull();
    expect(typeof host.setCurrentAccountId).toBe('function');
  });

  test('the returned host reflects setCurrentAccountId', () => {
    const oxy = fakeOxy();

    const { host } = createSessionClient(oxy as never);

    expect(host.getCurrentAccountId()).toBeNull();
    host.setCurrentAccountId('u1');
    expect(host.getCurrentAccountId()).toBe('u1');
  });
});
