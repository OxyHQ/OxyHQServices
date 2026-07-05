import type { DeviceSessionState } from '@oxyhq/contracts';

type Handler = (...args: unknown[]) => void;
class FakeSocket {
  connected = false;
  handlers = new Map<string, Handler[]>();
  connectCalls = 0;
  disconnectCalls = 0;
  on(event: string, cb: Handler) { const l = this.handlers.get(event) ?? []; l.push(cb); this.handlers.set(event, l); }
  off(event: string, cb?: Handler) { if (!cb) { this.handlers.delete(event); return; } this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== cb)); }
  connect() { this.connectCalls += 1; this.connected = true; this.trigger('connect'); }
  disconnect() { this.disconnectCalls += 1; this.connected = false; }
  trigger(event: string, ...args: unknown[]) { for (const h of this.handlers.get(event) ?? []) h(...args); }
}
let fakeSocket: FakeSocket;
let lastOpts: Record<string, unknown> | undefined;
const ioMock = jest.fn((_uri: string, opts?: Record<string, unknown>) => {
  lastOpts = opts;
  if (!opts || opts.autoConnect !== false) fakeSocket.connected = true;
  return fakeSocket;
});
jest.mock('socket.io-client', () => ({ __esModule: true, io: (...args: unknown[]) => ioMock(...(args as [string, Record<string, unknown>?])) }));

// A same-name in-process BroadcastChannel bus: postMessage delivers to every
// OTHER open channel of the same name (never the sender) — matching the spec.
type BusEntry = { name: string; onmessage: ((event: { data: unknown }) => void) | null };
const bus = new Set<BusEntry>();
class FakeBroadcastChannel {
  private entry: BusEntry;
  constructor(public name: string) { this.entry = { name, onmessage: null }; bus.add(this.entry); }
  get onmessage(): ((event: { data: unknown }) => void) | null { return this.entry.onmessage; }
  set onmessage(cb: ((event: { data: unknown }) => void) | null) { this.entry.onmessage = cb; }
  postMessage(data: unknown) {
    for (const e of bus) {
      if (e === this.entry || e.name !== this.name) continue;
      e.onmessage?.({ data });
    }
  }
  close() { bus.delete(this.entry); }
}

import { SessionClient, type SessionClientHost, type SessionClientOptions } from '../SessionClient';

const STATE = (rev: number, accounts = [{ accountId: 'a1', sessionId: 's1', authuser: 0 }]): DeviceSessionState =>
  ({ deviceId: 'd1', accounts, activeAccountId: accounts[0]?.accountId ?? null, revision: rev, updatedAt: 1720000000000 });
const SYNC = (rev: number) => ({ state: STATE(rev), activeToken: { accessToken: `jwt-${rev}`, expiresAt: 'x' } });

function makeHost(over: Partial<SessionClientHost> = {}): SessionClientHost {
  return {
    makeRequest: jest.fn().mockResolvedValue(SYNC(1)),
    getBaseURL: () => 'http://test.invalid',
    getAccessToken: () => null,
    onTokensChanged: () => () => undefined,
    setTokens: jest.fn(),
    getCurrentAccountId: () => null,
    ...over,
  };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  fakeSocket = new FakeSocket();
  lastOpts = undefined;
  ioMock.mockClear();
  bus.clear();
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = FakeBroadcastChannel as unknown;
});
afterEach(() => {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
});

