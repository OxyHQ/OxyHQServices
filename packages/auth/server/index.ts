/**
 * FedCM Identity Provider Server for auth.oxy.so
 *
 * This Hono app implements the FedCM endpoints required by the Federated
 * Credential Management API and serves the Vite-built SPA for every other
 * route. It runs in TWO environments from a single source:
 *
 *   - Production: bundled to `dist/_worker.js` and deployed as a Cloudflare
 *     Pages Function (advanced mode). Static assets are served by the Pages
 *     `env.ASSETS` binding; secrets come from the Worker `env` binding.
 *   - Local / tests: run on Bun/Node via `bun run server/index.ts`. Static
 *     assets and env come from the filesystem and `process.env`.
 *
 * The FedCM spec mandates that the IdP endpoints (accounts_endpoint,
 * id_assertion_endpoint, disconnect_endpoint) live on the same origin as the
 * configURL declared in .well-known/web-identity. Since auth.oxy.so is the IdP
 * origin, these endpoints MUST be served here -- not on api.oxy.so.
 *
 * Endpoints:
 *   GET  /.well-known/web-identity - FedCM manifest (application/json)
 *   GET  /fedcm/accounts          - Accounts for the logged-in user
 *   POST /fedcm/assertion         - Mints an id_token (HS256 JWT) for the RP
 *   POST /fedcm/disconnect        - Disconnects an RP
 *   GET  /fedcm/login-status      - Returns Set-Login header for the browser
 *   POST /fedcm/set-session       - Called by the SPA after login to set cookie
 *   *    /*                       - Serves the Vite SPA (static assets)
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'fedcm_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
const TOKEN_LIFETIME = 600; // 10 minutes for id_tokens

/**
 * Cloudflare Pages Worker bindings (secrets / vars) plus the static-asset
 * fetcher Pages injects in advanced mode. All optional so the same type works
 * when running under Bun/Node where these come from `process.env` instead.
 */
interface WorkerEnv {
  OXY_API_URL?: string;
  FEDCM_ISSUER?: string;
  FEDCM_TOKEN_SECRET?: string;
  NODE_ENV?: string;
  ASSETS?: { fetch: typeof fetch };
}

type AppContext = Context<{ Bindings: WorkerEnv }>;

interface ResolvedConfig {
  apiBaseUrl: string;
  fedcmIssuer: string;
  fedcmTokenSecret: string;
  isProduction: boolean;
}

/** Read a config value from the Worker `env` binding, falling back to Node `process.env`. */
function readEnv(env: WorkerEnv | undefined, key: keyof WorkerEnv): string | undefined {
  const fromBinding = env?.[key];
  if (typeof fromBinding === 'string' && fromBinding.length > 0) return fromBinding;
  // `process` is undefined on the Workers runtime — guard before touching it.
  if (typeof process !== 'undefined' && process.env) {
    const fromProcess = process.env[key as string];
    if (typeof fromProcess === 'string' && fromProcess.length > 0) return fromProcess;
  }
  return undefined;
}

/**
 * Resolve the IdP's runtime config from the request context. On Cloudflare
 * Pages secrets arrive per-request via `c.env`; under Bun/Node they come from
 * `process.env`. We resolve per-request (not at module load) because the
 * Workers runtime does not expose bindings at module-evaluation time.
 */
function resolveConfig(c: AppContext): ResolvedConfig {
  const env = c.env;
  return {
    apiBaseUrl: (readEnv(env, 'OXY_API_URL') || 'https://api.oxy.so').replace(/\/+$/, ''),
    fedcmIssuer: (readEnv(env, 'FEDCM_ISSUER') || 'https://auth.oxy.so').replace(/\/+$/, ''),
    fedcmTokenSecret: readEnv(env, 'FEDCM_TOKEN_SECRET') || '',
    isProduction: readEnv(env, 'NODE_ENV') === 'production',
  };
}

// ---------------------------------------------------------------------------
// Helpers (runtime-agnostic — Web Crypto + WHATWG APIs only)
// ---------------------------------------------------------------------------

