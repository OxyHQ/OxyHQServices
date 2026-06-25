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
import { SSO_CALLBACK_PATH } from '@oxyhq/core';

const RP_ORIGIN = 'https://accounts.oxy.so';
const TEST_SECRET = 'test-fedcm-secret';
const TEST_USER_ID = '507f1f77bcf86cd799439011';

// Configure env BEFORE importing the server module (it reads env at load).
process.env.FEDCM_TOKEN_SECRET = TEST_SECRET;
process.env.FEDCM_ISSUER = 'https://auth.oxy.so';
process.env.OXY_API_URL = 'https://api.oxy.so';
process.env.SSO_INTERNAL_SECRET = 'test-sso-internal-secret-32-chars-long!!';
process.env.NODE_ENV = 'test';

// The fixed RP callback path GET /sso is allowed to redirect to. Imported from
// `@oxyhq/core` — the SINGLE SOURCE OF TRUTH shared by the worker and the client
// SDK, so this test can never drift from the value the server actually enforces.

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

// Origins the stubbed API reports as approved FedCM clients (drives both
// `GET /fedcm/clients/approved` allow-listing and `/fedcm/exchange` approval).
// Mutable so tests can assert the silent path refuses unapproved client_ids.
let stubbedApprovedClients: string[] = [RP_ORIGIN];

// Server-minted nonce + access token the stubbed `/fedcm/exchange` returns.
const STUB_SERVER_NONCE = 'server-minted-nonce-xyz';
const STUB_ACCESS_TOKEN = 'oxy-access-token-abc';
const STUB_EXCHANGE_SESSION_ID = 'sess_exchanged_999';

// Captures the outbound calls the worker makes to the API during silent
// restore so tests can assert the Origin header binding + payload shape.
interface CapturedExchange {
  origin?: string;
  idToken?: string;
}
let capturedNonceOrigin: string | undefined;
let capturedExchange: CapturedExchange | undefined;
let capturedGrantsSecret: string | undefined;

// Captures the internal `POST /sso/code` call GET /sso makes so tests can
// assert the X-Oxy-Internal secret + clientOrigin + session payload shape.
interface CapturedSsoCode {
  internalSecret?: string;
  clientOrigin?: string;
  session?: {
    sessionId?: string;
    accessToken?: string;
    user?: { id?: string; name?: { displayName?: string } | string };
  };
}
let capturedSsoCode: CapturedSsoCode | undefined;
// The opaque single-use code the stubbed `/sso/code` returns. Mutable so a test
// can simulate the mint failing (no code → error bounce).
const STUB_SSO_CODE = 'opaque-sso-code-123';
let stubbedSsoCode: string | null = STUB_SSO_CODE;

