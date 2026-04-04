/**
 * FedCM Identity Provider Server for auth.oxy.so
 *
 * This lightweight server sits in front of the Vite-built SPA and implements
 * the FedCM endpoints required by the Federated Credential Management API.
 *
 * The FedCM spec mandates that the IdP endpoints (accounts_endpoint,
 * id_assertion_endpoint, disconnect_endpoint) live on the same origin as
 * the configURL declared in .well-known/web-identity. Since auth.oxy.so is
 * the IdP origin, these endpoints must be served here -- not on api.oxy.so.
 *
 * Endpoints:
 *   GET  /fedcm/accounts      - Returns accounts for the logged-in user
 *   POST /fedcm/assertion      - Mints an id_token (HS256 JWT) for the RP
 *   POST /fedcm/disconnect     - Disconnects an RP
 *   GET  /fedcm/login-status   - Returns Set-Login header for the browser
 *   POST /fedcm/set-session    - Called by the SPA after login to set cookie
 *   *    /*                    - Serves the Vite SPA (static files + fallback)
 */

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3002', 10);
const API_BASE_URL = (process.env.OXY_API_URL || 'https://api.oxy.so').replace(/\/+$/, '');
const FEDCM_ISSUER = (process.env.FEDCM_ISSUER || 'https://auth.oxy.so').replace(/\/+$/, '');
const FEDCM_TOKEN_SECRET = process.env.FEDCM_TOKEN_SECRET || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_NAME = 'fedcm_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
const TOKEN_LIFETIME = 600; // 10 minutes for id_tokens

// The dist directory where Vite outputs the built SPA
const DIST_DIR = join(import.meta.dirname, '..', 'dist');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Base64url-encode a Buffer or string. */
function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Create an HS256 JWT. */
function createHS256JWT(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signatureInput = `${header}.${body}`;
  const signature = base64url(
    createHmac('sha256', FEDCM_TOKEN_SECRET).update(signatureInput).digest()
  );
  return `${signatureInput}.${signature}`;
}

/** Fetch user data from the Oxy API using a session ID. */
async function fetchUserFromAPI(sessionId: string): Promise<{
  id: string;
  email?: string;
  username?: string;
  name?: string;
  avatar?: string;
} | null> {
  try {
    const url = `${API_BASE_URL}/session/user/${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const data = await res.json() as Record<string, unknown>;
    // The API wraps in { data: ... } or returns directly
    const user = (data.data || data) as Record<string, unknown>;

    if (!user || !user._id) return null;

    const nameObj = user.name as Record<string, string> | undefined;
    const fullName = nameObj?.full || (nameObj?.first && nameObj?.last ? `${nameObj.first} ${nameObj.last}` : undefined);

    return {
      id: String(user._id),
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
async function validateSession(sessionId: string): Promise<boolean> {
  try {
    const url = `${API_BASE_URL}/session/validate/${encodeURIComponent(sessionId)}`;
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
function getAvatarUrl(fileId: string): string {
  return `${API_BASE_URL}/assets/${encodeURIComponent(fileId)}/stream?variant=thumb&fallback=placeholderVisible`;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();

// ---------------------------------------------------------------------------
// FedCM Endpoints
// ---------------------------------------------------------------------------

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
  const sessionId = getCookie(c, COOKIE_NAME);

  if (!sessionId) {
    // No session cookie -- user is not logged in at this IdP
    return c.json({ accounts: [] }, 200);
  }

  const user = await fetchUserFromAPI(sessionId);
  if (!user) {
    // Session expired or invalid
    deleteCookie(c, COOKIE_NAME, {
      path: '/',
      secure: IS_PRODUCTION,
      httpOnly: true,
      sameSite: 'None',
    });
    return c.json({ accounts: [] }, 200);
  }

  const account: Record<string, unknown> = {
    id: user.id,
    name: user.name || user.username || 'Oxy User',
    email: user.email || `${user.username || user.id}@oxy.so`,
  };

  if (user.avatar) {
    account.picture = getAvatarUrl(user.avatar);
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
  if (!FEDCM_TOKEN_SECRET) {
    console.error('[FedCM] FEDCM_TOKEN_SECRET is not configured');
    return c.json({ error: 'server_error' }, 500);
  }

  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) {
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
  const user = await fetchUserFromAPI(sessionId);
  if (!user || user.id !== accountId) {
    return c.json({ error: 'invalid_account' }, 403);
  }

  // Mint the id_token
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: FEDCM_ISSUER,
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

  const token = createHS256JWT(payload);

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

  // Clear the session cookie
  deleteCookie(c, COOKIE_NAME, {
    path: '/',
    secure: IS_PRODUCTION,
    httpOnly: true,
    sameSite: 'None',
  });

  // Best-effort logout from the API
  if (sessionId) {
    try {
      await fetch(`${API_BASE_URL}/session/logout/${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Best-effort
    }
  }

  return c.json({ success: true });
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
  const sessionId = getCookie(c, COOKIE_NAME);

  if (sessionId) {
    // Verify the session is still valid
    const valid = await validateSession(sessionId);
    if (valid) {
      c.header('Set-Login', 'logged-in');
      return c.html('<!DOCTYPE html><html><body>logged-in</body></html>');
    }
    // Session invalid -- clean up
    deleteCookie(c, COOKIE_NAME, {
      path: '/',
      secure: IS_PRODUCTION,
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
  const body = await c.req.json().catch(() => ({})) as Record<string, string>;
  const sessionId = body.sessionId;
  const action = body.action; // 'login' or 'logout'

  if (action === 'logout') {
    deleteCookie(c, COOKIE_NAME, {
      path: '/',
      secure: IS_PRODUCTION,
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
  const valid = await validateSession(sessionId);
  if (!valid) {
    return c.json({ error: 'invalid_session' }, 401);
  }

  setCookie(c, COOKIE_NAME, sessionId, {
    path: '/',
    secure: IS_PRODUCTION,
    httpOnly: true,
    sameSite: 'None', // Required for FedCM cross-site cookie access
    maxAge: COOKIE_MAX_AGE,
  });

  c.header('Set-Login', 'logged-in');
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Static File Serving (Vite SPA)
// ---------------------------------------------------------------------------

// Serve static assets from the dist directory
app.use('/*', serveStatic({ root: './dist' }));

// SPA fallback: serve index.html for any route not matched by static files
app.get('*', async (c) => {
  try {
    const indexPath = join(DIST_DIR, 'index.html');
    const html = await readFile(indexPath, 'utf-8');
    return c.html(html);
  } catch {
    return c.text('Not found', 404);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (!FEDCM_TOKEN_SECRET && IS_PRODUCTION) {
  console.error('[FedCM Server] FATAL: FEDCM_TOKEN_SECRET environment variable is required in production');
  process.exit(1);
}

if (!FEDCM_TOKEN_SECRET) {
  console.warn('[FedCM Server] WARNING: FEDCM_TOKEN_SECRET is not set. The /fedcm/assertion endpoint will not work.');
}

console.log(`[FedCM Server] Starting on port ${PORT}`);
console.log(`[FedCM Server] API: ${API_BASE_URL}`);
console.log(`[FedCM Server] Issuer: ${FEDCM_ISSUER}`);
console.log(`[FedCM Server] SPA dist: ${DIST_DIR}`);

serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log(`[FedCM Server] Listening on http://localhost:${info.port}`);
});