/** Base64url-encode a string or byte array without depending on Node `Buffer`. */
function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Create an HS256 JWT signed with the FedCM token secret using Web Crypto
 * (`crypto.subtle`). Web Crypto is available on the Workers runtime, Bun, and
 * Node 18+ — unlike `node:crypto`, which is not available on Workers.
 */
async function createHS256JWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signatureInput = `${header}.${body}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signatureInput));
  const signature = base64url(new Uint8Array(signatureBuffer));

  return `${signatureInput}.${signature}`;
}

interface ResolvedUser {
  id: string;
  email?: string;
  username?: string;
  name?: string;
  avatar?: string;
}

/**
 * Resolve the FedCM session cookie to a user via the PUBLIC, cookie-less
 * `/session/validate/:id` endpoint. We deliberately do NOT use
 * `/session/user/:id`: that route is bearer-protected (it requires an
 * Authorization header and verifies the caller owns the session), and the IdP
 * server has no user access token to present — so it would always 401 and
 * FedCM would fall back to the login_url popup. `/session/validate` takes only
 * the sessionId, returns `{ valid, user }`, and is the intended
 * server-to-server session-resolution endpoint.
 */
async function fetchUserFromAPI(apiBaseUrl: string, sessionId: string): Promise<ResolvedUser | null> {
  try {
    const url = `${apiBaseUrl}/session/validate/${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const data = await res.json() as Record<string, unknown>;
    const payload = (data.data || data) as Record<string, unknown>;

    if (payload.valid !== true) return null;

    // `/session/validate` returns the user via `formatUserResponse`, whose id
    // field is `id` (the stringified Mongo `_id`) — NOT `_id`. Read `id`.
    const user = payload.user as Record<string, unknown> | undefined;
    const userId = user?.id;
    if (!user || typeof userId !== 'string' || !userId) return null;

    const nameObj = user.name as Record<string, string> | undefined;
    const fullName = nameObj?.full || (nameObj?.first && nameObj?.last ? `${nameObj.first} ${nameObj.last}` : undefined);

    return {
      id: userId,
      email: user.email as string | undefined,
      username: user.username as string | undefined,
      name: fullName || (user.username as string | undefined),
      avatar: user.avatar as string | undefined,
    };
  } catch {
    return null;
  }
}