describe('SessionClient signed-out socket', () => {
  it('opens the socket while signed-out when signedOutSocketAuth resolves true (web cookie), with credentials', async () => {
    const c = new SessionClient(makeHost(), { signedOutSocketAuth: () => true });
    await c.start();
    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(lastOpts?.autoConnect).toBe(true);
    expect(lastOpts?.withCredentials).toBe(true);
    // No bearer, no native token → handshake presents an empty token, no deviceToken.
    const authCb = jest.fn();
    (lastOpts?.auth as (cb: (d: unknown) => void) => void)(authCb);
    expect(authCb).toHaveBeenCalledWith({ token: '' });
    c.stop();
  });

  it('presents the native device token in the handshake when signedOutSocketAuth returns a string', async () => {
    const c = new SessionClient(makeHost(), { signedOutSocketAuth: () => 'dt-native' });
    await c.start();
    expect(lastOpts?.autoConnect).toBe(true);
    const authCb = jest.fn();
    (lastOpts?.auth as (cb: (d: unknown) => void) => void)(authCb);
    expect(authCb).toHaveBeenCalledWith({ token: '', deviceToken: 'dt-native' });
    c.stop();
  });

  it('does NOT open the socket while signed-out when signedOutSocketAuth is absent (default)', async () => {
    const c = new SessionClient(makeHost());
    await c.start();
    expect(lastOpts?.autoConnect).toBe(false);
    c.stop();
  });

  it('does NOT open the socket while signed-out when signedOutSocketAuth resolves false', async () => {
    const c = new SessionClient(makeHost(), { signedOutSocketAuth: async () => false });
    await c.start();
    expect(lastOpts?.autoConnect).toBe(false);
    c.stop();
  });

  it('skips the bearer-authenticated bootstrap when signed-out', async () => {
    const makeRequest = jest.fn().mockResolvedValue(SYNC(1));
    const c = new SessionClient(makeHost({ makeRequest }), { signedOutSocketAuth: () => true });
    await c.start();
    expect(makeRequest).not.toHaveBeenCalled();
    c.stop();
  });

  it('a session_state push while signed-out triggers acquisition exactly once for a burst', async () => {
    const onSessionAppeared = jest.fn(() => new Promise<void>(() => undefined)); // never resolves (in flight)
    const c = new SessionClient(makeHost(), { signedOutSocketAuth: () => true, onSessionAppeared });
    await c.start();
    fakeSocket.trigger('session_state', STATE(9));
    fakeSocket.trigger('session_state', STATE(10));
    await flush();
    expect(onSessionAppeared).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it('does NOT acquire when the pushed signed-out state has zero accounts', async () => {
    const onSessionAppeared = jest.fn();
    const c = new SessionClient(makeHost(), { signedOutSocketAuth: () => true, onSessionAppeared });
    await c.start();
    fakeSocket.trigger('session_state', STATE(9, []));
    await flush();
    expect(onSessionAppeared).not.toHaveBeenCalled();
    c.stop();
  });

  it('re-acquires on a LATER push after the prior acquisition settled (no permanent lock)', async () => {
    const onSessionAppeared = jest.fn(() => Promise.resolve());
    const c = new SessionClient(makeHost(), { signedOutSocketAuth: () => true, onSessionAppeared });
    await c.start();
    fakeSocket.trigger('session_state', STATE(9));
    await flush();
    expect(onSessionAppeared).toHaveBeenCalledTimes(1);
    fakeSocket.trigger('session_state', STATE(10));
    await flush();
    expect(onSessionAppeared).toHaveBeenCalledTimes(2);
    c.stop();
  });

  it('reconnects the anonymous socket authenticated once a token arrives', async () => {
    let tokenListener: ((t: string | null) => void) | null = null;
    let token: string | null = null;
    const host = makeHost({
      getAccessToken: () => token,
      onTokensChanged: (l) => { tokenListener = l; return () => undefined; },
    });
    const c = new SessionClient(host, { signedOutSocketAuth: () => true });
    await c.start();
    expect(fakeSocket.connected).toBe(true); // anonymous connect
    const before = fakeSocket.disconnectCalls;
    token = 'fresh';
    tokenListener?.('fresh');
    // Anonymous → authenticated: force a reconnect so the handshake re-runs.
    expect(fakeSocket.disconnectCalls).toBe(before + 1);
    expect(fakeSocket.connected).toBe(true);
    c.stop();
  });
});

describe('SessionClient BroadcastChannel wake', () => {
  const opts = (over: Partial<SessionClientOptions>): SessionClientOptions => ({ signedOutSocketAuth: () => true, ...over });

  it('a local mutation wakes a signed-out sibling to acquire', async () => {
    const onSessionAppeared = jest.fn(() => Promise.resolve());
    // Signed-out sibling B listening on the channel.
    const b = new SessionClient(makeHost(), opts({ onSessionAppeared }));
    await b.start();
    // Signed-in tab A commits (switchAccount posts a commit ping).
    const a = new SessionClient(makeHost({ getAccessToken: () => 'tok-a' }), opts({}));
    await a.start();
    await a.switchAccount('a1');
    await flush();
    expect(onSessionAppeared).toHaveBeenCalledTimes(1);
    a.stop();
    b.stop();
  });

  it('a local mutation wakes a signed-in sibling to re-sync (bootstrap)', async () => {
    const bMakeRequest = jest.fn().mockResolvedValue(SYNC(1));
    const b = new SessionClient(makeHost({ makeRequest: bMakeRequest, getAccessToken: () => 'tok-b' }), opts({}));
    await b.start();
    bMakeRequest.mockClear();
    const a = new SessionClient(makeHost({ getAccessToken: () => 'tok-a' }), opts({}));
    await a.start();
    await a.addCurrentAccount();
    await flush();
    expect(bMakeRequest).toHaveBeenCalledWith('GET', '/session/device/state', undefined, { cache: false });
    a.stop();
    b.stop();
  });

  it('does not deliver a commit ping back to the posting tab (no self-loop)', async () => {
    // A signed-out tab that commits locally must not re-trigger its OWN acquisition.
    const onSessionAppeared = jest.fn();
    const a = new SessionClient(makeHost(), opts({ onSessionAppeared }));
    await a.start();
    await a.addCurrentAccount();
    await flush();
    expect(onSessionAppeared).not.toHaveBeenCalled();
    a.stop();
  });

  it('is a no-op on platforms without BroadcastChannel (native)', async () => {
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    const c = new SessionClient(makeHost({ getAccessToken: () => 'tok' }), { });
    await c.start();
    // Mutations must not throw when BroadcastChannel is absent.
    await expect(c.switchAccount('a1')).resolves.toBeUndefined();
    c.stop();
  });
});
