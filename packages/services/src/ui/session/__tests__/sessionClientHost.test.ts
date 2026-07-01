import { createSessionClientHost } from '../sessionClientHost';

function fakeOxy() {
  const listeners = new Set<(t: string | null) => void>();
  return {
    makeRequest: jest.fn().mockResolvedValue({ ok: true }),
    getBaseURL: jest.fn().mockReturnValue('https://api.oxy.so'),
    getAccessToken: jest.fn().mockReturnValue('tok'),
    setTokens: jest.fn(),
    onTokensChanged: jest.fn((l: (t: string | null) => void) => { listeners.add(l); return () => listeners.delete(l); }),
    _emit: (t: string | null) => listeners.forEach((l) => l(t)),
  };
}

test('delegates REST + token methods to oxyServices', async () => {
  const oxy = fakeOxy();
  const host = createSessionClientHost(oxy as never);
  await host.makeRequest('GET', '/session/device/state', undefined, { cache: false });
  expect(oxy.makeRequest).toHaveBeenCalledWith('GET', '/session/device/state', undefined, { cache: false });
  expect(host.getBaseURL()).toBe('https://api.oxy.so');
  expect(host.getAccessToken()).toBe('tok');
  host.setTokens('new');
  expect(oxy.setTokens).toHaveBeenCalledWith('new');
});

test('getCurrentAccountId reflects setCurrentAccountId', () => {
  const host = createSessionClientHost(fakeOxy() as never);
  expect(host.getCurrentAccountId()).toBeNull();
  host.setCurrentAccountId('u1');
  expect(host.getCurrentAccountId()).toBe('u1');
});

test('onTokensChanged forwards to oxyServices and unsubscribes', () => {
  const oxy = fakeOxy();
  const host = createSessionClientHost(oxy as never);
  const cb = jest.fn();
  const unsub = host.onTokensChanged(cb);
  oxy._emit(null);
  expect(cb).toHaveBeenCalledWith(null);
  unsub();
  oxy._emit('x');
  expect(cb).toHaveBeenCalledTimes(1);
});