/** Validate that a session is still active via the API. */
async function validateSession(apiBaseUrl: string, sessionId: string): Promise<boolean> {
  try {
    const url = `${apiBaseUrl}/session/validate/${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = await res.json() as Record<string, unknown>;
    const payload = (data.data || data) as Record<string, unknown>;
    return payload.valid === true;
  } catch {
    return false;
  }
}

/** Build the avatar URL for a user. */
function getAvatarUrl(apiBaseUrl: string, fileId: string): string {
  return `${apiBaseUrl}/assets/${encodeURIComponent(fileId)}/stream?variant=thumb&fallback=placeholderVisible`;
}

// ---------------------------------------------------------------------------
// FedCM request validation + CORS helpers
// ---------------------------------------------------------------------------

/**
 * The FedCM spec requires the browser to send `Sec-Fetch-Dest: webidentity`
 * on credentialed requests to the accounts, id_assertion and disconnect
 * endpoints. Enforcing it prevents these cookie-bearing endpoints from being
 * driven by ordinary `fetch()`/navigation (CSRF protection): a cross-site
 * page cannot forge this header.
 *
 * Spec: https://fedidcg.github.io/FedCM/#http-csrf-protection
 */
function hasWebIdentityDest(c: AppContext): boolean {
  return c.req.header('sec-fetch-dest') === 'webidentity';
}

/**
 * The id_assertion endpoint is fetched cross-origin by the browser on behalf
 * of the RP. Per spec the response MUST echo the RP origin in
 * `Access-Control-Allow-Origin` and set `Access-Control-Allow-Credentials:
 * true`, otherwise the browser discards the token ("Error retrieving a
 * token"). The RP origin arrives in the `Origin` header.
 */
function applyAssertionCors(c: AppContext): void {
  const origin = c.req.header('origin');
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin');
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: WorkerEnv }>();

/**
 * GET /.well-known/web-identity
 *
 * The FedCM manifest that points the browser at the IdP config (fedcm.json).
 * It MUST be served from the eTLD+1 well-known path with
 * `Content-Type: application/json`. The static asset handler would label this
 * extensionless file `application/octet-stream`, which Chrome rejects — so we
 * serve it explicitly here.
 *
 * Spec: https://fedidcg.github.io/FedCM/#idp-api-well-known
 */
app.get('/.well-known/web-identity', (c) => {
  const { fedcmIssuer } = resolveConfig(c);
  return c.json({ provider_urls: [`${fedcmIssuer}/fedcm.json`] });
});

/**
 * GET /fedcm/accounts
 *
 * Called by the browser's FedCM API. The browser sends cookies from auth.oxy.so
 * automatically. We read the fedcm_session cookie to determine who is logged in,
 * then fetch their profile from the Oxy API and return the FedCM accounts list.
 *
 * Spec: https://fedidcg.github.io/FedCM/#idp-api-accounts-endpoint
 */
app.get('/fedcm/accounts', async (c) => {
  // CSRF protection mandated by the FedCM spec.
  if (!hasWebIdentityDest(c)) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const { apiBaseUrl, isProduction } = resolveConfig(c);
  const sessionId = getCookie(c, COOKIE_NAME);

  if (!sessionId) {
    // No session cookie -- user is not logged in at this IdP.
    //
    // Per the FedCM spec the accounts endpoint MUST signal a logged-out state
    // with HTTP 401 + `WWW-Authenticate: FedCM` (mirroring the id_assertion
    // endpoint). Returning `200 {"accounts":[]}` instead is treated by Chrome
    // as a *successful but empty* accounts list — an INVALID accounts response
    // — which aborts the credential request with `NetworkError: Error
    // retrieving a token` and shows NO UI (no account chooser, no login_url).
    // The 401 instead updates the browser's IdP login status to logged-out and
    // (in active/button mode) opens `login_url` so the user can sign in.
    //
    // Spec: https://w3c-fedid.github.io/FedCM/#idp-api-accounts-endpoint
    c.header('WWW-Authenticate', 'FedCM');
    c.header('Set-Login', 'logged-out');
    return c.json({ error: 'not_logged_in' }, 401);
  }

  const user = await fetchUserFromAPI(apiBaseUrl, sessionId);
  if (!user) {
    // Session expired or invalid -- clear the stale cookie and signal
    // logged-out exactly as above (401, not an empty 200 list).
    deleteCookie(c, COOKIE_NAME, {
      path: '/',
      secure: isProduction,
      httpOnly: true,
      sameSite: 'None',
    });
    c.header('WWW-Authenticate', 'FedCM');
    c.header('Set-Login', 'logged-out');
    return c.json({ error: 'not_logged_in' }, 401);
  }

  const account: Record<string, unknown> = {
    id: user.id,
    name: user.name || user.username || 'Oxy User',
    email: user.email || `${user.username || user.id}@oxy.so`,
  };

  if (user.avatar) {
    account.picture = getAvatarUrl(apiBaseUrl, user.avatar);
  }

  // The FedCM spec allows an optional given_name field
  if (user.username) {
    account.given_name = user.username;
  }

  // approved_clients is optional; we return empty to allow all approved RPs
  // The browser validates client_id against the RP's origin separately

  return c.json({ accounts: [account] }, 200);
});

/**
 * POST /fedcm/assertion
 *
 * Called by the browser when the user selects an account. The browser sends:
 *   - account_id: The user's account ID (from /fedcm/accounts)
 *   - client_id: The RP's client ID / origin
 *   - nonce: An optional nonce from the RP
 *   - disclosure_text_shown: Whether the disclosure was shown
 *
 * We mint an HS256 JWT (id_token) signed with FEDCM_TOKEN_SECRET that the RP
 * exchanges at the Oxy API's /fedcm/exchange endpoint for a session.
 *
 * Spec: https://fedidcg.github.io/FedCM/#idp-api-id-assertion-endpoint
 */
