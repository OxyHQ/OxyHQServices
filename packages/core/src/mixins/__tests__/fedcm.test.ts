/**
 * FedCM mixin regression tests.
 *
 * Locks in the fix for the broken SSO token exchange: the API's H9 hardening
 * (commit 21af7c48) made `/fedcm/exchange` require a server-minted,
 * origin-bound nonce, but the SDK was still generating a purely local nonce
 * that the API always rejected with `invalid_nonce`. These tests assert that
 * both the silent and interactive FedCM flows now:
 *
 *   1. mint a nonce from `POST /fedcm/nonce` and pass THAT nonce (not a local
 *      UUID) to `navigator.credentials.get`;
 *   2. fall back to a local nonce if the mint endpoint is unreachable, rather
 *      than throwing before the browser UI can show;
 *   3. resolve silent SSO cleanly to `null` (never throw into a retry loop)
 *      when the browser returns no credential or rejects the request.
 *
 * The browser globals (`window`, `navigator.credentials`, `IdentityCredential`)
 * are stubbed so the platform-agnostic mixin can run under the node test env.
 */

import { OxyServices } from '../../OxyServices';
import { __resetSilentSSOMemoForTests } from '../OxyServices.fedcm';

interface CredentialGetCall {
  identity: {
    providers: Array<{ configURL: string; clientId: string; nonce: string; params?: { nonce?: string } }>;
    mode?: string;
  };
  mediation: string;
}

const ORIGIN = 'https://accounts.oxy.so';

function installBrowserGlobals(options: {
  credentialsGet: (opts: CredentialGetCall) => Promise<unknown>;
}): void {
  const store = new Map<string, string>();
  const localStorageStub = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const nav = {
    credentials: {
      get: (opts: CredentialGetCall) => options.credentialsGet(opts),
    },
  };
  // `isFedCMSupported()` checks: 'IdentityCredential' in window &&
  // 'navigator' in window && 'credentials' in navigator. The stub must expose
  // all three the way a real browser does.
  const win = {
    location: { origin: ORIGIN, hostname: 'accounts.oxy.so' },
    IdentityCredential: function IdentityCredential() {},
    navigator: nav,
    localStorage: localStorageStub,
  };
  (globalThis as unknown as { window: unknown }).window = win;
  (globalThis as unknown as { navigator: unknown }).navigator = nav;
  (globalThis as unknown as { localStorage: unknown }).localStorage = localStorageStub;
  (globalThis as unknown as { IdentityCredential: unknown }).IdentityCredential = win.IdentityCredential;
}

