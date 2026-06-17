/**
 * Silent iframe auth tests.
 *
 * The cross-domain durable-restore iframe (`/auth/silent` at the per-apex host)
 * posts a message on success. On a failed load, it never posts, so
 * `waitForIframeAuth` must resolve `null` immediately instead of waiting for
 * the full timeout.
 */

import { OxyServices } from '../../OxyServices';

const ORIGIN = 'https://mention.earth';

function installBrowserGlobals(options: {
  postMessageDispatcher?: { current: ((event: { origin: string; data: unknown }) => void) | null };
} = {}): void {
  const store = new Map<string, string>();
  const sessionStorageStub = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const messageHandlers: Array<(event: { origin: string; data: unknown }) => void> = [];
  const win = {
    location: { origin: ORIGIN, hostname: 'mention.earth' },
    sessionStorage: sessionStorageStub,
    addEventListener: (event: string, handler: (e: { origin: string; data: unknown }) => void) => {
      if (event === 'message') {
        messageHandlers.push(handler);
        if (options.postMessageDispatcher) {
          options.postMessageDispatcher.current = handler;
        }
      }
    },
    removeEventListener: (event: string, handler: (e: { origin: string; data: unknown }) => void) => {
      if (event === 'message') {
        const idx = messageHandlers.indexOf(handler);
        if (idx >= 0) messageHandlers.splice(idx, 1);
      }
    },
  };
  (globalThis as unknown as { window: unknown }).window = win;
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = sessionStorageStub;
}

function clearBrowserGlobals(): void {
  for (const key of ['window', 'sessionStorage'] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

interface FakeIframe {
  onerror: ((this: unknown, ...args: unknown[]) => unknown) | null;
  onabort: ((this: unknown, ...args: unknown[]) => unknown) | null;
}

describe('OxyServices waitForIframeAuth fail-fast on iframe load error', () => {
  afterEach(() => {
    clearBrowserGlobals();
    jest.restoreAllMocks();
  });

  it('resolves null immediately when the iframe fires onerror', async () => {
    installBrowserGlobals();

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const iframe: FakeIframe = { onerror: null, onabort: null };

    const settled = oxy.waitForIframeAuth(
      iframe as unknown as HTMLIFrameElement,
      100000,
      'https://auth.mention.earth',
    );

    await Promise.resolve();
    expect(typeof iframe.onerror).toBe('function');
    iframe.onerror?.call(iframe);

    await expect(settled).resolves.toBeNull();
    expect(iframe.onerror).toBeNull();
    expect(iframe.onabort).toBeNull();
  });

  it('resolves null immediately when the iframe fires onabort', async () => {
    installBrowserGlobals();

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const iframe: FakeIframe = { onerror: null, onabort: null };

    const settled = oxy.waitForIframeAuth(
      iframe as unknown as HTMLIFrameElement,
      100000,
      'https://auth.mention.earth',
    );

    await Promise.resolve();
    expect(typeof iframe.onabort).toBe('function');
    iframe.onabort?.call(iframe);

    await expect(settled).resolves.toBeNull();
  });
});
