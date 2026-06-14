/**
 * Popup mixin regression tests.
 *
 * Locks in the §6c fix: cross-domain sign-in popups (auth.oxy.so) were being
 * blocked by Chrome on consumer apps (mention.earth, homiio.com, alia.onl)
 * because the caller chain awaited FedCM / silent SSO BEFORE
 * `signInWithPopup` reached `window.open`. The transient user-activation
 * had been consumed by the first `await`, so the popup-blocker killed the
 * subsequent `window.open` call.
 *
 * The fix exposes two new affordances on the popup mixin:
 *   1. `openBlankPopup(width?, height?)` — a public, synchronous helper that
 *      callers invoke from the raw user-gesture handler BEFORE any await, so
 *      the popup is opened while the activation is still live.
 *   2. `signInWithPopup({ popup })` — accepts the pre-opened window handle
 *      and navigates IT to the auth URL instead of issuing a fresh
 *      `window.open` (which would now be blocked).
 *
 * Backward compat: callers that omit `popup` keep the legacy behaviour (the
 * mixin opens its own popup via `openCenteredPopup`). The browser globals
 * are stubbed so the platform-agnostic mixin can run under the node test
 * env.
 */

import { OxyServices } from '../../OxyServices';

const ORIGIN = 'https://mention.earth';

interface MockPopup {
  closed: boolean;
  close: jest.Mock;
  location: {
    href: string;
    replace: jest.Mock;
  };
}

function createMockPopup(overrides: Partial<MockPopup> = {}): MockPopup {
  return {
    closed: false,
    close: jest.fn(),
    location: {
      href: '',
      replace: jest.fn(function (this: { href: string }, url: string) {
        this.href = url;
      }),
    },
    ...overrides,
  };
}

