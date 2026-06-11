/**
 * HttpService silent-reauth fallback regression tests.
 *
 * Locks in the fix for "session lost on page reload". On a web cold boot a valid
 * long-lived server session exists, but there is no in-memory access token, and
 * the bearer-protected `GET /session/token/:sessionId` returns 401 — which the
 * old code treated as a dead session and cleared, dumping the user to sign-in.
 *
 * The fix wires a silent-reauth handler (silent FedCM against the durable IdP
 * `fedcm_session` cookie) into HttpService as a last-resort token source. These
 * tests assert that:
 *
 *   1. a no-token request on web invokes the handler and, on success, sends the
 *      minted bearer (cold-boot recovery);
 *   2. a 401 whose session-based refresh fails invokes the handler and retries
 *      the request once before clearing tokens;
 *   3. with NO handler wired, nothing new happens (native / unconfigured);
 *   4. concurrent triggers invoke the handler at most ONCE (single-flight) so it
 *      can never storm `navigator.credentials.get`;
 *   5. after a failed reauth the handler is NOT retried within the cooldown
 *      window (storm protection for a genuinely signed-out user);
 *   6. the fallback never runs ON the IdP origin (it would re-auth itself);
 *   7. `setTokens` (a fresh sign-in) clears the cooldown so a later expiry can
 *      re-attempt immediately.
 *
 * `fetch` and `window` are stubbed so the platform-agnostic service runs under
 * the node test env exactly as it would in a browser cold boot.
 */

import { HttpService } from '../HttpService';
import { setPlatformOS } from '../utils/platform';
import type { OxyConfig } from '../models/interfaces';

const BASE_URL = 'https://api.oxy.so';

interface FetchCall {
  url: string;
  headers: Record<string, string>;
}

/**
 * Install a stubbed `fetch` that records calls and returns canned responses
 * keyed by a per-call resolver. Returns the recorded calls array.
 */
function installFetch(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown },
): FetchCall[] {
  const calls: FetchCall[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = (input: string, init: RequestInit = {}) => {
    const headers = (init.headers as Record<string, string>) || {};
    calls.push({ url: String(input), headers });
    const { status, body } = handler(String(input), init);
    const response = {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      clone() {
        return response;
      },
      json: async () => body,
      text: async () => JSON.stringify(body),
      blob: async () => ({}),
    };
    return Promise.resolve(response as unknown as Response);
  };
  return calls;
}

function installWindow(hostname: string): void {
  (globalThis as unknown as { window: unknown }).window = {
    location: { origin: `https://${hostname}`, hostname },
  };
}

function clearStubs(): void {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).fetch;
}

/**
 * Mint a JWT-shaped access token (header.payload.signature) with the given
 * expiry and sessionId. Only the payload is read (jwt-decode), so the signature
 * can be a placeholder.
 */
function makeToken(expSecondsFromNow: number, sessionId = 'sess_1'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sessionId,
      userId: 'user_1',
      exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
      iat: Math.floor(Date.now() / 1000),
    }),
  ).toString('base64url');
  return `${header}.${payload}.sig`;
}

const config: OxyConfig = {
  baseURL: BASE_URL,
  enableRetry: false,
};

