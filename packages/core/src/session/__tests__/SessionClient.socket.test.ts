import type { DeviceSessionState } from '@oxyhq/contracts';

type Handler = (...args: unknown[]) => void;
class FakeSocket {
  connected = false;
  handlers = new Map<string, Handler[]>();
  on(event: string, cb: Handler) { const l = this.handlers.get(event) ?? []; l.push(cb); this.handlers.set(event, l); }
  off(event: string, cb?: Handler) { if (!cb) { this.handlers.delete(event); return; } this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== cb)); }
  connect() { this.connected = true; this.trigger('connect'); }
  disconnect() { this.connected = false; }
  trigger(event: string, ...args: unknown[]) { for (const h of this.handlers.get(event) ?? []) h(...args); }
}
let fakeSocket: FakeSocket;
const ioMock = jest.fn((_uri: string, opts?: Record<string, unknown>) => {
  // honor autoConnect like real socket.io (connect immediately unless autoConnect:false)
  if (!opts || opts.autoConnect !== false) fakeSocket.connected = true;
  return fakeSocket;
});
jest.mock('socket.io-client', () => ({ __esModule: true, io: (...args: unknown[]) => ioMock(...(args as [string, Record<string, unknown>?])) }));

import { SessionClient, type SessionClientHost } from '../SessionClient';

const STATE = (rev: number): DeviceSessionState => ({ deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: rev, updatedAt: 1720000000000 });
const SYNC = (rev: number) => ({ state: STATE(rev), activeToken: { accessToken: `jwt-${rev}`, expiresAt: 'x' } });

function makeHost(over: Partial<SessionClientHost> = {}): SessionClientHost {
  return {
    makeRequest: jest.fn().mockResolvedValue(SYNC(1)),
    getBaseURL: () => 'http://test.invalid',
    getAccessToken: () => 'tok',
    onTokensChanged: () => () => undefined,
    setTokens: jest.fn(),
    getCurrentAccountId: () => 'a1',
    ...over,
  };
}

beforeEach(() => { fakeSocket = new FakeSocket(); ioMock.mockClear(); });

describe('SessionClient socket', () => {
  it('start() bootstraps then opens ONE socket to the base URL with a token-in-handshake auth callback', async () => {
    const host = makeHost();
    const c = new SessionClient(host);
    await c.start();
    expect(host.makeRequest).toHaveBeenCalledWith('GET', '/session/device/state', undefined, { cache: false });
    expect(ioMock).toHaveBeenCalledTimes(1);
    const [uri, opts] = ioMock.mock.calls[0];
    expect(uri).toBe('http://test.invalid');
    const authCb = jest.fn();
    (opts?.auth as (cb: (d: { token: string }) => void) => void)(authCb);
    expect(authCb).toHaveBeenCalledWith({ token: 'tok' });
    c.stop();
  });

  it('applies a pushed session_state event', async () => {
    const c = new SessionClient(makeHost());
    await c.start();
    fakeSocket.trigger('session_state', STATE(9));
    expect(c.getState()?.revision).toBe(9);
    c.stop();
  });

  it('fetches the active token via bootstrap when a pushed state changes the active account', async () => {
    const makeRequest = jest.fn().mockResolvedValue(SYNC(1));
    const host = makeHost({ makeRequest, getCurrentAccountId: () => 'other-account' });
    const c = new SessionClient(host);
    await c.start();
    makeRequest.mockClear();
    fakeSocket.trigger('session_state', STATE(9));
    await Promise.resolve();
    expect(makeRequest).toHaveBeenCalledWith('GET', '/session/device/state', undefined, { cache: false });
    c.stop();
  });

  it('does not re-fetch when the pushed active account matches the host-held account', async () => {
    const makeRequest = jest.fn().mockResolvedValue(SYNC(1));
    const host = makeHost({ makeRequest, getCurrentAccountId: () => 'a1' });
    const c = new SessionClient(host);
    await c.start();
    makeRequest.mockClear();
    fakeSocket.trigger('session_state', STATE(9));
    await Promise.resolve();
    expect(makeRequest).not.toHaveBeenCalled();
    c.stop();
  });

  it('does not connect the socket when there is no token (autoConnect false)', async () => {
    const c = new SessionClient(makeHost({ getAccessToken: () => null }));
    await c.start();
    const [, opts] = ioMock.mock.calls[0];
    expect(opts?.autoConnect).toBe(false);
    c.stop();
  });

  it('reconnects when a token arrives after being disconnected', async () => {
    let tokenListener: ((t: string | null) => void) | null = null;
    const host = makeHost({ getAccessToken: () => null, onTokensChanged: (l) => { tokenListener = l; return () => undefined; } });
    const c = new SessionClient(host);
    await c.start();
    fakeSocket.connected = false;
    tokenListener?.('fresh-token');
    expect(fakeSocket.connected).toBe(true);
    c.stop();
  });

  it('stop() disconnects the socket', async () => {
    const c = new SessionClient(makeHost());
    await c.start();
    c.stop();
    expect(fakeSocket.connected).toBe(false);
  });
});