function clearBrowserGlobals(): void {
  for (const key of ['window', 'navigator', 'localStorage', 'IdentityCredential'] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

describe('OxyServices FedCM nonce binding', () => {
  afterEach(() => {
    clearBrowserGlobals();
    jest.restoreAllMocks();
    // The silent-SSO memo is module-scoped and survives between `it` blocks.
    // Each test that calls `silentSignInWithFedCM` expects a fresh browser
    // invocation, so reset the memo (a real page load would do the same by
    // starting a fresh module scope).
    __resetSilentSSOMemoForTests();
  });

  it('silent SSO mints a server nonce and forwards it to the browser', async () => {
    let credentialCall: CredentialGetCall | null = null;
    installBrowserGlobals({
      credentialsGet: async (opts) => {
        credentialCall = opts;
        // Browser returns no credential (user not logged in at IdP)
        return null;
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const makeRequest = jest
      .spyOn(oxy, 'makeRequest')
      .mockImplementation(async (_method: string, url: string) => {
        if (url === '/fedcm/nonce') {
          return { nonce: 'server-minted-nonce-123', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
        }
        throw new Error(`unexpected request to ${url}`);
      });

    const result = await oxy.silentSignInWithFedCM();

    expect(result).toBeNull();
    // The mint endpoint was hit
    expect(makeRequest).toHaveBeenCalledWith('POST', '/fedcm/nonce', {}, { cache: false });
    // The server nonce — not a random UUID — was passed to the browser
    expect(credentialCall).not.toBeNull();
    const call = credentialCall as unknown as CredentialGetCall;
    expect(call.identity.providers[0].nonce).toBe('server-minted-nonce-123');
    expect(call.identity.providers[0].params?.nonce).toBe('server-minted-nonce-123');
    expect(call.mediation).toBe('silent');
  });

  it('interactive sign-in mints a server nonce and exchanges the returned token', async () => {
    installBrowserGlobals({
      credentialsGet: async () => ({ type: 'identity', token: 'idp-id-token', isAutoSelected: false }),
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const exchanged: string[] = [];
    jest
      .spyOn(oxy, 'makeRequest')
      .mockImplementation(async (_method: string, url: string, data?: unknown) => {
        if (url === '/fedcm/nonce') {
          return { nonce: 'server-minted-nonce-xyz', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
        }
        if (url === '/fedcm/exchange') {
          exchanged.push((data as { id_token: string }).id_token);
          return {
            sessionId: 'sess_1',
            deviceId: 'dev_1',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            accessToken: 'access_1',
            user: { id: 'user_1', username: 'tester' },
          } as never;
        }
        throw new Error(`unexpected request to ${url}`);
      });

    const session = await oxy.signInWithFedCM();

    expect(session.sessionId).toBe('sess_1');
    // The browser-issued token was exchanged for a session
    expect(exchanged).toEqual(['idp-id-token']);
  });

  it('falls back to a local nonce when the mint endpoint is unreachable', async () => {
    let credentialCall: CredentialGetCall | null = null;
    installBrowserGlobals({
      credentialsGet: async (opts) => {
        credentialCall = opts;
        return null;
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    jest.spyOn(oxy, 'makeRequest').mockImplementation(async (_method: string, url: string) => {
      if (url === '/fedcm/nonce') {
        throw new Error('network down');
      }
      throw new Error(`unexpected request to ${url}`);
    });

    const result = await oxy.silentSignInWithFedCM();

    // Did not throw; resolved cleanly to null
    expect(result).toBeNull();
    // Still passed a (locally generated) non-empty nonce to the browser
    expect(credentialCall).not.toBeNull();
    const call = credentialCall as unknown as CredentialGetCall;
    expect(typeof call.identity.providers[0].nonce).toBe('string');
    expect(call.identity.providers[0].nonce.length).toBeGreaterThan(0);
  });

  it('silent SSO resolves to null (no throw) when the browser rejects', async () => {
    installBrowserGlobals({
      credentialsGet: async () => {
        const err = new Error('User not signed in');
        err.name = 'NotAllowedError';
        throw err;
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    jest.spyOn(oxy, 'makeRequest').mockImplementation(async (_method: string, url: string) => {
      if (url === '/fedcm/nonce') {
        return { nonce: 'n', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
      }
      throw new Error(`unexpected request to ${url}`);
    });

    await expect(oxy.silentSignInWithFedCM()).resolves.toBeNull();
  });
});

/**
 * FedCM `mode` enum regression tests.
 *
 * The W3C FedCM spec renamed `IdentityCredentialRequestOptions.mode`:
 * `'button'` → `'active'` and `'widget'` → `'passive'`. Modern Chrome rejects
 * the legacy values with a synchronous `TypeError`; Chrome 125–131 only knows
 * the legacy values. These tests lock in that:
 *
 *   1. the interactive button flow requests the MODERN `mode: 'active'`;
 *   2. a `TypeError` on the modern value triggers a single retry with the
 *      LEGACY `'button'` value (so older Chrome still works);
 *   3. the silent SSO path sends NO `mode` at all (mode and mediation are
 *      independent fields).
 */
function mintAndExchange(oxy: OxyServices, exchanged: string[]): void {
  jest
    .spyOn(oxy, 'makeRequest')
    .mockImplementation(async (_method: string, url: string, data?: unknown) => {
      if (url === '/fedcm/nonce') {
        return { nonce: 'server-nonce', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
      }
      if (url === '/fedcm/exchange') {
        exchanged.push((data as { id_token: string }).id_token);
        return {
          sessionId: 'sess_mode',
          deviceId: 'dev_mode',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          accessToken: 'access_mode',
          user: { id: 'user_mode', username: 'tester' },
        } as never;
      }
      throw new Error(`unexpected request to ${url}`);
    });
}

describe('OxyServices FedCM mode enum (active/passive)', () => {
  afterEach(() => {
    clearBrowserGlobals();
    jest.restoreAllMocks();
    __resetSilentSSOMemoForTests();
  });

  it('interactive sign-in requests the modern mode: "active"', async () => {
    const modesSeen: Array<string | undefined> = [];
    installBrowserGlobals({
      credentialsGet: async (opts) => {
        modesSeen.push(opts.identity.mode);
        return { type: 'identity', token: 'idp-id-token', isAutoSelected: false };
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const exchanged: string[] = [];
    mintAndExchange(oxy, exchanged);

    const session = await oxy.signInWithFedCM();

    expect(session.sessionId).toBe('sess_mode');
    // The modern W3C value — never the legacy 'button' — is sent first.
    expect(modesSeen).toEqual(['active']);
    expect(exchanged).toEqual(['idp-id-token']);
  });

  it('retries with legacy mode "button" when the browser rejects "active" with a TypeError', async () => {
    const modesSeen: Array<string | undefined> = [];
    installBrowserGlobals({
      credentialsGet: async (opts) => {
        modesSeen.push(opts.identity.mode);
        // First call (modern 'active'): emulate Chrome 125–131 rejecting the
        // unknown enum value synchronously with a TypeError.
        if (opts.identity.mode === 'active') {
          throw new TypeError(
            "The provided value 'active' is not a valid enum value of type IdentityCredentialRequestOptionsMode."
          );
        }
        // Second call (legacy 'button'): the old browser accepts it.
        return { type: 'identity', token: 'legacy-id-token', isAutoSelected: false };
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const exchanged: string[] = [];
    mintAndExchange(oxy, exchanged);

    const session = await oxy.signInWithFedCM();

    expect(session.sessionId).toBe('sess_mode');
    // Tried modern 'active' first, then fell back to legacy 'button'.
    expect(modesSeen).toEqual(['active', 'button']);
    // The token from the successful legacy retry was exchanged.
    expect(exchanged).toEqual(['legacy-id-token']);
  });

  it('does not retry (and surfaces the error) when a non-mode TypeError is thrown', async () => {
    let callCount = 0;
    installBrowserGlobals({
      credentialsGet: async () => {
        callCount += 1;
        throw new TypeError('Failed to fetch the FedCM config file.');
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const exchanged: string[] = [];
    mintAndExchange(oxy, exchanged);

    await expect(oxy.signInWithFedCM()).rejects.toThrow('Failed to fetch the FedCM config file.');
    // Only one attempt — an unrelated TypeError must not trigger the legacy retry.
    expect(callCount).toBe(1);
  });

  it('silent SSO sends no mode (mode and mediation are independent fields)', async () => {
    let credentialCall: CredentialGetCall | null = null;
    installBrowserGlobals({
      credentialsGet: async (opts) => {
        credentialCall = opts;
        return null;
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    jest.spyOn(oxy, 'makeRequest').mockImplementation(async (_method: string, url: string) => {
      if (url === '/fedcm/nonce') {
        return { nonce: 'n', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
      }
      throw new Error(`unexpected request to ${url}`);
    });

    await oxy.silentSignInWithFedCM();

    expect(credentialCall).not.toBeNull();
    const call = credentialCall as unknown as CredentialGetCall;
    expect(call.mediation).toBe('silent');
    expect(call.identity.mode).toBeUndefined();
  });
});

/**
 * Page-load silent-SSO run-once guard.
 *
 * Silent SSO must invoke `navigator.credentials.get` AT MOST ONCE per page
 * load, even when multiple consumers / remounts / StrictMode call
 * `silentSignInWithFedCM()` repeatedly. The guard lives at the chokepoint in
 * core: the first silent attempt for an `origin + baseURL` runs; concurrent
 * callers share the in-flight promise; later callers get the memoized result
 * (session OR null) without re-invoking the browser.
 *
 * Interactive sign-in (`signInWithFedCM`) is NOT memoized — a user clicking the
 * sign-in button must always be able to re-prompt. That is asserted too.
 */
describe('OxyServices FedCM silent-SSO page-load guard', () => {
  afterEach(() => {
    clearBrowserGlobals();
    jest.restoreAllMocks();
    __resetSilentSSOMemoForTests();
  });

  it('invokes the browser at most once across repeated silent calls and returns the memoized result', async () => {
    let getCallCount = 0;
    installBrowserGlobals({
      credentialsGet: async () => {
        getCallCount += 1;
        return { type: 'identity', token: 'idp-token', isAutoSelected: true };
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    let exchangeCount = 0;
    jest.spyOn(oxy, 'makeRequest').mockImplementation(async (_method: string, url: string) => {
      if (url === '/fedcm/nonce') {
        return { nonce: 'n', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
      }
      if (url === '/fedcm/exchange') {
        exchangeCount += 1;
        return {
          sessionId: 'sess_guard',
          deviceId: 'dev_guard',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          accessToken: 'access_guard',
          user: { id: 'user_guard', username: 'tester' },
        } as never;
      }
      throw new Error(`unexpected request to ${url}`);
    });

    const first = await oxy.silentSignInWithFedCM();
    const second = await oxy.silentSignInWithFedCM();
    const third = await oxy.silentSignInWithFedCM();

    // The browser credential request fired exactly once.
    expect(getCallCount).toBe(1);
    // The token exchange ran exactly once too (the whole flow is memoized).
    expect(exchangeCount).toBe(1);
    // Every caller received the same memoized session.
    expect(first?.sessionId).toBe('sess_guard');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('shares a single in-flight browser call across concurrent silent callers', async () => {
    let getCallCount = 0;
    let resolveGet: ((value: unknown) => void) | null = null;
    installBrowserGlobals({
      credentialsGet: () =>
        new Promise((resolve) => {
          getCallCount += 1;
          resolveGet = resolve;
        }),
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    jest.spyOn(oxy, 'makeRequest').mockImplementation(async (_method: string, url: string) => {
      if (url === '/fedcm/nonce') {
        return { nonce: 'n', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
      }
      if (url === '/fedcm/exchange') {
        return {
          sessionId: 'sess_concurrent',
          deviceId: 'dev_concurrent',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          accessToken: 'access_concurrent',
          user: { id: 'user_concurrent', username: 'tester' },
        } as never;
      }
      throw new Error(`unexpected request to ${url}`);
    });

    // Fire three silent calls before the first browser request resolves.
    const p1 = oxy.silentSignInWithFedCM();
    const p2 = oxy.silentSignInWithFedCM();
    const p3 = oxy.silentSignInWithFedCM();

    // Let the in-flight nonce/get chain start, then release the browser call.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(getCallCount).toBe(1);
    expect(resolveGet).not.toBeNull();
    (resolveGet as unknown as (value: unknown) => void)({
      type: 'identity',
      token: 'idp-token',
      isAutoSelected: true,
    });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    // Only one browser invocation despite three concurrent callers.
    expect(getCallCount).toBe(1);
    expect(r1?.sessionId).toBe('sess_concurrent');
    expect(r2).toBe(r1);
    expect(r3).toBe(r1);
  });

  it('memoizes a null result (user not signed in) without re-invoking the browser', async () => {
    let getCallCount = 0;
    installBrowserGlobals({
      credentialsGet: async () => {
        getCallCount += 1;
        return null; // user not logged in at IdP
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    jest.spyOn(oxy, 'makeRequest').mockImplementation(async (_method: string, url: string) => {
      if (url === '/fedcm/nonce') {
        return { nonce: 'n', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
      }
      throw new Error(`unexpected request to ${url}`);
    });

    const first = await oxy.silentSignInWithFedCM();
    const second = await oxy.silentSignInWithFedCM();

    expect(first).toBeNull();
    expect(second).toBeNull();
    // The null verdict is memoized — the browser is not asked again.
    expect(getCallCount).toBe(1);
  });

  it('does NOT memoize interactive sign-in (each click can re-prompt the browser)', async () => {
    let getCallCount = 0;
    installBrowserGlobals({
      credentialsGet: async () => {
        getCallCount += 1;
        return { type: 'identity', token: `idp-token-${getCallCount}`, isAutoSelected: false };
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    jest.spyOn(oxy, 'makeRequest').mockImplementation(async (_method: string, url: string) => {
      if (url === '/fedcm/nonce') {
        return { nonce: 'n', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
      }
      if (url === '/fedcm/exchange') {
        return {
          sessionId: 'sess_interactive',
          deviceId: 'dev_interactive',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          accessToken: 'access_interactive',
          user: { id: 'user_interactive', username: 'tester' },
        } as never;
      }
      throw new Error(`unexpected request to ${url}`);
    });

    await oxy.signInWithFedCM();
    await oxy.signInWithFedCM();

    // Interactive flow is never gated by the silent memo.
    expect(getCallCount).toBe(2);
  });
});