app.post('/fedcm/assertion', async (c) => {
  // The browser issues this cross-origin POST with credentials. Echo the RP
  // origin so the browser accepts the token (required by the FedCM spec).
  applyAssertionCors(c);

  // CSRF protection mandated by the FedCM spec.
  if (!hasWebIdentityDest(c)) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const { apiBaseUrl, fedcmIssuer, fedcmTokenSecret } = resolveConfig(c);

  if (!fedcmTokenSecret) {
    console.error('[FedCM] FEDCM_TOKEN_SECRET is not configured');
    return c.json({ error: 'server_error' }, 500);
  }

  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) {
    // Per spec, a logged-out state on the assertion endpoint is signalled
    // with a 401 + WWW-Authenticate so the browser can surface the IdP
    // login_url ("Continue to sign in") instead of failing silently.
    c.header('WWW-Authenticate', 'FedCM');
    return c.json({ error: 'not_logged_in' }, 401);
  }

  // FedCM sends application/x-www-form-urlencoded
  let accountId: string | undefined;
  let clientId: string | undefined;
  let nonce: string | undefined;

  const contentType = c.req.header('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = await c.req.parseBody();
    accountId = body.account_id as string | undefined;
    clientId = body.client_id as string | undefined;
    nonce = body.nonce as string | undefined;
  } else {
    const body = await c.req.json().catch(() => ({})) as Record<string, string>;
    accountId = body.account_id;
    clientId = body.client_id;
    nonce = body.nonce;
  }

  if (!accountId || !clientId) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  // Verify the session is still valid and the account matches
  const user = await fetchUserFromAPI(apiBaseUrl, sessionId);
  if (!user || user.id !== accountId) {
    return c.json({ error: 'invalid_account' }, 403);
  }

  // Mint the id_token
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: fedcmIssuer,
    sub: accountId,
    aud: clientId,
    iat: now,
    exp: now + TOKEN_LIFETIME,
  };

  if (nonce) {
    payload.nonce = nonce;
  }

  // Include basic claims
  if (user.email) payload.email = user.email;
  if (user.name) payload.name = user.name;
  if (user.username) payload.preferred_username = user.username;

  const token = await createHS256JWT(payload, fedcmTokenSecret);

  return c.json({ token });
});

/**
 * POST /fedcm/disconnect
 *
 * Called when the RP requests disconnection via the FedCM Disconnect API.
 * We clear the session cookie for this IdP.
 *
 * Spec: https://fedidcg.github.io/FedCM/#idp-api-disconnect-endpoint
 */