describe('HttpService silent-reauth fallback (cold-boot session recovery)', () => {
  beforeEach(() => {
    setPlatformOS('web');
    installWindow('accounts.oxy.so');
  });

  afterEach(() => {
    clearStubs();
    jest.restoreAllMocks();
  });

  it('invokes the handler on a no-token request and sends the minted bearer', async () => {
    const freshToken = makeToken(900);
    let handlerCalls = 0;
    const calls = installFetch((url, init) => {
      // The CSRF endpoint may be hit for state-changing requests; this is a GET
      // so it should not be. Return the protected resource keyed on auth.
      const auth = (init.headers as Record<string, string>)?.Authorization;
      if (url.endsWith('/me')) {
        return auth ? { status: 200, body: { id: 'user_1' } } : { status: 401, body: { error: 'unauth' } };
      }
      return { status: 200, body: {} };
    });

    const http = new HttpService(config);
    http.setSilentReauthHandler(async () => {
      handlerCalls += 1;
      // Real handler plants the token into this same store before resolving.
      http.setTokens(freshToken);
      return freshToken;
    });

    const result = await http.get('/me', { cache: false, retry: false, deduplicate: false });

    expect(result).toEqual({ id: 'user_1' });
    expect(handlerCalls).toBe(1);
    // The protected resource was ultimately fetched WITH the minted bearer.
    const meCalls = calls.filter((c) => c.url.endsWith('/me'));
    expect(meCalls[meCalls.length - 1].headers.Authorization).toBe(`Bearer ${freshToken}`);
  });

  it('falls back to the handler when a 401 cannot be refreshed from the session', async () => {
    // A non-expired token is present (so getAuthHeader sends it), but the server
    // rejects it with 401 and the session-refresh endpoint also 401s — the
    // expiry/rotation case. The handler must then recover.
    const staleToken = makeToken(900, 'sess_stale');
    const freshToken = makeToken(900, 'sess_fresh');
    let handlerCalls = 0;

    installFetch((url, init) => {
      const auth = (init.headers as Record<string, string>)?.Authorization;
      if (url.includes('/session/token/')) {
        // Bearer-protected refresh: 401 in this scenario.
        return { status: 401, body: { error: 'unauth' } };
      }
      if (url.endsWith('/me')) {
        if (auth === `Bearer ${freshToken}`) {
          return { status: 200, body: { id: 'user_1' } };
        }
        return { status: 401, body: { error: 'unauth' } };
      }
      return { status: 200, body: {} };
    });

    const http = new HttpService(config);
    http.setTokens(staleToken);
    http.setSilentReauthHandler(async () => {
      handlerCalls += 1;
      http.setTokens(freshToken);
      return freshToken;
    });

    const result = await http.get('/me', { cache: false, retry: false, deduplicate: false });

    expect(result).toEqual({ id: 'user_1' });
    expect(handlerCalls).toBe(1);
  });

  it('does NOT attempt recovery when no handler is wired (native / unconfigured)', async () => {
    installFetch((url) => {
      if (url.endsWith('/me')) return { status: 401, body: { error: 'unauth' } };
      return { status: 200, body: {} };
    });

    const http = new HttpService(config);
    // No handler set.
    await expect(http.get('/me', { cache: false, retry: false, deduplicate: false })).rejects.toBeTruthy();
    // Token store was cleared by the 401 path.
    expect(http.hasAccessToken()).toBe(false);
  });

  it('single-flights the handler across concurrent no-token requests', async () => {
    const freshToken = makeToken(900);
    let handlerCalls = 0;
    installFetch((url, init) => {
      const auth = (init.headers as Record<string, string>)?.Authorization;
      if (url.match(/\/r\d$/)) {
        return auth ? { status: 200, body: { ok: true } } : { status: 401, body: { error: 'unauth' } };
      }
      return { status: 200, body: {} };
    });

    const http = new HttpService(config);
    http.setSilentReauthHandler(async () => {
      handlerCalls += 1;
      // Simulate the async credential round-trip so concurrent callers overlap.
      await new Promise((r) => setTimeout(r, 20));
      http.setTokens(freshToken);
      return freshToken;
    });

    // Fire several independent requests concurrently; all hit the no-token path.
    await Promise.all([
      http.get('/r1', { cache: false, retry: false, deduplicate: false }),
      http.get('/r2', { cache: false, retry: false, deduplicate: false }),
      http.get('/r3', { cache: false, retry: false, deduplicate: false }),
    ]);

    // The handler ran exactly once despite three concurrent triggers.
    expect(handlerCalls).toBe(1);
  });

  it('respects the cooldown after a failed reauth (no storm for signed-out users)', async () => {
    let handlerCalls = 0;
    installFetch((url) => {
      if (url.endsWith('/me')) return { status: 401, body: { error: 'unauth' } };
      return { status: 200, body: {} };
    });

    const http = new HttpService(config);
    http.setSilentReauthHandler(async () => {
      handlerCalls += 1;
      return null; // user genuinely signed out at IdP
    });

    // First request: handler runs, returns null, sets the cooldown.
    await expect(http.get('/me', { cache: false, retry: false, deduplicate: false })).rejects.toBeTruthy();
    expect(handlerCalls).toBe(1);

    // Second request immediately after: cooldown active → handler NOT called again.
    await expect(http.get('/me', { cache: false, retry: false, deduplicate: false })).rejects.toBeTruthy();
    expect(handlerCalls).toBe(1);
  });

  it('never runs the fallback on the IdP origin (would re-auth itself)', async () => {
    installWindow('auth.oxy.so'); // pretend we ARE the IdP
    let handlerCalls = 0;
    installFetch((url) => {
      if (url.endsWith('/me')) return { status: 401, body: { error: 'unauth' } };
      return { status: 200, body: {} };
    });

    const http = new HttpService({ ...config, authWebUrl: 'https://auth.oxy.so' });
    http.setSilentReauthHandler(async () => {
      handlerCalls += 1;
      return makeToken(900);
    });

    await expect(http.get('/me', { cache: false, retry: false, deduplicate: false })).rejects.toBeTruthy();
    // On the IdP origin the fallback is short-circuited.
    expect(handlerCalls).toBe(0);
  });

  it('clears the cooldown on setTokens so a later expiry can re-attempt', async () => {
    let handlerCalls = 0;
    installFetch((url, init) => {
      const auth = (init.headers as Record<string, string>)?.Authorization;
      if (url.endsWith('/me')) {
        return auth ? { status: 200, body: { id: 'user_1' } } : { status: 401, body: { error: 'unauth' } };
      }
      return { status: 200, body: {} };
    });

    const http = new HttpService(config);
    http.setSilentReauthHandler(async () => {
      handlerCalls += 1;
      return null; // fail first → arms cooldown
    });

    await expect(http.get('/me', { cache: false, retry: false, deduplicate: false })).rejects.toBeTruthy();
    expect(handlerCalls).toBe(1);

    // A real sign-in lands (e.g. interactive FedCM) — clears the cooldown.
    const freshToken = makeToken(900);
    http.setTokens(freshToken);

    // Now the handler is allowed to run again on the next no-token trigger.
    http.clearTokens();
    let succeeded = false;
    http.setSilentReauthHandler(async () => {
      handlerCalls += 1;
      http.setTokens(freshToken);
      succeeded = true;
      return freshToken;
    });
    await http.get('/me', { cache: false, retry: false, deduplicate: false });
    expect(succeeded).toBe(true);
    expect(handlerCalls).toBe(2);
  });
});