function installBrowserGlobals(options: {
  windowOpen?: jest.Mock;
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
    screenX: 0,
    screenY: 0,
    outerWidth: 1280,
    outerHeight: 800,
    sessionStorage: sessionStorageStub,
    open: options.windowOpen ?? jest.fn(() => null),
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
  // `crypto.randomUUID` already exists in node 20+ test env — leave it.
}

function clearBrowserGlobals(): void {
  for (const key of ['window', 'sessionStorage'] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

describe('OxyServices popup mixin — pre-opened popup option', () => {
  afterEach(() => {
    clearBrowserGlobals();
    jest.restoreAllMocks();
  });

  it('navigates a pre-opened popup to the auth URL instead of opening a new one', async () => {
    const windowOpen = jest.fn();
    installBrowserGlobals({ windowOpen });
    const popup = createMockPopup();

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    // Resolve `signInWithPopup` as soon as the popup is navigated — we only
    // care about the open path, not the full postMessage round-trip.
    let dispatchedAuthUrl: string | null = null;
    popup.location.replace.mockImplementation(function (this: MockPopup['location'], url: string) {
      this.href = url;
      dispatchedAuthUrl = url;
    });

    // Fire the auth-success message immediately after navigation. We do this
    // by intercepting `addEventListener` above.
    const messagePromise = new Promise<void>((resolve) => {
      // Patch addEventListener to capture the handler and dispatch a fake
      // success message on the next microtask.
      const origAdd = (globalThis as unknown as { window: { addEventListener: typeof window.addEventListener } }).window.addEventListener;
      (globalThis as unknown as { window: { addEventListener: typeof window.addEventListener } }).window.addEventListener =
        (event: string, handler: EventListenerOrEventListenerObject) => {
          origAdd(event, handler);
          if (event === 'message') {
            queueMicrotask(() => {
              // We need the state from the URL the popup was navigated to.
              const url = new URL(dispatchedAuthUrl ?? '');
              const state = url.searchParams.get('state') ?? '';
              (handler as (e: { origin: string; data: unknown }) => void)({
                origin: 'https://auth.oxy.so',
                data: {
                  type: 'oxy_auth_response',
                  state,
                  session: {
                    sessionId: 'sess_pre_opened',
                    deviceId: 'dev_pre',
                    expiresAt: new Date(Date.now() + 60000).toISOString(),
                    accessToken: 'access_pre',
                    user: { id: 'user_pre', username: 'tester' },
                  },
                },
              });
              resolve();
            });
          }
        };
    });

    const session = await oxy.signInWithPopup({ popup: popup as unknown as Window });
    await messagePromise;

    // The pre-opened popup was navigated — `window.open` was NEVER called.
    expect(windowOpen).not.toHaveBeenCalled();
    expect(popup.location.replace).toHaveBeenCalledTimes(1);
    expect(popup.location.replace).toHaveBeenCalledWith(expect.stringContaining('https://auth.oxy.so/login'));
    expect(session.sessionId).toBe('sess_pre_opened');
  });

  it('throws a "window was closed" (cancelled) error — NOT "popup blocked" — when the pre-opened handle is already closed', async () => {
    const windowOpen = jest.fn();
    installBrowserGlobals({ windowOpen });
    const popup = createMockPopup({ closed: true });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    // The popup DID open (the blocker allowed it) and the user closed it.
    // The error must communicate a cancel, never a blocker rejection —
    // consumers map "blocked" to "please allow popups" UX guidance, which
    // would be wrong here.
    await expect(
      oxy.signInWithPopup({ popup: popup as unknown as Window })
    ).rejects.toThrow(/Sign-in window was closed/);
    await expect(
      oxy.signInWithPopup({ popup: popup as unknown as Window })
    ).rejects.not.toThrow(/Popup blocked/);

    // Did not attempt to open a fresh popup either.
    expect(windowOpen).not.toHaveBeenCalled();
    expect(popup.location.replace).not.toHaveBeenCalled();
  });

  it('falls back to assigning `location.href` when `location.replace` throws (sandboxed environments)', async () => {
    const windowOpen = jest.fn();
    installBrowserGlobals({ windowOpen });

    // Some sandboxed / cross-origin-locked environments make `location.replace`
    // throw. The mixin must recover with a plain `href` assignment so the
    // popup still gets navigated. This is the only path that exercises the
    // catch-and-log branch in OxyServices.popup.ts.
    const popup: MockPopup = {
      closed: false,
      close: jest.fn(),
      location: {
        href: '',
        replace: jest.fn(() => {
          throw new Error('SecurityError: replace blocked by sandbox');
        }),
      },
    };

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    // Drive `signInWithPopup` only until the navigation happens, then abort
    // via `closed = true` so the poll loop's cancel path resolves the promise.
    const promise = oxy.signInWithPopup({ popup: popup as unknown as Window });
    // Let the synchronous popup-navigation path run.
    await Promise.resolve();
    popup.closed = true;

    await expect(promise).rejects.toThrow(/cancelled|timeout/i);

    // `replace` was attempted (and threw); the fallback wrote to `href`.
    expect(popup.location.replace).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toMatch(/^https:\/\/auth\.oxy\.so\/login/);
    // No fresh popup was opened.
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('falls back to opening its own popup when `popup` option is omitted (classic behaviour)', async () => {
    const fallbackPopup = createMockPopup();
    const windowOpen = jest.fn(() => fallbackPopup);
    installBrowserGlobals({ windowOpen });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    // Don't actually wait for the full flow; intercept after `window.open`
    // is called and abort.
    const promise = oxy.signInWithPopup();
    // Allow the synchronous `window.open` path to run.
    await Promise.resolve();
    fallbackPopup.closed = true; // trigger "Authentication cancelled by user"

    await expect(promise).rejects.toThrow(/cancelled|timeout/i);

    expect(windowOpen).toHaveBeenCalledTimes(1);
    // The first arg is the auth URL (not 'about:blank').
    expect((windowOpen.mock.calls[0] as unknown[])[0]).toMatch(/^https:\/\/auth\.oxy\.so\/login/);
  });

  it('throws "popup blocked" when the legacy path is used and `window.open` returns null', async () => {
    const windowOpen = jest.fn(() => null);
    installBrowserGlobals({ windowOpen });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    await expect(oxy.signInWithPopup()).rejects.toThrow(/Popup blocked/);
    expect(windowOpen).toHaveBeenCalledTimes(1);
  });
});

describe('OxyServices popup mixin — openBlankPopup helper', () => {
  afterEach(() => {
    clearBrowserGlobals();
    jest.restoreAllMocks();
  });

  it('opens about:blank synchronously and returns the window handle', () => {
    const fakePopup = createMockPopup();
    const windowOpen = jest.fn(() => fakePopup);
    installBrowserGlobals({ windowOpen });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const popup = oxy.openBlankPopup();

    expect(windowOpen).toHaveBeenCalledTimes(1);
    const args = windowOpen.mock.calls[0] as unknown[];
    expect(args[0]).toBe('about:blank');
    expect(args[1]).toBe('Oxy Sign In');
    // Features string should include the default width/height.
    expect(typeof args[2]).toBe('string');
    expect(args[2] as string).toContain('width=500');
    expect(args[2] as string).toContain('height=700');
    expect(popup).toBe(fakePopup);
  });

  it('returns null when the browser blocks the popup', () => {
    const windowOpen = jest.fn(() => null);
    installBrowserGlobals({ windowOpen });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const popup = oxy.openBlankPopup();

    expect(popup).toBeNull();
  });

  it('honors caller-supplied dimensions', () => {
    const fakePopup = createMockPopup();
    const windowOpen = jest.fn(() => fakePopup);
    installBrowserGlobals({ windowOpen });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    oxy.openBlankPopup(640, 480);

    const args = windowOpen.mock.calls[0] as unknown[];
    expect(args[2] as string).toContain('width=640');
    expect(args[2] as string).toContain('height=480');
  });

  it('returns null in non-browser environments', () => {
    // No browser globals installed.
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    expect(oxy.openBlankPopup()).toBeNull();
  });
});

/**
 * `waitForIframeAuth` fail-fast regression tests.
 *
 * The cross-domain durable-restore iframe (`/auth/silent` at the per-apex host)
 * posts a message on success. On a FAILED load — host unreachable, blocked by
 * CSP `frame-ancestors`/`X-Frame-Options`, or a dropped network — it never
 * posts, so without an `onerror`/`onabort` handler the silent restore would
 * block for the FULL timeout (dead latency in the cold-boot critical path). The
 * handler must resolve `null` immediately on a load failure, well before the
 * timeout fires.
 */
interface FakeIframe {
  onerror: ((this: unknown, ...args: unknown[]) => unknown) | null;
  onabort: ((this: unknown, ...args: unknown[]) => unknown) | null;
}

describe('OxyServices waitForIframeAuth fail-fast on iframe load error', () => {
  afterEach(() => {
    clearBrowserGlobals();
    jest.restoreAllMocks();
  });

  it('resolves null immediately when the iframe fires onerror (does not wait for the timeout)', async () => {
    installBrowserGlobals();

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const iframe: FakeIframe = { onerror: null, onabort: null };

    // A long timeout proves the resolution comes from `onerror`, not the timer.
    const LONG_TIMEOUT = 100000;
    const settled = oxy.waitForIframeAuth(
      iframe as unknown as HTMLIFrameElement,
      LONG_TIMEOUT,
      'https://auth.mention.earth',
    );

    // The handler is installed synchronously; fire it on the next tick.
    await Promise.resolve();
    expect(typeof iframe.onerror).toBe('function');
    iframe.onerror?.call(iframe);

    await expect(settled).resolves.toBeNull();
    // Cleanup detaches the handlers so a late event cannot double-resolve.
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
