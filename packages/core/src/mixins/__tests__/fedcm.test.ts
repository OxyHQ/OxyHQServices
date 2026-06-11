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
 * `reauthenticateSilently` is the cold-boot / expiry token-refresh primitive
 * wired into HttpService. It is a thin wrapper over `silentSignInWithFedCM`, so
 * it must (1) plant the freshly-minted access token before resolving and (2)
 * resolve `null` (never throw) when silent re-auth is unavailable — making it
 * safe to call directly from the HTTP refresh fallback.
 */
describe('OxyServices reauthenticateSilently (cold-boot refresh primitive)', () => {
  afterEach(() => {
    clearBrowserGlobals();
    jest.restoreAllMocks();
  });

  it('re-establishes a session and plants the access token', async () => {
    installBrowserGlobals({
      credentialsGet: async () => ({ type: 'identity', token: 'idp-id-token', isAutoSelected: true }),
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    jest
      .spyOn(oxy, 'makeRequest')
      .mockImplementation(async (_method: string, url: string) => {
        if (url === '/fedcm/nonce') {
          return { nonce: 'server-nonce', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
        }
        if (url === '/fedcm/exchange') {
          return {
            sessionId: 'sess_reauth',
            deviceId: 'dev_reauth',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            accessToken: 'reauth-access-token',
            user: { id: 'user_reauth', username: 'tester' },
          } as never;
        }
        throw new Error(`unexpected request to ${url}`);
      });

    const session = await oxy.reauthenticateSilently();

    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe('sess_reauth');
    expect(session?.accessToken).toBe('reauth-access-token');
    // The token was planted on the HTTP client (callers can read it immediately).
    expect(oxy.getAccessToken()).toBe('reauth-access-token');
  });

  it('resolves to null without throwing when silent mediation yields no credential', async () => {
    installBrowserGlobals({
      credentialsGet: async () => null, // user not signed in at the IdP
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    jest.spyOn(oxy, 'makeRequest').mockImplementation(async (_method: string, url: string) => {
      if (url === '/fedcm/nonce') {
        return { nonce: 'n', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
      }
      throw new Error(`unexpected request to ${url}`);
    });

    await expect(oxy.reauthenticateSilently()).resolves.toBeNull();
    expect(oxy.getAccessToken()).toBeNull();
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
 * Stale-loginHint clear-and-retry regression tests.
 *
 * A loginHint left over from a previously-signed-in/test account (persisted in
 * `oxy_fedcm_login_hint`) that matches NO account at the IdP makes Chrome
 * filter out every account, grey it in the chooser, and reject
 * `navigator.credentials.get` — indistinguishable from a user cancel. The
 * interactive flow must recover by clearing the bad hint and retrying ONCE with
 * no hint, so the genuinely available account becomes selectable again. These
 * tests lock that behaviour in.
 */
describe('OxyServices FedCM stale loginHint clear-and-retry', () => {
  afterEach(() => {
    clearBrowserGlobals();
    jest.restoreAllMocks();
  });

  it('clears a stale stored hint and retries the get() once with no hint, then succeeds', async () => {
    const hintsSeen: Array<string | undefined> = [];
    installBrowserGlobals({
      credentialsGet: async (opts) => {
        const hint = opts.identity.providers[0].loginHint;
        hintsSeen.push(hint);
        if (hint) {
          // First attempt carries the stale stored hint → Chrome filtered out
          // every account and rejected the request (NotAllowedError).
          const err = new Error('Accounts were received, but none matched the login hint.');
          err.name = 'NotAllowedError';
          throw err;
        }
        // Retry with NO hint → the available account resolves.
        return { type: 'identity', token: 'recovered-id-token', isAutoSelected: false };
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    // Seed a stale hint in localStorage (a previously-signed-in/test account).
    localStorage.setItem('oxy_fedcm_login_hint', 'stale-user-id');

    const exchanged: string[] = [];
    mintAndExchange(oxy, exchanged);

    const session = await oxy.signInWithFedCM();

    // The first get() saw the stale hint; the second saw none.
    expect(hintsSeen).toEqual(['stale-user-id', undefined]);
    // The token from the hint-less retry was exchanged for a session.
    expect(session.sessionId).toBe('sess_mode');
    expect(exchanged).toEqual(['recovered-id-token']);
    // The stale hint was cleared and replaced with the freshly signed-in id.
    expect(localStorage.getItem('oxy_fedcm_login_hint')).toBe('user_mode');
  });

  it('does NOT retry when there was no stored hint (a genuine cancel surfaces)', async () => {
    let callCount = 0;
    installBrowserGlobals({
      credentialsGet: async () => {
        callCount += 1;
        const err = new Error('User cancelled the sign-in.');
        err.name = 'NotAllowedError';
        throw err;
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    // No hint in storage → a NotAllowedError is a real cancel, not a mismatch,
    // so the error must surface (no clear-and-retry).
    jest.spyOn(oxy, 'makeRequest').mockImplementation(async (_method: string, url: string) => {
      if (url === '/fedcm/nonce') {
        return { nonce: 'n', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
      }
      throw new Error(`unexpected request to ${url}`);
    });

    await expect(oxy.signInWithFedCM()).rejects.toThrow('User cancelled the sign-in.');
    // Exactly one attempt — no clear-and-retry without a stored hint.
    expect(callCount).toBe(1);
  });

  it('does NOT clear or retry a caller-supplied loginHint (only stored hints are cleared)', async () => {
    let callCount = 0;
    installBrowserGlobals({
      credentialsGet: async () => {
        callCount += 1;
        const err = new Error('Accounts were received, but none matched the login hint.');
        err.name = 'NotAllowedError';
        throw err;
      },
    });

    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    // A leftover stored hint must be untouched: the caller explicitly chose the
    // hint, so we must not silently discard it nor retry behind their back.
    localStorage.setItem('oxy_fedcm_login_hint', 'persisted-hint');
    jest.spyOn(oxy, 'makeRequest').mockImplementation(async (_method: string, url: string) => {
      if (url === '/fedcm/nonce') {
        return { nonce: 'n', expiresAt: new Date(Date.now() + 60000).toISOString() } as never;
      }
      throw new Error(`unexpected request to ${url}`);
    });

    await expect(oxy.signInWithFedCM({ loginHint: 'caller-hint' })).rejects.toBeTruthy();
    // Exactly one attempt — caller-supplied hints are never auto-cleared/retried.
    expect(callCount).toBe(1);
    // The stored hint was left intact.
    expect(localStorage.getItem('oxy_fedcm_login_hint')).toBe('persisted-hint');
  });
});
