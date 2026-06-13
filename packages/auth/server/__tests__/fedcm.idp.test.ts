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

// Origins the stubbed API reports as previously granted by the test user.
// Mutable so individual tests can assert empty vs populated `approved_clients`.
let stubbedGrantedOrigins: string[] = [RP_ORIGIN];

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
    // The accounts endpoint resolves the user's granted RP origins to populate
    // the FedCM `approved_clients` array.
    if (url.includes('/fedcm/grants/')) {
      return new Response(
        JSON.stringify({ origins: stubbedGrantedOrigins }),
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
  stubbedGrantedOrigins = [RP_ORIGIN];
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

  it('declares login_hints (id + email + username) so an RP loginHint matches the account', async () => {
    // Without `login_hints` Chrome filters out EVERY account when the RP passes
    // any non-empty loginHint ("none matched the login hint"), greying the
    // account in the chooser. The IdP must therefore advertise every identifier
    // an RP could hint by: the account id, the email, AND the username.
    const res = await app.request('/fedcm/accounts', {
      headers: { ...WEBIDENTITY, cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: Array<{ login_hints?: string[] }> };
    const loginHints = body.accounts[0].login_hints;
    expect(Array.isArray(loginHints)).toBe(true);
    expect(loginHints).toContain(TEST_USER_ID);
    expect(loginHints).toContain('tester@oxy.so');
    expect(loginHints).toContain('tester');
    // No duplicate entries.
    expect(new Set(loginHints).size).toBe(loginHints?.length);
  });

  it('populates approved_clients from the user grants so returning RPs skip disclosure', async () => {
    // The user has previously granted accounts.oxy.so → it must appear in
    // `approved_clients`, which is what lets Chrome resolve silent mediation
    // for that RP (cross-app SSO for returning users).
    stubbedGrantedOrigins = [RP_ORIGIN, 'https://homiio.com'];
    installApiStub();

    const res = await app.request('/fedcm/accounts', {
      headers: { ...WEBIDENTITY, cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: Array<{ approved_clients?: string[] }> };
    expect(body.accounts[0].approved_clients).toEqual([RP_ORIGIN, 'https://homiio.com']);
  });

  it('omits approved_clients for a brand-new user with no grants (first-visit needs the chooser)', async () => {
    stubbedGrantedOrigins = [];
    installApiStub();

    const res = await app.request('/fedcm/accounts', {
      headers: { ...WEBIDENTITY, cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: Array<{ approved_clients?: string[] }> };
    // No `approved_clients` key at all (not an empty array) — Chrome treats the
    // account as first-time, which is the correct/expected first-visit UX.
    expect(body.accounts[0].approved_clients).toBeUndefined();
  });

  it('still returns the account when the grants lookup fails (best-effort)', async () => {
    // If the grants endpoint errors, the account must still be returned (just
    // without the returning-account optimization) — never a hard failure.
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
      if (url.includes('/fedcm/grants/')) {
        return new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const res = await app.request('/fedcm/accounts', {
      headers: { ...WEBIDENTITY, cookie: SESSION_COOKIE },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: Array<{ id: string; approved_clients?: string[] }> };
    expect(body.accounts[0].id).toBe(TEST_USER_ID);
    expect(body.accounts[0].approved_clients).toBeUndefined();
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

describe('OPTIONS preflight for cross-origin endpoints', () => {
  it('responds 204 with full CORS headers on /fedcm/assertion', async () => {
    const res = await app.request('/fedcm/assertion', {
      method: 'OPTIONS',
      headers: {
        origin: RP_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(RP_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(res.headers.get('access-control-max-age')).toBe('600');
  });

  it('responds 204 with full CORS headers on /fedcm/disconnect', async () => {
    const res = await app.request('/fedcm/disconnect', {
      method: 'OPTIONS',
      headers: {
        origin: RP_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, sec-fetch-dest',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(RP_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type, sec-fetch-dest');
  });

  it('falls back to default headers when no Access-Control-Request-Headers sent', async () => {
    const res = await app.request('/fedcm/disconnect', {
      method: 'OPTIONS',
      headers: { origin: RP_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type, sec-fetch-dest');
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

describe('Multi-domain FAPI (Clerk-style CNAME)', () => {
  // When a relying party CNAMEs `auth.<rp-domain>` to this worker, the IdP
  // must respond as if it lives on the RP's own apex. This keeps every FedCM
  // endpoint, the session cookie, and the icon URLs same-site with the RP —
  // the only way to get a first-party cookie in Safari ITP / Firefox Total
  // Cookie Protection without third-party cookie access.
  const originalIssuer = process.env.FEDCM_ISSUER;

  beforeAll(() => {
    // Unset the explicit FEDCM_ISSUER override so the worker derives the
    // issuer from the request URL — the production behaviour we want to
    // verify. Tests that need the override re-set it locally.
    delete process.env.FEDCM_ISSUER;
  });

  afterAll(() => {
    if (originalIssuer !== undefined) {
      process.env.FEDCM_ISSUER = originalIssuer;
    }
  });

  it('serves /.well-known/web-identity with provider_urls pointing at the request host', async () => {
    const res = await app.request('https://auth.mention.earth/.well-known/web-identity');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider_urls: string[] };
    expect(body.provider_urls).toEqual(['https://auth.mention.earth/fedcm.json']);
  });

  it('serves /fedcm.json dynamically with icons rooted at the request host', async () => {
    const res = await app.request('https://auth.homiio.com/fedcm.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as {
      accounts_endpoint: string;
      id_assertion_endpoint: string;
      disconnect_endpoint: string;
      login_url: string;
      branding: { icons: Array<{ url: string; size: number }> };
    };
    // Endpoint paths stay relative — the browser resolves them against the
    // issuer it loaded the manifest from.
    expect(body.accounts_endpoint).toBe('/fedcm/accounts');
    expect(body.id_assertion_endpoint).toBe('/fedcm/assertion');
    expect(body.disconnect_endpoint).toBe('/fedcm/disconnect');
    expect(body.login_url).toBe('/login');
    // Icons MUST be absolute and on the same host the manifest was served
    // from. Otherwise the browser fetches them third-party from auth.oxy.so
    // and ITP/Total-Cookie-Protection treat them as cross-site.
    for (const icon of body.branding.icons) {
      expect(icon.url.startsWith('https://auth.homiio.com/icons/')).toBe(true);
    }
  });

  it('mints an id_token whose iss matches the request host (per FedCM spec)', async () => {
    const nonce = 'nonce-multi-domain';
    const res = await app.request('https://auth.alia.onl/fedcm/assertion', {
      method: 'POST',
      headers: {
        ...WEBIDENTITY,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://alia.onl',
        cookie: SESSION_COOKIE,
      },
      body: new URLSearchParams({
        account_id: TEST_USER_ID,
        client_id: 'https://alia.onl',
        nonce,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    // Decode the JWT payload (HS256 — header.payload.signature, base64url).
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as { iss: string; aud: string; sub: string; nonce: string };
    // The issuer the RP sees in the id_token MUST match the host that
    // served the FedCM config — otherwise OIDC verification at the RP
    // rejects the token as cross-issuer.
    expect(payload.iss).toBe('https://auth.alia.onl');
    expect(payload.aud).toBe('https://alia.onl');
    expect(payload.sub).toBe(TEST_USER_ID);
    expect(payload.nonce).toBe(nonce);
  });

  it('honours FEDCM_ISSUER env override even when the request host differs (local dev / tests)', async () => {
    process.env.FEDCM_ISSUER = 'https://auth.example-override.test';
    try {
      const res = await app.request('https://auth.mention.earth/.well-known/web-identity');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { provider_urls: string[] };
      expect(body.provider_urls).toEqual(['https://auth.example-override.test/fedcm.json']);
    } finally {
      delete process.env.FEDCM_ISSUER;
    }
  });
});