function installApiStub(): void {
  capturedNonceOrigin = undefined;
  capturedExchange = undefined;
  capturedSsoCode = undefined;
  capturedGrantsSecret = undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = new Headers(init?.headers);

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
      capturedGrantsSecret = headers.get('x-oxy-internal') ?? undefined;
      return new Response(
        JSON.stringify({ origins: stubbedGrantedOrigins }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    // Authoritative approved-clients allow-list consumed by the silent path.
    if (url.includes('/fedcm/clients/approved')) {
      return new Response(
        JSON.stringify({ success: true, clients: stubbedApprovedClients }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    // Server-bound nonce mint — capture the Origin the worker sends.
    if (url.includes('/fedcm/nonce')) {
      capturedNonceOrigin = headers.get('origin') ?? undefined;
      return new Response(
        JSON.stringify({ nonce: STUB_SERVER_NONCE, expiresAt: new Date(Date.now() + 60000).toISOString() }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    // Token exchange — capture the Origin + id_token, return an Oxy session.
    if (url.includes('/fedcm/exchange')) {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      let idToken: string | undefined;
      try {
        idToken = (JSON.parse(bodyText) as { id_token?: string }).id_token;
      } catch {
        idToken = undefined;
      }
      capturedExchange = { origin: headers.get('origin') ?? undefined, idToken };
      return new Response(
        JSON.stringify({
          sessionId: STUB_EXCHANGE_SESSION_ID,
          deviceId: 'dev_1',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          accessToken: STUB_ACCESS_TOKEN,
          // The API's /fedcm/exchange returns the canonical formatUserResponse
          // user: `name` is the STRUCTURED object with a required `displayName`,
          // NOT a plain string. The worker must carry this shape verbatim onto
          // the SESSION user it posts to /sso/code and /auth/silent.
          user: {
            id: TEST_USER_ID,
            username: 'tester',
            email: 'tester@oxy.so',
            name: { first: 'Test', last: 'User', full: 'Test User', displayName: 'Test User' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    // Internal SSO code mint — capture the X-Oxy-Internal secret + payload, and
    // return an opaque code (or simulate a failure when `stubbedSsoCode` is null).
    if (url.includes('/sso/code')) {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      let parsed: CapturedSsoCode = {};
      try {
        const json = JSON.parse(bodyText) as { clientOrigin?: string; session?: CapturedSsoCode['session'] };
        parsed = { clientOrigin: json.clientOrigin, session: json.session };
      } catch {
        parsed = {};
      }
      capturedSsoCode = { ...parsed, internalSecret: headers.get('x-oxy-internal') ?? undefined };
      if (stubbedSsoCode === null) {
        return new Response(JSON.stringify({ message: 'fail' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ code: stubbedSsoCode, expiresInSeconds: 30 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
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
  stubbedApprovedClients = [RP_ORIGIN];
  stubbedSsoCode = STUB_SSO_CODE;
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
    expect(capturedGrantsSecret).toBe(process.env.SSO_INTERNAL_SECRET);
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

  it('rejects when the request Origin does not match the requested client_id (no credentialed CORS)', async () => {
    // A malicious RP at evil.example posts asking for a token whose aud is an
    // approved Oxy client (accounts.oxy.so). The browser sends the embedder's
    // real Origin (evil.example). The assertion endpoint MUST refuse — and MUST
    // NOT emit a credentialed CORS header (which would let evil read the token).
    const res = await app.request('/fedcm/assertion', {
      method: 'POST',
      headers: {
        ...WEBIDENTITY,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://evil.example',
        cookie: SESSION_COOKIE,
      },
      body: new URLSearchParams({
        account_id: TEST_USER_ID,
        client_id: RP_ORIGIN,
        nonce: 'rp-nonce-evil',
      }).toString(),
    });

    expect(res.status).toBe(400);
    // No reflected, credentialed CORS on the rejection — nothing leaks.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    const body = (await res.json()) as { error?: string; token?: string };
    expect(body.error).toBe('invalid_client');
    expect(body.token).toBeUndefined();
  });

  it('rejects an unapproved client_id even when Origin matches it (no token minted)', async () => {
    // evil.example is the real embedder AND the requested client_id, so the
    // Origin==client_id check passes — but evil.example is NOT on the approved-
    // clients allow-list (defense-in-depth fold-in), so no token is minted.
    stubbedApprovedClients = [RP_ORIGIN];
    installApiStub();

    const res = await app.request('/fedcm/assertion', {
      method: 'POST',
      headers: {
        ...WEBIDENTITY,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://evil.example.com',
        cookie: SESSION_COOKIE,
      },
      body: new URLSearchParams({
        account_id: TEST_USER_ID,
        client_id: 'https://evil.example.com',
        nonce: 'rp-nonce-unapproved',
      }).toString(),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    const body = (await res.json()) as { error?: string; token?: string };
    expect(body.error).toBe('invalid_client');
    expect(body.token).toBeUndefined();
  });

  it('accepts a matching approved client and scopes credentialed CORS + aud to that single origin', async () => {
    // Origin == client_id == an approved client. The response exposes
    // credentialed CORS scoped to exactly that origin (never a blanket
    // reflection), and the JWT aud is bound to the normalised origin.
    const res = await app.request('/fedcm/assertion', {
      method: 'POST',
      headers: {
        ...WEBIDENTITY,
        'content-type': 'application/x-www-form-urlencoded',
        // Trailing slash proves aud/CORS use the NORMALISED origin, not raw input.
        origin: `${RP_ORIGIN}/`,
        cookie: SESSION_COOKIE,
      },
      body: new URLSearchParams({
        account_id: TEST_USER_ID,
        client_id: `${RP_ORIGIN}/`,
        nonce: 'rp-nonce-scoped',
      }).toString(),
    });

    expect(res.status).toBe(200);
    // CORS is scoped to the single validated origin, with credentials allowed.
    expect(res.headers.get('access-control-allow-origin')).toBe(RP_ORIGIN);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('vary')).toContain('Origin');

    const body = (await res.json()) as { token: string };
    const [, payloadB64] = body.token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    ) as { aud: string };
    // aud is the normalised approved origin (no trailing slash), not raw input.
    expect(payload.aud).toBe(RP_ORIGIN);
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
    // The assertion endpoint now requires client_id to be an approved client
    // AND to equal the request Origin, so approve alia.onl for this multi-domain
    // case (the default stub only approves accounts.oxy.so).
    stubbedApprovedClients = ['https://alia.onl'];
    installApiStub();
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

/**
 * Decode the `oxy_silent_auth` / `oxy-session-check` postMessage out of the
 * HTML document the silent-restore endpoints return. The inline script embeds
 * the message as a `<script>`-safe JSON literal assigned to `var message = …;`.
 */
function extractPostedMessage(html: string): { message: unknown; targetOrigin: string } {
  const messageMatch = html.match(/var message = (.+?);\n/);
  const targetMatch = html.match(/var targetOrigin = (.+?);\n/);
  if (!messageMatch || !targetMatch) {
    throw new Error('Could not extract postMessage payload from silent HTML');
  }
  // Reverse the `<`/`>`/U+2028/U+2029 escaping applied by `jsonForScript`.
  const unescape = (s: string): string =>
    s
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\u2028/g, ' ')
      .replace(/\\u2029/g, ' ');
  return {
    message: JSON.parse(unescape(messageMatch[1])),
    targetOrigin: JSON.parse(unescape(targetMatch[1])) as string,
  };
}

interface SilentMessage {
  type: string;
  session: {
    sessionId: string;
    accessToken: string;
    user?: { id: string; name?: { displayName?: string } | string };
  } | null;
  nonce: string | null;
}

describe('GET /auth/silent (Safari/Firefox first-party restore)', () => {
  it('returns HTML that posts a real session to the approved client_id origin', async () => {
    const res = await app.request(
      `/auth/silent?client_id=${encodeURIComponent(RP_ORIGIN)}&nonce=rp-nonce-1`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    const { message, targetOrigin } = extractPostedMessage(html);
    const msg = message as SilentMessage;

    // Contract with OxyServices.popup.ts waitForIframeAuth.
    expect(msg.type).toBe('oxy_silent_auth');
    expect(msg.nonce).toBe('rp-nonce-1');
    expect(msg.session?.sessionId).toBe(STUB_EXCHANGE_SESSION_ID);
    expect(msg.session?.accessToken).toBe(STUB_ACCESS_TOKEN);
    expect(msg.session?.user?.id).toBe(TEST_USER_ID);

    // CRITICAL: the session user's `name` MUST be the STRUCTURED object with a
    // non-empty `displayName` (NOT a plain string). `@oxyhq/core`'s
    // `exchangeSsoCode` (≥3.6.0) throws "SSO exchange returned an invalid user"
    // when `user.name` is a string, which silently logs every RP out on reload.
    const silentName = msg.session?.user?.name;
    expect(typeof silentName).toBe('object');
    expect((silentName as { displayName?: string }).displayName).toBe('Test User');

    // Token is delivered ONLY to the validated client origin — never '*'.
    expect(targetOrigin).toBe(RP_ORIGIN);
  });

  it('binds the server nonce + exchange to the validated client origin (Origin header)', async () => {
    await app.request(
      `/auth/silent?client_id=${encodeURIComponent(RP_ORIGIN)}&nonce=rp-nonce-2`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    // The worker must drive the api `/fedcm/nonce` + `/fedcm/exchange` calls
    // with Origin == the approved client origin, or the API rejects them
    // (origin_aud_mismatch / nonce_origin_mismatch).
    expect(capturedNonceOrigin).toBe(RP_ORIGIN);
    expect(capturedExchange?.origin).toBe(RP_ORIGIN);
    expect(typeof capturedExchange?.idToken).toBe('string');

    // The minted ID token must carry iss/aud/sub/nonce the API verifies.
    const [, payloadB64] = (capturedExchange?.idToken ?? '..').split('.');
    const payload = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as { iss: string; aud: string; sub: string; nonce: string };
    expect(payload.aud).toBe(RP_ORIGIN);
    expect(payload.sub).toBe(TEST_USER_ID);
    expect(payload.nonce).toBe(STUB_SERVER_NONCE);
  });

  it('posts a null session (no token) when there is no fedcm_session cookie', async () => {
    const res = await app.request(
      `/auth/silent?client_id=${encodeURIComponent(RP_ORIGIN)}&nonce=rp-nonce-3`
    );
    expect(res.status).toBe(200);
    const { message } = extractPostedMessage(await res.text());
    const msg = message as SilentMessage;
    expect(msg.type).toBe('oxy_silent_auth');
    expect(msg.session).toBeNull();
    // No exchange attempted.
    expect(capturedExchange).toBeUndefined();
  });

  it('REFUSES to mint a token for an unapproved client_id even with a valid cookie', async () => {
    // The cookie is present and the session is valid, but the requesting
    // client_id is NOT on the approved-clients allow-list — the primary
    // server-side control. No token may be issued or delivered.
    stubbedApprovedClients = [RP_ORIGIN]; // evil origin is NOT in this list
    installApiStub();
    const evil = 'https://evil.example.com';
    const res = await app.request(
      `/auth/silent?client_id=${encodeURIComponent(evil)}&nonce=rp-nonce-4`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(200);
    const { message, targetOrigin } = extractPostedMessage(await res.text());
    const msg = message as SilentMessage;
    expect(msg.session).toBeNull();
    // Never post to the unapproved origin; never '*'.
    expect(targetOrigin).not.toBe(evil);
    expect(targetOrigin).not.toBe('*');
    // No exchange attempted for the unapproved origin.
    expect(capturedExchange).toBeUndefined();
  });

  it('posts null and never targets * when client_id is missing entirely', async () => {
    const res = await app.request('/auth/silent', { headers: { cookie: SESSION_COOKIE } });
    expect(res.status).toBe(200);
    const { message, targetOrigin } = extractPostedMessage(await res.text());
    expect((message as SilentMessage).session).toBeNull();
    expect(targetOrigin).not.toBe('*');
    expect(capturedExchange).toBeUndefined();
  });

  it('posts a null session for an APPROVED client the user has NOT granted (first-time RP)', async () => {
    // The client_id IS on the global approved-clients allow-list, the cookie is
    // present, and the session is valid — but THIS user has never granted this
    // RP via FedCM consent. Silent restore must NOT mint a token; the RP falls
    // back to an interactive sign-in/consent flow.
    stubbedApprovedClients = [RP_ORIGIN];
    stubbedGrantedOrigins = []; // no per-user grant
    installApiStub();

    const res = await app.request(
      `/auth/silent?client_id=${encodeURIComponent(RP_ORIGIN)}&nonce=rp-no-grant`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(200);

    const { message, targetOrigin } = extractPostedMessage(await res.text());
    const msg = message as SilentMessage;
    expect(msg.type).toBe('oxy_silent_auth');
    expect(msg.session).toBeNull();
    // We still post to the validated origin so the iframe resolves (never '*').
    expect(targetOrigin).toBe(RP_ORIGIN);
    // No token exchange attempted for an un-granted RP.
    expect(capturedExchange).toBeUndefined();
  });

  it('mints a real session for an approved client the user HAS granted (returning RP)', async () => {
    stubbedApprovedClients = [RP_ORIGIN];
    stubbedGrantedOrigins = [RP_ORIGIN]; // user has consented
    installApiStub();

    const res = await app.request(
      `/auth/silent?client_id=${encodeURIComponent(RP_ORIGIN)}&nonce=rp-with-grant`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(200);

    const { message, targetOrigin } = extractPostedMessage(await res.text());
    const msg = message as SilentMessage;
    expect(msg.session?.sessionId).toBe(STUB_EXCHANGE_SESSION_ID);
    expect(msg.session?.accessToken).toBe(STUB_ACCESS_TOKEN);
    expect(targetOrigin).toBe(RP_ORIGIN);
    expect(capturedExchange?.origin).toBe(RP_ORIGIN);
  });

  it('clears a stale cookie and posts null when the session no longer validates', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/fedcm/clients/approved')) {
        return new Response(JSON.stringify({ success: true, clients: [RP_ORIGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/session/validate/')) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const res = await app.request(
      `/auth/silent?client_id=${encodeURIComponent(RP_ORIGIN)}&nonce=rp-nonce-5`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(200);
    // Stale cookie is cleared.
    expect(res.headers.get('set-cookie') || '').toContain('fedcm_session=');
    const { message } = extractPostedMessage(await res.text());
    expect((message as SilentMessage).session).toBeNull();
  });
});

describe('GET /auth/session-check (IdP liveness probe — no token)', () => {
  it('reports hasSession:true for a live session, targeting the approved origin', async () => {
    const res = await app.request(
      `/auth/session-check?client_id=${encodeURIComponent(RP_ORIGIN)}`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(200);
    const { message, targetOrigin } = extractPostedMessage(await res.text());
    expect(message).toEqual({ type: 'oxy-session-check', hasSession: true });
    expect(targetOrigin).toBe(RP_ORIGIN);
  });

  it('NEVER returns a token (only a boolean liveness bit)', async () => {
    const res = await app.request(
      `/auth/session-check?client_id=${encodeURIComponent(RP_ORIGIN)}`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    const html = await res.text();
    expect(html).not.toContain(STUB_ACCESS_TOKEN);
    expect(html).not.toContain('accessToken');
    // The liveness path must not perform a token exchange.
    expect(capturedExchange).toBeUndefined();
  });

  it('reports hasSession:false when no cookie is present', async () => {
    const res = await app.request(`/auth/session-check?client_id=${encodeURIComponent(RP_ORIGIN)}`);
    expect(res.status).toBe(200);
    const { message } = extractPostedMessage(await res.text());
    expect(message).toEqual({ type: 'oxy-session-check', hasSession: false });
  });

  it('reports hasSession:false and clears the cookie when the session is invalid', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/fedcm/clients/approved')) {
        return new Response(JSON.stringify({ success: true, clients: [RP_ORIGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/session/validate/')) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const res = await app.request(
      `/auth/session-check?client_id=${encodeURIComponent(RP_ORIGIN)}`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') || '').toContain('fedcm_session=');
    const { message } = extractPostedMessage(await res.text());
    expect(message).toEqual({ type: 'oxy-session-check', hasSession: false });
  });
});

/**
 * Parse the `Location` header of a GET /sso 303 redirect and return the fragment
 * params. The single-use `code` + `state` + `oxy_sso` outcome ride in the URL
 * FRAGMENT (never the query/path) so they are not logged or sent to a server.
 */
function parseSsoRedirect(res: Response): { location: string; frag: URLSearchParams } {
  const location = res.headers.get('location') ?? '';
  const hashIndex = location.indexOf('#');
  const fragString = hashIndex >= 0 ? location.slice(hashIndex + 1) : '';
  return { location, frag: new URLSearchParams(fragString) };
}

function ssoUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `/sso?${qs}`;
}

const VALID_RETURN_TO = `${RP_ORIGIN}${SSO_CALLBACK_PATH}`;

describe('GET /sso (central top-level-redirect cross-domain SSO)', () => {
  it('renders an HTML 400 (never a redirect) when prompt is not "none"', async () => {
    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: VALID_RETURN_TO,
        state: 'st-1',
        prompt: 'login',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/html');
    // No open redirect on the rejected request.
    expect(res.headers.get('location')).toBeNull();
  });

  it('renders an HTML 400 for an unapproved client_id', async () => {
    stubbedApprovedClients = [RP_ORIGIN];
    installApiStub();
    const evil = 'https://evil.example.com';
    const res = await app.request(
      ssoUrl({
        client_id: evil,
        return_to: `${evil}${SSO_CALLBACK_PATH}`,
        state: 'st-2',
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('location')).toBeNull();
    // No code minted for an unapproved client.
    expect(capturedSsoCode).toBeUndefined();
  });

  it('renders an HTML 400 when return_to is on a different origin than client_id', async () => {
    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: `https://evil.example.com${SSO_CALLBACK_PATH}`,
        state: 'st-3',
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('renders an HTML 400 when return_to path is not the fixed callback path', async () => {
    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: `${RP_ORIGIN}/some/other/path`,
        state: 'st-4',
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('renders an HTML 400 when return_to is an http (non-https) URL', async () => {
    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: `http://accounts.oxy.so${SSO_CALLBACK_PATH}`,
        state: 'st-4b',
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('303-redirects with fragment oxy_sso=none (no token) when there is no cookie', async () => {
    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: VALID_RETURN_TO,
        state: 'st-5',
        prompt: 'none',
      })
    );
    expect(res.status).toBe(303);
    const { location, frag } = parseSsoRedirect(res);
    // Redirect target is the validated return_to (origin + callback path).
    expect(location.startsWith(`${VALID_RETURN_TO}#`)).toBe(true);
    expect(frag.get('oxy_sso')).toBe('none');
    expect(frag.get('state')).toBe('st-5');
    expect(frag.get('code')).toBeNull();
    // No session minting/code attempted for a logged-out bounce.
    expect(capturedExchange).toBeUndefined();
    expect(capturedSsoCode).toBeUndefined();
  });

  it('303-redirects with oxy_sso=ok&code&state for a valid cookie + approved client', async () => {
    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: VALID_RETURN_TO,
        state: 'st-6',
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(303);
    const { location, frag } = parseSsoRedirect(res);
    expect(location.startsWith(`${VALID_RETURN_TO}#`)).toBe(true);
    expect(frag.get('oxy_sso')).toBe('ok');
    expect(frag.get('code')).toBe(STUB_SSO_CODE);
    expect(frag.get('state')).toBe('st-6');

    // The session minting drove the FedCM nonce + exchange bound to the origin.
    expect(capturedNonceOrigin).toBe(RP_ORIGIN);
    expect(capturedExchange?.origin).toBe(RP_ORIGIN);

    // The internal /sso/code mint carried the secret + approved origin + the
    // exchanged session (NOT a raw token in any URL).
    expect(capturedSsoCode?.internalSecret).toBe(process.env.SSO_INTERNAL_SECRET);
    expect(capturedSsoCode?.clientOrigin).toBe(RP_ORIGIN);
    expect(capturedSsoCode?.session?.sessionId).toBe(STUB_EXCHANGE_SESSION_ID);
    expect(capturedSsoCode?.session?.accessToken).toBe(STUB_ACCESS_TOKEN);
    expect(capturedSsoCode?.session?.user?.id).toBe(TEST_USER_ID);

    // CRITICAL contract: the session posted to /sso/code carries the STRUCTURED
    // name with a non-empty `displayName`. A plain-string `name` is rejected by
    // `@oxyhq/core`'s `exchangeSsoCode` (≥3.6.0) → every RP shows logged-out.
    const ssoName = capturedSsoCode?.session?.user?.name;
    expect(typeof ssoName).toBe('object');
    expect((ssoName as { displayName?: string }).displayName).toBe('Test User');

    // The opaque code never reveals the access token, and the token is never in
    // the redirect URL.
    expect(location).not.toContain(STUB_ACCESS_TOKEN);
  });

  it('303-redirects with oxy_sso=none (no code, no mint) for an approved RP the user has NOT granted', async () => {
    // The client_id is globally approved and the IdP session is valid, but THIS
    // user has never granted this RP. prompt=none silent SSO must bounce with
    // oxy_sso=none (same as logged-out) so the RP falls back to interactive
    // sign-in/consent — NEVER minting a session/code for an un-consented RP.
    stubbedApprovedClients = [RP_ORIGIN];
    stubbedGrantedOrigins = []; // no per-user grant
    installApiStub();

    const res = await app.request(
      ssoUrl({ client_id: RP_ORIGIN, return_to: VALID_RETURN_TO, state: 'st-no-grant', prompt: 'none' }),
      { headers: { cookie: SESSION_COOKIE } }
    );

    expect(res.status).toBe(303);
    const { location, frag } = parseSsoRedirect(res);
    expect(location.startsWith(`${VALID_RETURN_TO}#`)).toBe(true);
    expect(frag.get('oxy_sso')).toBe('none');
    expect(frag.get('state')).toBe('st-no-grant');
    expect(frag.get('code')).toBeNull();
    // No session minting and no code mint for an un-granted RP.
    expect(capturedExchange).toBeUndefined();
    expect(capturedSsoCode).toBeUndefined();
  });

  it('still posts a STRUCTURED name.displayName even when the API returns a string name (older-API tolerance)', async () => {
    // Defence in depth: if an unpatched API deployment still emits a plain
    // string `name` on /fedcm/exchange, the worker MUST normalise it into the
    // structured `{ displayName }` shape before posting to /sso/code. Otherwise
    // `@oxyhq/core`'s exchangeSsoCode rejects the session and the RP logs out.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const headers = new Headers(init?.headers);
      if (url.includes('/fedcm/clients/approved')) {
        return new Response(JSON.stringify({ success: true, clients: [RP_ORIGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // Per-user grant lookup — the user HAS granted this RP so silent SSO runs.
      if (url.includes('/fedcm/grants/')) {
        return new Response(JSON.stringify({ origins: [RP_ORIGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/session/validate/')) {
        return new Response(
          JSON.stringify({
            valid: true,
            user: { id: TEST_USER_ID, username: 'tester', email: 'tester@oxy.so', name: { full: 'Test User' } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('/fedcm/nonce')) {
        return new Response(JSON.stringify({ nonce: STUB_SERVER_NONCE }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/fedcm/exchange')) {
        // Legacy API: plain-string `name`.
        return new Response(
          JSON.stringify({
            sessionId: STUB_EXCHANGE_SESSION_ID,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            accessToken: STUB_ACCESS_TOKEN,
            user: { id: TEST_USER_ID, username: 'tester', name: 'Legacy String Name' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('/sso/code')) {
        const bodyText = typeof init?.body === 'string' ? init.body : '';
        try {
          const json = JSON.parse(bodyText) as { clientOrigin?: string; session?: CapturedSsoCode['session'] };
          capturedSsoCode = {
            clientOrigin: json.clientOrigin,
            session: json.session,
            internalSecret: headers.get('x-oxy-internal') ?? undefined,
          };
        } catch {
          capturedSsoCode = {};
        }
        return new Response(JSON.stringify({ code: STUB_SSO_CODE, expiresInSeconds: 30 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const res = await app.request(
      ssoUrl({ client_id: RP_ORIGIN, return_to: VALID_RETURN_TO, state: 'st-name', prompt: 'none' }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(303);
    const { frag } = parseSsoRedirect(res);
    expect(frag.get('oxy_sso')).toBe('ok');

    // The string `name` was normalised into the structured contract shape.
    const ssoName = capturedSsoCode?.session?.user?.name;
    expect(typeof ssoName).toBe('object');
    expect((ssoName as { displayName?: string }).displayName).toBe('Legacy String Name');
  });

  it('303-redirects with oxy_sso=error when the /sso/code mint fails', async () => {
    stubbedSsoCode = null; // simulate the API mint failing
    installApiStub();
    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: VALID_RETURN_TO,
        state: 'st-7',
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(303);
    const { frag } = parseSsoRedirect(res);
    expect(frag.get('oxy_sso')).toBe('error');
    expect(frag.get('state')).toBe('st-7');
    expect(frag.get('code')).toBeNull();
  });

  it('sets no-store cache headers on the bounce', async () => {
    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: VALID_RETURN_TO,
        state: 'st-8',
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('clears a stale cookie and bounces oxy_sso=none when the session no longer validates', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/fedcm/clients/approved')) {
        return new Response(JSON.stringify({ success: true, clients: [RP_ORIGIN] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/session/validate/')) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: VALID_RETURN_TO,
        state: 'st-9',
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie') || '').toContain('fedcm_session=');
    const { frag } = parseSsoRedirect(res);
    expect(frag.get('oxy_sso')).toBe('none');
    expect(frag.get('state')).toBe('st-9');
  });

  it('renders an HTML 400 when required state is missing', async () => {
    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: VALID_RETURN_TO,
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('SKIPS the per-apex establish hop for an *.oxy.so client (auth.oxy.so is already first-party)', async () => {
    // accounts.oxy.so's apex IS oxy.so → auth.oxy.so is already first-party →
    // no second hop. The handler mints the code and bounces straight to the RP
    // callback (no /sso/establish redirect).
    const res = await app.request(
      ssoUrl({
        client_id: RP_ORIGIN,
        return_to: VALID_RETURN_TO,
        state: 'skip-1',
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(303);
    const { location, frag } = parseSsoRedirect(res);
    // Goes to the RP callback, NOT to an /sso/establish hop.
    expect(location).not.toContain('/sso/establish');
    expect(location.startsWith(`${VALID_RETURN_TO}#`)).toBe(true);
    expect(frag.get('oxy_sso')).toBe('ok');
    expect(frag.get('code')).toBe(STUB_SSO_CODE);
  });
});

// ---------------------------------------------------------------------------
// Durable-session second hop: GET /sso (cross-domain) -> GET /sso/establish
//
// For a cross-registrable-domain RP (e.g. mention.earth) auth.oxy.so is THIRD-
// party. The central /sso bounce hops through the RP's own per-apex IdP host
// (auth.mention.earth, FIRST-party to the RP) so it can plant a durable host-
// only fedcm_session cookie. The session is carried over the hop in a signed,
// short-lived, audience+host-bound establish-token (?et=).
// ---------------------------------------------------------------------------

const CROSS_RP = 'https://mention.earth';
const CROSS_APEX_HOST = 'auth.mention.earth';
const CROSS_RETURN_TO = `${CROSS_RP}${SSO_CALLBACK_PATH}`;

/** Approve a cross-domain RP (origin allow-list + user grants) and re-stub. */
function approveCrossRp(): void {
  stubbedApprovedClients = [RP_ORIGIN, CROSS_RP];
  stubbedGrantedOrigins = [RP_ORIGIN, CROSS_RP];
  installApiStub();
}

/** Parse a `/sso/establish` redirect Location into URL + query params. */
function parseEstablishRedirect(res: Response): { location: string; url: URL } {
  const location = res.headers.get('location') ?? '';
  return { location, url: new URL(location) };
}

/** Decode the (unverified) payload of an establish-token for claim assertions. */
function decodeJwtPayload(token: string | undefined): Record<string, unknown> {
  const [, payloadB64] = (token ?? '..').split('.');
  const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Re-sign an establish-token payload with the test secret (HS256) so tests can
 * forge expired / tampered / wrong-purpose tokens. Mirrors `createHS256JWT`.
 */
function signEstablishToken(payload: Record<string, unknown>): string {
  const b64url = (s: string): string =>
    Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = createHmac('sha256', TEST_SECRET)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${signingInput}.${sig}`;
}

describe('GET /sso -> /sso/establish second hop (cross-domain durable session)', () => {
  it('303-redirects a cross-domain client to auth.<apex>/sso/establish with a valid et', async () => {
    approveCrossRp();
    const res = await app.request(
      ssoUrl({
        client_id: CROSS_RP,
        return_to: CROSS_RETURN_TO,
        state: 'xd-1',
        prompt: 'none',
      }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(303);
    const { url } = parseEstablishRedirect(res);
    // The hop targets the RP's OWN per-apex IdP host (first-party to the RP).
    expect(url.host).toBe(CROSS_APEX_HOST);
    expect(url.pathname).toBe('/sso/establish');
    // return_to + state are carried through the hop (in the query, not fragment).
    expect(url.searchParams.get('return_to')).toBe(CROSS_RETURN_TO);
    expect(url.searchParams.get('state')).toBe('xd-1');

    // The et is a valid, short-lived, audience+host-bound establish-token.
    const et = url.searchParams.get('et');
    expect(typeof et).toBe('string');
    const claims = decodeJwtPayload(et as string);
    expect(claims.purpose).toBe('sso-establish');
    expect(claims.aud).toBe(CROSS_RP);
    expect(claims.host).toBe(CROSS_APEX_HOST);
    expect(typeof claims.sub).toBe('string');
    // <= 60s TTL.
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(60);

    // No code minted on the central host — that happens on the per-apex hop.
    expect(capturedSsoCode).toBeUndefined();
    // The session/access token never travels in the hop URL — only the et.
    expect(url.toString()).not.toContain(STUB_ACCESS_TOKEN);
  });

  it('does NOT create a cross-apex establish token for an approved RP the user has not granted', async () => {
    // The cross-domain RP is globally approved but THIS user has never granted
    // it. The central /sso gate runs BEFORE the establish hop, so no establish
    // token is minted and the RP gets oxy_sso=none (interactive fallback).
    stubbedApprovedClients = [RP_ORIGIN, CROSS_RP];
    stubbedGrantedOrigins = [RP_ORIGIN]; // CROSS_RP not granted
    installApiStub();

    const res = await app.request(
      ssoUrl({ client_id: CROSS_RP, return_to: CROSS_RETURN_TO, state: 'xd-no-grant', prompt: 'none' }),
      { headers: { cookie: SESSION_COOKIE } }
    );

    expect(res.status).toBe(303);
    const { location, frag } = parseSsoRedirect(res);
    // Bounced straight back to the RP callback — NOT to /sso/establish.
    expect(location.startsWith(`${CROSS_RETURN_TO}#`)).toBe(true);
    expect(location).not.toContain('/sso/establish');
    expect(frag.get('oxy_sso')).toBe('none');
    expect(frag.get('state')).toBe('xd-no-grant');
    expect(frag.get('code')).toBeNull();
    expect(capturedSsoCode).toBeUndefined();
  });

  it('re-checks the per-user grant on /sso/establish and plants no cookie when revoked between hops', async () => {
    // Obtain a real et from the central /sso bounce while the user still has the
    // grant, then revoke the grant before following the per-apex establish hop.
    approveCrossRp();
    const hop = await app.request(
      ssoUrl({ client_id: CROSS_RP, return_to: CROSS_RETURN_TO, state: 'xd-revoked', prompt: 'none' }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    const et = parseEstablishRedirect(hop).url.searchParams.get('et') as string;

    // Grant revoked between the two hops — the establish re-check must catch it.
    stubbedApprovedClients = [RP_ORIGIN, CROSS_RP];
    stubbedGrantedOrigins = [RP_ORIGIN]; // CROSS_RP grant gone
    installApiStub();

    const res = await app.request(
      `https://${CROSS_APEX_HOST}/sso/establish?et=${encodeURIComponent(et)}&return_to=${encodeURIComponent(
        CROSS_RETURN_TO
      )}&state=xd-revoked`
    );
    expect(res.status).toBe(303);
    // NO durable cookie planted for an un-granted RP, and no code minted.
    expect(res.headers.get('set-cookie')).toBeNull();
    const { frag } = parseSsoRedirect(res);
    expect(frag.get('oxy_sso')).toBe('none');
    expect(frag.get('state')).toBe('xd-revoked');
    expect(frag.get('code')).toBeNull();
    expect(capturedSsoCode).toBeUndefined();
  });

  it('GET /sso/establish with a valid et sets the host-only fedcm_session cookie and returns oxy_sso=ok&code', async () => {
    approveCrossRp();
    // First obtain a real et from the central /sso bounce.
    const hop = await app.request(
      ssoUrl({ client_id: CROSS_RP, return_to: CROSS_RETURN_TO, state: 'xd-2', prompt: 'none' }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    const et = parseEstablishRedirect(hop).url.searchParams.get('et') as string;

    // Now follow the hop ON the per-apex host (first-party to the RP).
    const res = await app.request(
      `https://${CROSS_APEX_HOST}/sso/establish?et=${encodeURIComponent(et)}&return_to=${encodeURIComponent(
        CROSS_RETURN_TO
      )}&state=xd-2`
    );
    expect(res.status).toBe(303);

    // PROOF: a durable, host-only, first-party fedcm_session cookie is planted
    // for auth.mention.earth. Host-only => NO Domain attribute; the value is the
    // validated central sessionId.
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('fedcm_session=sess_abc');
    expect(setCookie.toLowerCase()).not.toContain('domain=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('secure');
    expect(setCookie.toLowerCase()).toContain('samesite=none');

    // The SSO handoff completes: oxy_sso=ok + opaque code + state in the fragment.
    const { location, frag } = parseSsoRedirect(res);
    expect(location.startsWith(`${CROSS_RETURN_TO}#`)).toBe(true);
    expect(frag.get('oxy_sso')).toBe('ok');
    expect(frag.get('code')).toBe(STUB_SSO_CODE);
    expect(frag.get('state')).toBe('xd-2');

    // The internal code mint is bound to the cross-domain origin + session.
    expect(capturedSsoCode?.clientOrigin).toBe(CROSS_RP);
    expect(capturedSsoCode?.session?.sessionId).toBe(STUB_EXCHANGE_SESSION_ID);
    // No access token leaks into the redirect URL.
    expect(location).not.toContain(STUB_ACCESS_TOKEN);

    // The mint hop ran on auth.mention.earth, but the assertion it sent to the
    // API's /fedcm/exchange MUST carry the CENTRAL issuer (https://auth.oxy.so),
    // because the API validates every assertion issuer against the central host
    // only — a per-apex issuer is rejected with `Invalid issuer`. The aud stays
    // the RP origin.
    const establishPayload = decodeJwtPayload(capturedExchange?.idToken);
    expect(establishPayload.iss).toBe('https://auth.oxy.so');
    expect(establishPayload.aud).toBe(CROSS_RP);
  });

  it('mints with the CENTRAL issuer even when the per-apex host derives its own issuer (prod regression)', async () => {
    // Reproduces production: FEDCM_ISSUER is NOT set on the oxy-auth Pages
    // project (setting it would break multi-domain FAPI), so resolveConfig()
    // derives fedcmIssuer from the request host. On the /sso/establish hop that
    // host is auth.mention.earth — but the assertion the worker sends to the
    // API's /fedcm/exchange MUST still carry the CENTRAL issuer, or the API
    // rejects it with `Invalid issuer expected https://auth.oxy.so got
    // https://auth.mention.earth` and the hop returns #oxy_sso=error.
    const originalIssuer = process.env.FEDCM_ISSUER;
    delete process.env.FEDCM_ISSUER;
    installApiStub();
    try {
      approveCrossRp();
      const hop = await app.request(
        ssoUrl({ client_id: CROSS_RP, return_to: CROSS_RETURN_TO, state: 'xd-iss', prompt: 'none' }),
        { headers: { cookie: SESSION_COOKIE } }
      );
      const et = parseEstablishRedirect(hop).url.searchParams.get('et') as string;

      const res = await app.request(
        `https://${CROSS_APEX_HOST}/sso/establish?et=${encodeURIComponent(et)}&return_to=${encodeURIComponent(
          CROSS_RETURN_TO
        )}&state=xd-iss`
      );
      expect(res.status).toBe(303);

      // The handoff succeeds (ok + code), NOT #oxy_sso=error.
      const { frag } = parseSsoRedirect(res);
      expect(frag.get('oxy_sso')).toBe('ok');

      // Decisive proof: the assertion issuer is the central host, not the
      // per-apex host the request derived.
      const payload = decodeJwtPayload(capturedExchange?.idToken);
      expect(payload.iss).toBe('https://auth.oxy.so');
      expect(payload.iss).not.toBe(`https://${CROSS_APEX_HOST}`);
      expect(payload.aud).toBe(CROSS_RP);

      // The durable cookie is still planted host-only on the per-apex host —
      // independent of the (central) assertion issuer.
      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie).toContain('fedcm_session=sess_abc');
      expect(setCookie.toLowerCase()).not.toContain('domain=');
    } finally {
      if (originalIssuer !== undefined) {
        process.env.FEDCM_ISSUER = originalIssuer;
      }
      installApiStub();
    }
  });

  it('GET /auth/silent on the per-apex host mints with the CENTRAL issuer when FEDCM_ISSUER is unset (prod regression)', async () => {
    // Reproduces production for the DURABLE reload-restore path: /auth/silent is
    // the first-party iframe Safari/Firefox/every reload uses. It runs on
    // auth.<rp-apex> (auth.mention.earth) where resolveConfig() derives
    // fedcmIssuer from the request host because FEDCM_ISSUER is NOT set on the
    // oxy-auth Pages project. The assertion the worker sends to the API's
    // /fedcm/exchange MUST still carry the CENTRAL issuer (https://auth.oxy.so),
    // or the API rejects it with `Invalid issuer expected https://auth.oxy.so got
    // https://auth.mention.earth`, mintSessionForClient returns null, and the
    // iframe posts a NULL session — silently breaking cross-domain persistence.
    //
    // WITHOUT the fix (forcing CENTRAL_FEDCM_ISSUER inside mintSessionForClient)
    // this test FAILS: the minted assertion's iss is https://auth.mention.earth.
    const originalIssuer = process.env.FEDCM_ISSUER;
    delete process.env.FEDCM_ISSUER;
    approveCrossRp();
    try {
      const res = await app.request(
        `https://${CROSS_APEX_HOST}/auth/silent?client_id=${encodeURIComponent(
          CROSS_RP
        )}&nonce=rp-silent-xd`,
        { headers: { cookie: SESSION_COOKIE } }
      );
      expect(res.status).toBe(200);

      // The iframe posts a REAL session to the approved cross-domain RP origin.
      const { message, targetOrigin } = extractPostedMessage(await res.text());
      const msg = message as SilentMessage;
      expect(msg.type).toBe('oxy_silent_auth');
      expect(msg.session?.sessionId).toBe(STUB_EXCHANGE_SESSION_ID);
      expect(msg.session?.accessToken).toBe(STUB_ACCESS_TOKEN);
      expect(targetOrigin).toBe(CROSS_RP);

      // Decisive proof: the assertion sent to /fedcm/exchange carries the CENTRAL
      // issuer, NOT the per-apex host the request derived. aud stays the RP.
      const payload = decodeJwtPayload(capturedExchange?.idToken);
      expect(payload.iss).toBe('https://auth.oxy.so');
      expect(payload.iss).not.toBe(`https://${CROSS_APEX_HOST}`);
      expect(payload.aud).toBe(CROSS_RP);
    } finally {
      if (originalIssuer !== undefined) {
        process.env.FEDCM_ISSUER = originalIssuer;
      }
      installApiStub();
    }
  });

  it('rejects an et with a tampered audience (re-validated against the live allow-list)', async () => {
    approveCrossRp();
    // Forge an et whose aud is an UNAPPROVED origin but host matches the request.
    const now = Math.floor(Date.now() / 1000);
    const forged = signEstablishToken({
      sub: 'sess_abc',
      aud: 'https://evil.example.com',
      host: CROSS_APEX_HOST,
      purpose: 'sso-establish',
      iat: now,
      exp: now + 60,
    });
    const res = await app.request(
      `https://${CROSS_APEX_HOST}/sso/establish?et=${encodeURIComponent(forged)}&return_to=${encodeURIComponent(
        CROSS_RETURN_TO
      )}&state=xd-3`
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    // No cookie planted for an unapproved audience.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects an expired et (HTML 400, no cookie)', async () => {
    approveCrossRp();
    const past = Math.floor(Date.now() / 1000) - 120;
    const expired = signEstablishToken({
      sub: 'sess_abc',
      aud: CROSS_RP,
      host: CROSS_APEX_HOST,
      purpose: 'sso-establish',
      iat: past,
      exp: past + 60, // expired 60s ago
    });
    const res = await app.request(
      `https://${CROSS_APEX_HOST}/sso/establish?et=${encodeURIComponent(expired)}&return_to=${encodeURIComponent(
        CROSS_RETURN_TO
      )}&state=xd-4`
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects an et whose signature was tampered (HTML 400, no cookie)', async () => {
    approveCrossRp();
    const hop = await app.request(
      ssoUrl({ client_id: CROSS_RP, return_to: CROSS_RETURN_TO, state: 'xd-5', prompt: 'none' }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    const et = parseEstablishRedirect(hop).url.searchParams.get('et') as string;
    // Flip the last char of the signature → signature verification must fail.
    const tampered = et.slice(0, -1) + (et.endsWith('A') ? 'B' : 'A');
    const res = await app.request(
      `https://${CROSS_APEX_HOST}/sso/establish?et=${encodeURIComponent(tampered)}&return_to=${encodeURIComponent(
        CROSS_RETURN_TO
      )}&state=xd-5`
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects an et whose pinned host does not match the request host (replay across apexes)', async () => {
    approveCrossRp();
    // Token minted for auth.mention.earth, replayed against auth.homiio.com.
    const now = Math.floor(Date.now() / 1000);
    const forHomiio = signEstablishToken({
      sub: 'sess_abc',
      aud: CROSS_RP,
      host: CROSS_APEX_HOST, // pinned to mention's apex host
      purpose: 'sso-establish',
      iat: now,
      exp: now + 60,
    });
    const res = await app.request(
      `https://auth.homiio.com/sso/establish?et=${encodeURIComponent(forHomiio)}&return_to=${encodeURIComponent(
        CROSS_RETURN_TO
      )}&state=xd-6`
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects an et with the wrong purpose claim (e.g. a FedCM id_token replayed)', async () => {
    approveCrossRp();
    const now = Math.floor(Date.now() / 1000);
    const wrongPurpose = signEstablishToken({
      sub: 'sess_abc',
      aud: CROSS_RP,
      host: CROSS_APEX_HOST,
      purpose: 'id_token', // NOT 'sso-establish'
      iat: now,
      exp: now + 60,
    });
    const res = await app.request(
      `https://${CROSS_APEX_HOST}/sso/establish?et=${encodeURIComponent(wrongPurpose)}&return_to=${encodeURIComponent(
        CROSS_RETURN_TO
      )}&state=xd-7`
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('does not plant a cookie when the session no longer validates (oxy_sso=error)', async () => {
    approveCrossRp();
    const hop = await app.request(
      ssoUrl({ client_id: CROSS_RP, return_to: CROSS_RETURN_TO, state: 'xd-8', prompt: 'none' }),
      { headers: { cookie: SESSION_COOKIE } }
    );
    const et = parseEstablishRedirect(hop).url.searchParams.get('et') as string;

    // Now make the session validation fail on the establish hop.
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/fedcm/clients/approved')) {
        return new Response(JSON.stringify({ success: true, clients: [RP_ORIGIN, CROSS_RP] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/session/validate/')) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const res = await app.request(
      `https://${CROSS_APEX_HOST}/sso/establish?et=${encodeURIComponent(et)}&return_to=${encodeURIComponent(
        CROSS_RETURN_TO
      )}&state=xd-8`
    );
    expect(res.status).toBe(303);
    // NO cookie planted on an invalid session.
    expect(res.headers.get('set-cookie')).toBeNull();
    const { frag } = parseSsoRedirect(res);
    expect(frag.get('oxy_sso')).toBe('error');
    expect(frag.get('state')).toBe('xd-8');
  });

  it('renders an HTML 400 when et is missing', async () => {
    approveCrossRp();
    const res = await app.request(
      `https://${CROSS_APEX_HOST}/sso/establish?return_to=${encodeURIComponent(CROSS_RETURN_TO)}&state=xd-9`
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('POST /fedcm/set-session cross-site hardening (M2)', () => {
  it('rejects a cross-site attempt to plant the cookie (Sec-Fetch-Site: cross-site)', async () => {
    const res = await app.request('/fedcm/set-session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ sessionId: 'attacker-session', action: 'login' }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a same-site (but cross-origin subdomain) attempt', async () => {
    const res = await app.request('/fedcm/set-session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-site',
        origin: 'https://evil.oxy.so',
      },
      body: JSON.stringify({ sessionId: 'attacker-session', action: 'login' }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('allows the same-origin SPA to plant the cookie (Sec-Fetch-Site: same-origin)', async () => {
    const res = await app.request('http://localhost/fedcm/set-session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ sessionId: 'sess_abc', action: 'login' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') || '').toContain('fedcm_session=');
  });

  it('still allows a server-to-server caller that sends neither header', async () => {
    const res = await app.request('/fedcm/set-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess_abc', action: 'login' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') || '').toContain('fedcm_session=');
  });
});
