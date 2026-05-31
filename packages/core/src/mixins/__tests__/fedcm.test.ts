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