app.post('/fedcm/disconnect', async (c) => {
  // Cross-origin credentialed request — echo RP origin like the assertion
  // endpoint so the browser accepts the response.
  applyAssertionCors(c);

  // CSRF protection mandated by the FedCM spec.
  if (!hasWebIdentityDest(c)) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const { apiBaseUrl, isProduction } = resolveConfig(c);

  // Read the session cookie BEFORE clearing it
  const sessionId = getCookie(c, COOKIE_NAME);

  let accountHint: string | undefined;
  const contentType = c.req.header('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = await c.req.parseBody();
    accountHint = body.account_hint as string | undefined;
  } else {
    const body = await c.req.json().catch(() => ({})) as Record<string, string>;
    accountHint = body.account_hint;
  }

  // Resolve the account id we're disconnecting BEFORE clearing the session,
  // so we can return it to the browser per spec. Fall back to the RP-supplied
  // account_hint when the session can no longer be resolved.
  let disconnectedAccountId = accountHint;
  if (sessionId) {
    const user = await fetchUserFromAPI(apiBaseUrl, sessionId);
    if (user?.id) {
      disconnectedAccountId = user.id;
    }
  }

  // Clear the session cookie
  deleteCookie(c, COOKIE_NAME, {
    path: '/',
    secure: isProduction,
    httpOnly: true,
    sameSite: 'None',
  });

  // Best-effort logout from the API
  if (sessionId) {
    try {
      await fetch(`${apiBaseUrl}/session/logout/${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Best-effort
    }
  }

  c.header('Set-Login', 'logged-out');

  // The FedCM disconnect spec requires the response body to carry the
  // disconnected `account_id`. A missing/empty value here makes Chrome treat
  // the disconnect as failed.
  if (disconnectedAccountId && disconnectedAccountId !== '*') {
    return c.json({ account_id: disconnectedAccountId });
  }
  return c.json({ account_id: '' });
});

/**
 * GET /fedcm/login-status
 *
 * Returns the Set-Login HTTP header that the browser uses to track whether
 * the user is logged in at this IdP. Loaded by the SPA in a hidden iframe
 * after successful login.
 *
 * Spec: https://fedidcg.github.io/FedCM/#login-status
 */
app.get('/fedcm/login-status', async (c) => {
  const { apiBaseUrl, isProduction } = resolveConfig(c);
  const sessionId = getCookie(c, COOKIE_NAME);

  if (sessionId) {
    // Verify the session is still valid
    const valid = await validateSession(apiBaseUrl, sessionId);
    if (valid) {
      c.header('Set-Login', 'logged-in');
      return c.html('<!DOCTYPE html><html><body>logged-in</body></html>');
    }
    // Session invalid -- clean up
    deleteCookie(c, COOKIE_NAME, {
      path: '/',
      secure: isProduction,
      httpOnly: true,
      sameSite: 'None',
    });
  }

  c.header('Set-Login', 'logged-out');
  return c.html('<!DOCTYPE html><html><body>logged-out</body></html>');
});

/**
 * POST /fedcm/set-session
 *
 * Called by the SPA after a successful login. The SPA sends the sessionId
 * from the API, and this endpoint sets a secure httpOnly cookie so that
 * subsequent FedCM browser requests (which include cookies) can identify
 * the logged-in user.
 *
 * This is NOT a FedCM spec endpoint -- it's our bridge between the SPA
 * login flow and the FedCM server-side session tracking.
 */
app.post('/fedcm/set-session', async (c) => {
  const { apiBaseUrl, isProduction } = resolveConfig(c);
  const body = await c.req.json().catch(() => ({})) as Record<string, string>;
  const sessionId = body.sessionId;
  const action = body.action; // 'login' or 'logout'

  if (action === 'logout') {
    deleteCookie(c, COOKIE_NAME, {
      path: '/',
      secure: isProduction,
      httpOnly: true,
      sameSite: 'None',
    });
    c.header('Set-Login', 'logged-out');
    return c.json({ success: true });
  }

  if (!sessionId || typeof sessionId !== 'string') {
    return c.json({ error: 'sessionId is required' }, 400);
  }

  // Validate that this session actually exists in the API
  const valid = await validateSession(apiBaseUrl, sessionId);
  if (!valid) {
    return c.json({ error: 'invalid_session' }, 401);
  }

  setCookie(c, COOKIE_NAME, sessionId, {
    path: '/',
    secure: isProduction,
    httpOnly: true,
    sameSite: 'None', // Required for FedCM cross-site cookie access
    maxAge: COOKIE_MAX_AGE,
  });

  c.header('Set-Login', 'logged-in');
  return c.json({ success: true });
});

// NOTE: there is deliberately NO catch-all `*` route on `app`. Static-asset
// fallback for the SPA is owned by each runtime entrypoint:
//   - Cloudflare Pages: `server/worker.ts` falls back to `env.ASSETS.fetch()`
//     when the Hono app returns 404 (no FedCM route matched).
//   - Local Bun/Node: `server/node.ts` adds `@hono/node-server` static handlers.
// Keeping `app` free of a catch-all (and free of any Node-only imports) lets
// the FedCM endpoint tests assert clean 404s, avoids the mounted-app
// route-precedence trap, AND keeps the Workers bundle free of `node:*` builtins.

// Export the configured Hono app so it can be exercised in tests via
// `app.request(...)` and re-used by the Cloudflare Pages worker entry
// (`server/worker.ts`) and the local Node entry (`server/node.ts`).
export { app, readEnv };
export type { WorkerEnv };
