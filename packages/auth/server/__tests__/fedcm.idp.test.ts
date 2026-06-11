/**
 * FedCM IdP server (auth.oxy.so) endpoint tests.
 *
 * Validates the spec-compliance fixes for the Hono identity-provider server:
 *
 *   1. `/.well-known/web-identity` is served with `Content-Type:
 *      application/json` (Chrome rejects `application/octet-stream`).
 *   2. The `id_assertion_endpoint` (`/fedcm/assertion`) echoes the RP origin
 *      in `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials`
 *      (without these the browser discards the token).
 *   3. The accounts / assertion / disconnect endpoints enforce the
 *      `Sec-Fetch-Dest: webidentity` CSRF guard mandated by the spec.
 *   4. The assertion endpoint mints a JWT whose `nonce` claim echoes the RP
 *      nonce, signed with FEDCM_TOKEN_SECRET (HS256).
 *
 * Run with `bun test`. The upstream Oxy API (`api.oxy.so`) is stubbed via a
 * global `fetch` mock so no network is touched.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { createHmac } from 'node:crypto';

const RP_ORIGIN = 'https://accounts.oxy.so';
const TEST_SECRET = 'test-fedcm-secret';
const TEST_USER_ID = '507f1f77bcf86cd799439011';

// Configure env BEFORE importing the server module (it reads env at load).
process.env.FEDCM_TOKEN_SECRET = TEST_SECRET;
process.env.FEDCM_ISSUER = 'https://auth.oxy.so';
process.env.OXY_API_URL = 'https://api.oxy.so';
process.env.NODE_ENV = 'test';

// Stub the upstream Oxy API. The IdP server resolves the FedCM session cookie
// to a user via the PUBLIC, cookie-less endpoint:
//   GET  /session/validate/:id  -> { valid: boolean, user: { id, ... } }
// (NOT `/session/user/:id`, which is bearer-protected and would 401 here —
// the IdP server has no user access token to present.)
//
// The `user` shape mirrors the real API's `formatUserResponse`: the id field
// is `id` (stringified Mongo `_id`), never `_id`.
const realFetch = globalThis.fetch;
function installApiStub(): void {
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/session/validate/')) {
      return new Response(
        JSON.stringify({
          valid: true,
          user: { id: TEST_USER_ID, username: 'tester', email: 'tester@oxy.so', name: { full: 'Test User' } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: { request: (path: string, init?: RequestInit) => Promise<Response> };

beforeAll(async () => {
  installApiStub();
  const mod = await import('../index');
  app = mod.app as typeof app;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  installApiStub();
});

const SESSION_COOKIE = 'fedcm_session=sess_abc';
const WEBIDENTITY = { 'sec-fetch-dest': 'webidentity' } as Record<string, string>;

describe('GET /.well-known/web-identity', () => {
  it('is served as application/json with the provider_urls', async () => {
    const res = await app.request('/.well-known/web-identity');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { provider_urls: string[] };
    expect(body.provider_urls).toEqual(['https://auth.oxy.so/fedcm.json']);
  });
});

describe('GET /fedcm/accounts', () => {
  it('rejects requests without Sec-Fetch-Dest: webidentity', async () => {
    const res = await app.request('/fedcm/accounts', {
      headers: { cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(400);
  });

  it('returns the logged-in account for a valid session + webidentity dest', async () => {
    const res = await app.request('/fedcm/accounts', {
      headers: { ...WEBIDENTITY, cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: Array<{ id: string }> };
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].id).toBe(TEST_USER_ID);
  });

  it('signals logged-out with 401 + WWW-Authenticate when no session cookie is present', async () => {
    // Per the FedCM spec a logged-out accounts response MUST be a 401 (not a
    // 200 with an empty list). An empty 200 list is an INVALID accounts
    // response in Chromium and aborts the flow with "Error retrieving a token"
    // showing no UI; the 401 + WWW-Authenticate is what lets the browser open
    // the login_url.
    const res = await app.request('/fedcm/accounts', { headers: { ...WEBIDENTITY } });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('FedCM');
    expect(res.headers.get('set-login')).toBe('logged-out');
  });
});

describe('POST /fedcm/assertion', () => {
  it('rejects requests without Sec-Fetch-Dest: webidentity', async () => {
    const res = await app.request('/fedcm/assertion', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: SESSION_COOKIE },
      body: new URLSearchParams({ account_id: TEST_USER_ID, client_id: RP_ORIGIN, nonce: 'rp-nonce' }).toString(),
    });
    expect(res.status).toBe(400);
  });

  it('echoes the RP origin in CORS headers and mints a signed token with the nonce', async () => {
    const res = await app.request('/fedcm/assertion', {
      method: 'POST',
      headers: {
        ...WEBIDENTITY,
        'content-type': 'application/x-www-form-urlencoded',
        origin: RP_ORIGIN,
        cookie: SESSION_COOKIE,
      },
      body: new URLSearchParams({ account_id: TEST_USER_ID, client_id: RP_ORIGIN, nonce: 'rp-nonce-42' }).toString(),
    });

    expect(res.status).toBe(200);
    // CORS — required for the browser to accept the token
    expect(res.headers.get('access-control-allow-origin')).toBe(RP_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');

    const body = (await res.json()) as { token: string };
    expect(typeof body.token).toBe('string');

    // Verify the JWT: HS256 signature + nonce/aud/sub claims
    const [headerB64, payloadB64, sigB64] = body.token.split('.');
    const expectedSig = createHmac('sha256', TEST_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    expect(sigB64).toBe(expectedSig);

    const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
    expect(payload.nonce).toBe('rp-nonce-42');
    expect(payload.aud).toBe(RP_ORIGIN);
    expect(payload.sub).toBe(TEST_USER_ID);
    expect(payload.iss).toBe('https://auth.oxy.so');
  });

  it('returns 401 with WWW-Authenticate when not logged in at the IdP', async () => {
    const res = await app.request('/fedcm/assertion', {
      method: 'POST',
      headers: {
        ...WEBIDENTITY,
        'content-type': 'application/x-www-form-urlencoded',
        origin: RP_ORIGIN,
      },
      body: new URLSearchParams({ account_id: TEST_USER_ID, client_id: RP_ORIGIN }).toString(),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('FedCM');
  });
});

describe('POST /fedcm/disconnect', () => {
  it('rejects requests without Sec-Fetch-Dest: webidentity', async () => {
    const res = await app.request('/fedcm/disconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: SESSION_COOKIE },
      body: new URLSearchParams({ account_hint: TEST_USER_ID }).toString(),
    });
    expect(res.status).toBe(400);
  });

  it('returns the disconnected account_id per spec', async () => {
    const res = await app.request('/fedcm/disconnect', {
      method: 'POST',
      headers: {
        ...WEBIDENTITY,
        'content-type': 'application/x-www-form-urlencoded',
        origin: RP_ORIGIN,
        cookie: SESSION_COOKIE,
      },
      body: new URLSearchParams({ account_hint: TEST_USER_ID }).toString(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(RP_ORIGIN);
    const body = (await res.json()) as { account_id: string };
    expect(body.account_id).toBe(TEST_USER_ID);
  });
});

describe('POST /fedcm/set-session', () => {
  it('sets the fedcm_session cookie with Secure + SameSite=None for a valid session', async () => {
    const res = await app.request('/fedcm/set-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess_abc', action: 'login' }),
    });
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('fedcm_session=');
    // SameSite=None REQUIRES Secure — without it Chrome silently drops the
    // cookie (hard rule since Chrome 80), which broke the FedCM accounts loop.
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).toMatch(/;\s*SameSite=None/i);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(res.headers.get('set-login')).toBe('logged-in');
  });

  it('clears the cookie with Secure + SameSite=None on logout', async () => {
    const res = await app.request('/fedcm/set-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('fedcm_session=');
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).toMatch(/;\s*SameSite=None/i);
    expect(res.headers.get('set-login')).toBe('logged-out');
  });

  it('rejects an invalid session with 401 and sets no cookie', async () => {
    // Stub the API to report the session as invalid for this request.
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/session/validate/')) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const res = await app.request('/fedcm/set-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'bogus', action: 'login' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
