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
 *   GET  /auth/silent             - First-party silent restore for Safari/Firefox
 *   GET  /auth/session-check      - IdP-session liveness probe (no token)
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
 * Shared attributes for the `fedcm_session` cookie (set AND delete).
 *
 * `sameSite: 'None'` is REQUIRED — FedCM reads this cookie in a cross-site
 * context (the RP origin drives the browser's credentialed fetch to the IdP).
 * A `SameSite=None` cookie that is NOT also `Secure` is silently rejected by
 * Chrome (hard rule since Chrome 80), so `secure` MUST be `true` here —
 * unconditionally, NOT gated on a runtime `NODE_ENV` check. On Cloudflare
 * Pages `NODE_ENV` is unset, so a `secure: isProduction` gate evaluated to
 * `false` and Chrome dropped the cookie → the follow-up /fedcm/accounts had no
 * cookie → 401 → login-popup loop. Modern browsers treat `http://localhost` as
 * a secure context, so `secure: true` does not break local development.
 */
const FEDCM_COOKIE_OPTIONS = {
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'None',
} as const;

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
 *
 * `fedcmIssuer` is derived from the incoming request origin, NOT pinned to a
 * single hostname. Clerk-style multi-domain: any RP can CNAME their own
 * `auth.<rp-domain>` to this worker, and the IdP responds with an issuer
 * that matches the RP's own apex. The browser treats every endpoint as
 * same-site with the RP, so the `fedcm_session` cookie is first-party in
 * Safari and Firefox just like it is on Chromium-with-FedCM. The
 * `FEDCM_ISSUER` env var is still honoured as an explicit override for
 * local dev and tests, where the request URL is `http://localhost:<port>`
 * but the issuer must match a stable test hostname.
 */
function resolveConfig(c: AppContext): ResolvedConfig {
  const env = c.env;
  const issuerOverride = readEnv(env, 'FEDCM_ISSUER');
  let fedcmIssuer: string;
  if (issuerOverride) {
    fedcmIssuer = issuerOverride.replace(/\/+$/, '');
  } else {
    const url = new URL(c.req.url);
    fedcmIssuer = `${url.protocol}//${url.host}`;
  }
  return {
    apiBaseUrl: (readEnv(env, 'OXY_API_URL') || 'https://api.oxy.so').replace(/\/+$/, ''),
    fedcmIssuer,
    fedcmTokenSecret: readEnv(env, 'FEDCM_TOKEN_SECRET') || '',
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

/**
 * Fetch the RP origins this user has previously granted via FedCM. These
 * populate the spec's optional `approved_clients` array on the accounts
 * response so Chrome treats the account as a *returning* account for those RPs
 * — skipping the disclosure UI and (critically) allowing `mediation: 'silent'`
 * to resolve across apps. Without it every RP is treated as first-time and
 * cross-app silent SSO never completes.
 *
 * Best-effort: any failure yields an empty list (the account is still returned,
 * just without the returning-account optimization). The API endpoint is
 * cookie-less and harmless (it only returns public app origins the user
 * themselves authorized), so no auth token is needed for this server-to-server
 * call.
 */
async function fetchApprovedClients(apiBaseUrl: string, userId: string): Promise<string[]> {
  try {
    const url = `${apiBaseUrl}/fedcm/grants/${encodeURIComponent(userId)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;
    const origins = data.origins;
    if (!Array.isArray(origins)) return [];
    return origins.filter((o): o is string => typeof o === 'string' && o.length > 0);
  } catch {
    return [];
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
// First-party silent-restore helpers (Safari / Firefox — no FedCM)
//
// THREAT MODEL
// -----------
// `/auth/silent` issues a real Oxy access token from a host-only, first-party
// `fedcm_session` cookie. It exists because Safari (ITP) and Firefox (Total
// Cookie Protection) do not implement FedCM, so the Chrome path
// (navigator.credentials.get -> /fedcm/assertion -> api /fedcm/exchange) is
// unavailable there. Instead the RP embeds a hidden iframe pointing at
// `auth.<apex>/auth/silent`; because the RP CNAMEs `auth.<rp-domain>` to this
// worker (Clerk-style multi-domain FAPI), that iframe is SAME-SITE with the
// RP's own apex, so the browser DOES send the first-party `fedcm_session`
// cookie even under ITP/TCP. The endpoint reads that cookie and posts a token
// back to the embedder.
//
// Because a cookie-driven token issuer is a juicy target, this endpoint must
// hold the same security bar as FedCM itself. Two independent controls:
//
//  1. Browser cookie partitioning (defence in depth, NOT relied upon alone):
//     the `fedcm_session` cookie is host-only (no Domain attribute) and
//     first-party to `auth.<apex>`. A cross-site embedder on an UNRELATED apex
//     loads the iframe in a third-party context, so ITP/TCP withhold the
//     cookie and the endpoint sees no session -> posts a null result. This
//     stops the obvious "evil.example.com iframes auth.oxy.so" attack on
//     Safari/Firefox by construction.
//
//  2. Server-side client_id allow-listing (the PRIMARY control): we never
//     trust the embedder. The `client_id` query param (the RP origin the token
//     is destined for) is validated against the SAME approved-clients allow-
//     list the FedCM `/fedcm/exchange` endpoint enforces (`isClientApproved`).
//     The postMessage target origin is ALWAYS the validated `client_id` — never
//     '*'. So even if a browser leaked the cookie to an unapproved embedder
//     (e.g. an Oxy-owned-but-unregistered subdomain that IS same-site), the
//     token is only ever delivered to an origin Oxy has explicitly approved.
//     A malicious page that is somehow same-site but not on the allow-list
//     receives a null result, never a token.
//
// The token itself is obtained WITHOUT any new crypto or new API endpoint: we
// reuse the exact, already-audited Chrome pipeline server-side — mint the same
// HS256 FedCM ID token the `/fedcm/assertion` endpoint mints, then call the
// PUBLIC `POST /fedcm/nonce` + `POST /fedcm/exchange` on api.oxy.so with the
// `Origin` header set to the validated client_id. The API performs its full
// independent verification (issuer, signature, audience-approved, nonce,
// origin==aud) before issuing the session. The worker never signs an Oxy
// access token directly; api.oxy.so remains the sole session authority.
// ---------------------------------------------------------------------------

/** The session payload posted back to the RP iframe on a successful restore. */
interface SilentRestoreSession {
  sessionId: string;
  accessToken: string;
  expiresAt?: string;
  user?: { id: string; username?: string; email?: string; avatar?: string; name?: string };
}

/**
 * Normalise an origin for allow-list comparison: strip a trailing slash and
 * lowercase scheme + host. Returns `null` when the value is not a parseable
 * absolute origin (a bare path, empty string, etc.) so the caller treats it as
 * disallowed rather than throwing.
 */
function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${port}`;
  } catch {
    return null;
  }
}

/**
 * Validate a candidate RP `client_id` against the authoritative approved-
 * clients allow-list served by the Oxy API (`GET /fedcm/clients/approved`).
 * This is the SAME list `/fedcm/exchange` enforces via `isClientApproved`, so
 * the silent path cannot deliver a token to any origin the FedCM path would
 * itself reject. Returns the normalised, approved origin or `null`.
 *
 * Fails CLOSED: any network/parse error yields `null` (no token issued). The
 * endpoint is cookie-less and the response carries only public approved
 * origins, so no auth token is needed for this server-to-server call.
 */
async function resolveApprovedClientOrigin(
  apiBaseUrl: string,
  clientId: string | undefined
): Promise<string | null> {
  if (!clientId) return null;
  const candidate = normaliseOrigin(clientId);
  if (!candidate) return null;

  try {
    const res = await fetch(`${apiBaseUrl}/fedcm/clients/approved`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    // The controller responds `{ success, clients: string[] }`; tolerate an
    // `origins` alias defensively in case the shape ever changes.
    const list = (Array.isArray(data.clients) ? data.clients : data.origins) as unknown;
    if (!Array.isArray(list)) return null;
    for (const entry of list) {
      if (typeof entry !== 'string') continue;
      if (normaliseOrigin(entry) === candidate) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Mint a real Oxy access token + session for `userId`, destined for the
 * already-validated, approved `clientOrigin`. Reuses the existing,
 * independently-verified Chrome token pipeline end-to-end:
 *
 *   1. Mint the same HS256 FedCM ID token `/fedcm/assertion` mints (iss/sub/aud
 *      + a fresh nonce), signed with `FEDCM_TOKEN_SECRET`.
 *   2. `POST /fedcm/nonce` (Origin = clientOrigin) -> a server-bound, single-
 *      use nonce. The API binds the nonce to that Origin.
 *   3. Re-sign the ID token with the server nonce embedded (the API requires
 *      `nonce` and burns it on exchange).
 *   4. `POST /fedcm/exchange` (Origin = clientOrigin, `{ id_token }`) -> the
 *      API verifies issuer + signature + audience-approved + nonce + Origin==aud
 *      and returns `{ accessToken, sessionId, user, ... }`.
 *
 * The worker sets the outbound `Origin` header to `clientOrigin` so the API's
 * `origin == aud` and nonce-origin-binding checks pass. (Outbound `fetch` on
 * the Workers/Bun runtime — unlike a browser — may set `Origin`.) The API does
 * its OWN full verification, so a worker bug cannot bypass approval.
 *
 * Returns `null` on any failure (no token leaks).
 */
async function mintSessionForClient(
  config: ResolvedConfig,
  user: ResolvedUser,
  clientOrigin: string
): Promise<SilentRestoreSession | null> {
  const { apiBaseUrl, fedcmIssuer, fedcmTokenSecret } = config;
  if (!fedcmTokenSecret) return null;

  try {
    // 1. Obtain a server-minted, origin-bound nonce. A locally-generated nonce
    //    is rejected by `/fedcm/exchange` with `invalid_nonce`.
    const nonceRes = await fetch(`${apiBaseUrl}/fedcm/nonce`, {
      method: 'POST',
      headers: { Accept: 'application/json', Origin: clientOrigin },
      signal: AbortSignal.timeout(5000),
    });
    if (!nonceRes.ok) return null;
    const nonceData = (await nonceRes.json()) as Record<string, unknown>;
    const serverNonce = nonceData.nonce;
    if (typeof serverNonce !== 'string' || serverNonce.length === 0) return null;

    // 2. Mint the FedCM ID token (identical claims to /fedcm/assertion).
    const now = Math.floor(Date.now() / 1000);
    const idTokenPayload: Record<string, unknown> = {
      iss: fedcmIssuer,
      sub: user.id,
      aud: clientOrigin,
      iat: now,
      exp: now + TOKEN_LIFETIME,
      nonce: serverNonce,
    };
    if (user.email) idTokenPayload.email = user.email;
    if (user.name) idTokenPayload.name = user.name;
    if (user.username) idTokenPayload.preferred_username = user.username;
    const idToken = await createHS256JWT(idTokenPayload, fedcmTokenSecret);

    // 3. Exchange for a real Oxy session. The API re-verifies everything.
    const exchangeRes = await fetch(`${apiBaseUrl}/fedcm/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: clientOrigin,
      },
      body: JSON.stringify({ id_token: idToken }),
      signal: AbortSignal.timeout(5000),
    });
    if (!exchangeRes.ok) return null;
    const exchanged = (await exchangeRes.json()) as Record<string, unknown>;
    const accessToken = exchanged.accessToken;
    const sessionId = exchanged.sessionId;
    if (typeof accessToken !== 'string' || typeof sessionId !== 'string') return null;
    if (!accessToken || !sessionId) return null;

    const exchangedUser = exchanged.user as ResolvedUser | undefined;
    return {
      sessionId,
      accessToken,
      expiresAt: typeof exchanged.expiresAt === 'string' ? exchanged.expiresAt : undefined,
      user: exchangedUser ?? {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        name: user.name,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Serialise a value to a `<script>`-safe JSON literal. JSON cannot contain a
 * raw `<` / `>` / U+2028 / U+2029, but escaping them defends against a `</script>`
 * break-out and ancient line-terminator parser bugs even though every value
 * embedded here is server-controlled (tokens minted by us, the validated
 * origin). Defence in depth for an HTML-templating sink.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Render the HTML document the `/auth/silent` iframe returns. Its inline script
 * posts the session (or `null`) to `window.parent` targeting ONLY the validated
 * `targetOrigin` — never '*'. Matches `OxyServices.popup.ts` `waitForIframeAuth`:
 * `{ type: 'oxy_silent_auth', session, nonce }`. The client verifies
 * `event.origin === resolveAuthUrl()` (this IdP) and reads `event.data.session`.
 */
function renderSilentHtml(
  targetOrigin: string,
  session: SilentRestoreSession | null,
  nonce: string | undefined
): string {
  const message = {
    type: 'oxy_silent_auth',
    session,
    nonce: nonce ?? null,
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Oxy Silent Auth</title></head><body><script>
(function () {
  var message = ${jsonForScript(message)};
  var targetOrigin = ${jsonForScript(targetOrigin)};
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, targetOrigin);
    }
  } catch (e) {}
})();
</script></body></html>`;
}

/**
 * Render the HTML document the `/auth/session-check` iframe returns. Its inline
 * script posts a liveness result to `window.parent` targeting ONLY the validated
 * `targetOrigin`. Matches the poller in `@oxyhq/services` OxyContext:
 * `{ type: 'oxy-session-check', hasSession: boolean }`. This path NEVER returns
 * a token — it only tells the RP whether the IdP session is still alive so the
 * RP can drop a locally-cached session that was revoked elsewhere.
 */
function renderSessionCheckHtml(targetOrigin: string, hasSession: boolean): string {
  const message = { type: 'oxy-session-check', hasSession };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Oxy Session Check</title></head><body><script>
(function () {
  var message = ${jsonForScript(message)};
  var targetOrigin = ${jsonForScript(targetOrigin)};
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, targetOrigin);
    }
  } catch (e) {}
})();
</script></body></html>`;
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

/**
 * Preflight (OPTIONS) handler for the cross-origin credentialed POST
 * endpoints `/fedcm/assertion` and `/fedcm/disconnect`.
 *
 * The FedCM browser flow itself does NOT preflight `webidentity` requests,
 * but any non-spec JS client (tests, RP-side fetch, monitoring) that posts
 * with `credentials: 'include'` will. Returning a spec-compliant preflight
 * keeps these endpoints predictable for tooling and matches what the
 * `id_assertion`/`disconnect` POST responses already advertise.
 */
function preflightAssertionCors(c: AppContext): Response {
  const origin = c.req.header('origin');
  const requestedHeaders = c.req.header('access-control-request-headers');
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    c.header(
      'Access-Control-Allow-Headers',
      requestedHeaders || 'content-type, sec-fetch-dest'
    );
    c.header('Access-Control-Max-Age', '600');
    c.header('Vary', 'Origin, Access-Control-Request-Headers');
  }
  return c.body(null, 204);
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
 * GET /fedcm.json
 *
 * The IdP config manifest. Served dynamically (instead of as a static asset
 * under `public/fedcm.json`) so the icon URLs are always absolute to the
 * issuer the RP actually configured. When a relying party CNAMEs
 * `auth.<rp-domain>` to this worker, the browser pulls icons from
 * `auth.<rp-domain>/icons/...` rather than `auth.oxy.so/icons/...` — keeping
 * the entire FedCM flow single-origin (no third-party fetch) so Safari ITP /
 * Firefox Total Cookie Protection have nothing to gate.
 *
 * The endpoint paths (`accounts_endpoint`, `id_assertion_endpoint`,
 * `disconnect_endpoint`, `login_url`) stay relative — the browser resolves
 * them against the issuer it loaded the manifest from.
 *
 * Spec: https://w3c-fedid.github.io/FedCM/#idp-api-config-file
 */
app.get('/fedcm.json', (c) => {
  const { fedcmIssuer } = resolveConfig(c);
  return c.json({
    accounts_endpoint: '/fedcm/accounts',
    id_assertion_endpoint: '/fedcm/assertion',
    disconnect_endpoint: '/fedcm/disconnect',
    login_url: '/login',
    branding: {
      background_color: '#7C3AED',
      color: '#ffffff',
      icons: [
        { url: `${fedcmIssuer}/icons/icon-25.png`, size: 25 },
        { url: `${fedcmIssuer}/icons/icon-40.png`, size: 40 },
        { url: `${fedcmIssuer}/icons/icon-512.png`, size: 512 },
      ],
    },
  });
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

  const { apiBaseUrl } = resolveConfig(c);
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
    deleteCookie(c, COOKIE_NAME, { ...FEDCM_COOKIE_OPTIONS });
    c.header('WWW-Authenticate', 'FedCM');
    c.header('Set-Login', 'logged-out');
    return c.json({ error: 'not_logged_in' }, 401);
  }

  const accountEmail = user.email || `${user.username || user.id}@oxy.so`;

  const account: Record<string, unknown> = {
    id: user.id,
    name: user.name || user.username || 'Oxy User',
    email: accountEmail,
  };

  // `login_hints` declares the values an RP may pass as `loginHint` to target
  // THIS account. Per the FedCM spec Chrome only shows accounts whose
  // `login_hints` contains the RP-supplied hint — and, critically, when an
  // account declares NO `login_hints`, ANY non-empty hint filters it out
  // ("none matched the login hint"), greying every account in the chooser.
  // Populate it with every identifier an RP could realistically hint by: the
  // account id, the email, and the username (when present). Deduplicated to
  // keep the array minimal.
  //
  // Spec: https://w3c-fedid.github.io/FedCM/#dom-identityprovideraccount-login_hints
  const loginHints = Array.from(
    new Set(
      [user.id, accountEmail, user.username].filter(
        (hint): hint is string => typeof hint === 'string' && hint.length > 0
      )
    )
  );
  account.login_hints = loginHints;

  if (user.avatar) {
    account.picture = getAvatarUrl(apiBaseUrl, user.avatar);
  }

  // The FedCM spec allows an optional given_name field
  if (user.username) {
    account.given_name = user.username;
  }

  // `approved_clients` lists the RP client_ids (== RP origins, in our IdP) this
  // user has already granted. When the requesting RP is in this list, Chrome
  // skips the disclosure UI and lets `mediation: 'silent'` resolve — this is
  // what makes cross-app SSO work for returning users. A brand-new user has an
  // empty list (first visit always needs one chooser interaction, by spec).
  const approvedClients = await fetchApprovedClients(apiBaseUrl, user.id);
  if (approvedClients.length > 0) {
    account.approved_clients = approvedClients;
  }

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
app.options('/fedcm/assertion', (c) => preflightAssertionCors(c));

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
app.options('/fedcm/disconnect', (c) => preflightAssertionCors(c));

app.post('/fedcm/disconnect', async (c) => {
  // Cross-origin credentialed request — echo RP origin like the assertion
  // endpoint so the browser accepts the response.
  applyAssertionCors(c);

  // CSRF protection mandated by the FedCM spec.
  if (!hasWebIdentityDest(c)) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const { apiBaseUrl } = resolveConfig(c);

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
  deleteCookie(c, COOKIE_NAME, { ...FEDCM_COOKIE_OPTIONS });

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
  const { apiBaseUrl } = resolveConfig(c);
  const sessionId = getCookie(c, COOKIE_NAME);

  if (sessionId) {
    // Verify the session is still valid
    const valid = await validateSession(apiBaseUrl, sessionId);
    if (valid) {
      c.header('Set-Login', 'logged-in');
      return c.html('<!DOCTYPE html><html><body>logged-in</body></html>');
    }
    // Session invalid -- clean up
    deleteCookie(c, COOKIE_NAME, { ...FEDCM_COOKIE_OPTIONS });
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
  const { apiBaseUrl } = resolveConfig(c);
  const body = await c.req.json().catch(() => ({})) as Record<string, string>;
  const sessionId = body.sessionId;
  const action = body.action; // 'login' or 'logout'

  if (action === 'logout') {
    deleteCookie(c, COOKIE_NAME, { ...FEDCM_COOKIE_OPTIONS });
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
    ...FEDCM_COOKIE_OPTIONS,
    maxAge: COOKIE_MAX_AGE,
  });

  c.header('Set-Login', 'logged-in');
  return c.json({ success: true });
});

/**
 * GET /auth/silent
 *
 * First-party silent session restore for browsers WITHOUT FedCM (Safari ITP,
 * Firefox Total Cookie Protection). The RP embeds this as a hidden iframe at
 * `auth.<rp-apex>/auth/silent?client_id=<rp-origin>&nonce=<n>`. Because the RP
 * CNAMEs `auth.<rp-apex>` to this worker, the iframe is same-site with the RP's
 * apex, so the browser sends the first-party host-only `fedcm_session` cookie
 * even under ITP/TCP. We read it, validate the session, mint a real Oxy access
 * token destined for the validated RP origin, and postMessage it back.
 *
 * Returns an HTML document (NOT JSON) so the embedding iframe's inline script
 * can `window.parent.postMessage(...)`. The client contract is
 * `OxyServices.popup.ts` `waitForIframeAuth`: it expects
 * `{ type: 'oxy_silent_auth', session }` from `event.origin === resolveAuthUrl()`.
 *
 * SECURITY: see the "First-party silent-restore helpers" threat-model comment.
 * The postMessage target is ALWAYS the allow-listed `client_id` origin, never
 * '*'. A request whose `client_id` is missing, unparseable, or not on the
 * approved-clients list receives a `null` session posted to a SAFE fallback
 * target (the request's own Origin/Referer apex, or — when neither is present —
 * the IdP issuer itself, so the token-less null can never leak cross-origin).
 */
app.get('/auth/silent', async (c) => {
  const config = resolveConfig(c);
  const clientIdParam = c.req.query('client_id');
  const nonce = c.req.query('nonce');

  // Resolve the postMessage target. ONLY an approved client_id may receive a
  // session. For the negative/error cases we still need *some* same-origin-ish
  // target to post the `null` result to (so the iframe resolves rather than
  // hanging until the client's 5s timeout) — fall back to the request Origin,
  // then the issuer. We NEVER post to '*'.
  const approvedOrigin = await resolveApprovedClientOrigin(config.apiBaseUrl, clientIdParam);
  const requestOrigin = normaliseOrigin(c.req.header('origin') || '') ?? config.fedcmIssuer;
  const nullTarget = approvedOrigin ?? requestOrigin;

  // No cookie -> not logged in at this IdP. Post a null session.
  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) {
    return c.html(renderSilentHtml(nullTarget, null, nonce));
  }

  // The client_id MUST be an approved RP origin. If it isn't, we refuse to
  // mint or deliver a token even though the cookie is present — defence against
  // a same-site-but-unapproved embedder receiving credentials.
  if (!approvedOrigin) {
    return c.html(renderSilentHtml(nullTarget, null, nonce));
  }

  // Validate the session id -> user via the public, cookie-less endpoint.
  const user = await fetchUserFromAPI(config.apiBaseUrl, sessionId);
  if (!user) {
    // Stale cookie: clear it and report no session.
    deleteCookie(c, COOKIE_NAME, { ...FEDCM_COOKIE_OPTIONS });
    return c.html(renderSilentHtml(approvedOrigin, null, nonce));
  }

  // Mint a real Oxy access token for the validated, approved origin by reusing
  // the existing FedCM nonce + exchange pipeline (api.oxy.so is the authority).
  const session = await mintSessionForClient(config, user, approvedOrigin);
  return c.html(renderSilentHtml(approvedOrigin, session, nonce));
});

/**
 * GET /auth/session-check
 *
 * Lightweight IdP-session liveness probe for the `@oxyhq/services` poller
 * (OxyContext): when an authenticated tab regains focus it loads this in a
 * hidden iframe to confirm the IdP still has a session, dropping its local
 * session if the user signed out elsewhere. NEVER returns a token — only a
 * boolean `hasSession`. The client contract is
 * `{ type: 'oxy-session-check', hasSession }` from `event.origin === idpOrigin`.
 *
 * Same client_id allow-listing as `/auth/silent`: we post ONLY to the validated
 * RP origin (falling back to the request Origin / issuer for the negative case),
 * never '*'. Disclosing a boolean liveness bit is far lower-stakes than a token,
 * but allow-listing the target keeps the postMessage from leaking even that.
 */
app.get('/auth/session-check', async (c) => {
  const config = resolveConfig(c);
  const approvedOrigin = await resolveApprovedClientOrigin(config.apiBaseUrl, c.req.query('client_id'));
  const requestOrigin = normaliseOrigin(c.req.header('origin') || '') ?? config.fedcmIssuer;
  const target = approvedOrigin ?? requestOrigin;

  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) {
    return c.html(renderSessionCheckHtml(target, false));
  }

  const valid = await validateSession(config.apiBaseUrl, sessionId);
  if (!valid) {
    deleteCookie(c, COOKIE_NAME, { ...FEDCM_COOKIE_OPTIONS });
  }
  return c.html(renderSessionCheckHtml(target, valid));
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
