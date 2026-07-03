import { SessionClient } from '@oxyhq/core';

type Handler = (...args: unknown[]) => void;
class FakeSocket {
  connected = false;
  on(_event: string, _cb: Handler) {}
  off(_event: string, _cb?: Handler) {}
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
}
const ioMock = jest.fn((_uri: string, _opts?: Record<string, unknown>) => new FakeSocket());
// `createSessionClient` STATICALLY imports `io` from socket.io-client and injects it as
// the SessionClient `socketFactory`; this mock stands in for that real dependency so the
// wiring test can assert the factory reaches — and is invoked by — the client.
jest.mock('socket.io-client', () => ({ __esModule: true, io: (...args: unknown[]) => ioMock(...(args as [string, Record<string, unknown>?])) }));

import { createSessionClient } from '../createSessionClient';

function fakeOxy() {
  const listeners = new Set<(t: string | null) => void>();
  return {
    makeRequest: jest.fn().mockResolvedValue(undefined),
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

  test('injects the statically-imported socket.io factory — start() opens a socket without the lazy loader', async () => {
    ioMock.mockClear();
    const oxy = fakeOxy();

    const { client } = createSessionClient(oxy as never);
    await client.start();

    // The injected `io` was used to open the session socket at the base URL.
    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ioMock).toHaveBeenCalledWith('https://api.oxy.so', expect.objectContaining({ transports: ['websocket'] }));
    client.stop();
  });
});
