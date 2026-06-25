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
import { registrableApex, CENTRAL_IDP_APEX, SSO_CALLBACK_PATH } from '@oxyhq/core';
import type { UserNameResponse } from '@oxyhq/contracts';

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'fedcm_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
const TOKEN_LIFETIME = 600; // 10 minutes for id_tokens

/**
 * Lifetime (seconds) of the signed `establish-token` that carries a validated
 * central session across the second SSO hop to `auth.<rp-apex>`. Kept very
 * short: it only needs to survive a single 303 redirect + the browser's
 * immediate follow-up GET to `/sso/establish`. A tight 60s window shrinks the
 * replay surface to nothing meaningful while tolerating a slow network hop.
 */
const ESTABLISH_TOKEN_LIFETIME = 60; // 60 seconds

/**
 * The opaque `purpose` claim stamped on (and required of) the establish-token.
 * Scoping the token to a single purpose means a token minted for the SSO
 * establish hop can never be replayed as, e.g., a FedCM id_token even though
 * both are HS256-signed with the same `FEDCM_TOKEN_SECRET`.
 */
const ESTABLISH_TOKEN_PURPOSE = 'sso-establish';

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
  // Shared secret presented as the `X-Oxy-Internal` header on the
  // server-to-server `POST /sso/code` mint call. MUST equal the API's
  // `SSO_INTERNAL_SECRET` (GitHub secret → SSM `/oxy/oxy-api/SSO_INTERNAL_SECRET`).
  // When unset, GET /sso fails closed (it cannot mint a code, so it bounces the
  // RP with `oxy_sso=error` rather than silently issuing an unauthenticated one).
  SSO_INTERNAL_SECRET?: string;
  NODE_ENV?: string;
  ASSETS?: { fetch: typeof fetch };
}

type AppContext = Context<{ Bindings: WorkerEnv }>;

interface ResolvedConfig {
  apiBaseUrl: string;
  fedcmIssuer: string;
  fedcmTokenSecret: string;
  ssoInternalSecret: string;
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
    ssoInternalSecret: readEnv(env, 'SSO_INTERNAL_SECRET') || '',
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

/** Decode a base64url string to its UTF-8 text, or `null` on malformed input. */
function base64urlDecode(input: string): string | null {
  const bytes = base64urlBytes(input);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

/**
 * Verify an HS256 JWT against `secret` using Web Crypto's constant-time
 * `crypto.subtle.verify` (no hand-rolled string compare → no timing leak).
 * Returns the decoded payload object ONLY when the signature is valid and the
 * header declares `alg: HS256`; returns `null` on any structural, signature, or
 * algorithm mismatch. Expiry/claims are checked by the caller.
 *
 * The explicit `alg === 'HS256'` gate rejects an `alg: none` (or other-alg)
 * forgery: an attacker cannot strip the signature and have it accepted.
 */
async function verifyHS256JWT(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, signatureB64] = parts;

  const headerJson = base64urlDecode(headerB64);
  if (!headerJson) return null;
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(headerJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;

  const signatureBytes = base64urlBytes(signatureB64);
  if (!signatureBytes) return null;
  // Reject alternate base64url spellings of the same signature bytes. Without
  // this, mutating unused trailing bits can leave the decoded HMAC unchanged.
  if (base64url(signatureBytes) !== signatureB64) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    new TextEncoder().encode(`${headerB64}.${bodyB64}`)
  );
  if (!valid) return null;

  const bodyJson = base64urlDecode(bodyB64);
  if (!bodyJson) return null;
  try {
    return JSON.parse(bodyJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Decode a base64url string to raw bytes over a freshly-allocated, NON-shared
 * `ArrayBuffer`, or `null` on malformed input. The explicit `ArrayBuffer`
 * backing (rather than the default `ArrayBufferLike`, which TS widens to a
 * possible `SharedArrayBuffer`) is required so the result is accepted as a
 * `BufferSource` by `crypto.subtle.verify`.
 */
function base64urlBytes(input: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

interface ResolvedUser {
  id: string;
  email?: string;
  username?: string;
  /**
   * The structured, canonical name object the API's `formatUserResponse`
   * emits — `{ first?, last?, full?, displayName }` with a REQUIRED
   * `displayName`. This is what every SESSION-user object carries (it flows
   * verbatim through `/sso/code` and the `/auth/silent` postMessage), so the
   * shape MUST mirror `@oxyhq/contracts` `UserNameResponse` and NOT collapse to
   * a plain string. FedCM-native string surfaces (the accounts `name` field and
   * the id_token `name` claim) derive a display string via `displayNameOf`.
   */
  name?: UserNameResponse;
  avatar?: string;
}

/**
 * Derive a non-empty display string from a structured {@link UserNameResponse}
 * for the FedCM-native string surfaces (the accounts endpoint's `account.name`
 * and the id_token `name` claim — both are W3C/OIDC string fields). Prefers the
 * canonical `displayName`, then `full`, then composed `first last`. Returns
 * `undefined` when the name carries nothing renderable, so callers can fall
 * back to the username.
 */
function displayNameOf(name: UserNameResponse | undefined): string | undefined {
  if (!name) return undefined;
  if (typeof name.displayName === 'string' && name.displayName.trim()) {
    return name.displayName.trim();
  }
  if (typeof name.full === 'string' && name.full.trim()) return name.full.trim();
  const first = typeof name.first === 'string' ? name.first.trim() : '';
  const last = typeof name.last === 'string' ? name.last.trim() : '';
  const composed = [first, last].filter(Boolean).join(' ').trim();
  return composed || undefined;
}

/**
 * Normalise an arbitrary upstream `name` value (the API's structured object, a
 * legacy plain string, or nothing) into a valid {@link UserNameResponse} whose
 * `displayName` is GUARANTEED non-empty. This is the single chokepoint that
 * enforces the session-user name contract: `@oxyhq/core`'s `exchangeSsoCode`
 * (≥3.6.0) rejects a session whose `user.name` is not the structured shape with
 * a required `displayName`, so EVERY session-user this worker builds must pass
 * through here. The `displayName` is resolved from (in order) the structured
 * name's own `displayName`/`full`/`first last`, then the username, then the id —
 * never empty.
 */
function structuredName(
  raw: unknown,
  username: string | undefined,
  userId: string
): UserNameResponse {
  // The API's `formatUserResponse` emits a structured object. Tolerate a legacy
  // plain string and a missing value defensively so a producer drift can never
  // collapse the session contract.
  let base: UserNameResponse | undefined;
  if (raw && typeof raw === 'object') {
    base = raw as UserNameResponse;
  } else if (typeof raw === 'string' && raw.trim()) {
    base = { displayName: raw.trim() } as UserNameResponse;
  }

  const displayName =
    displayNameOf(base) ||
    (typeof username === 'string' && username.trim() ? username.trim() : '') ||
    userId;

  return { ...(base ?? {}), displayName };
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

    const username = user.username as string | undefined;

    return {
      id: userId,
      email: user.email as string | undefined,
      username,
      name: structuredName(user.name, username, userId),
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
  /**
   * The session user posted verbatim to `/sso/code` and the `/auth/silent`
   * postMessage. `name` MUST be the structured {@link UserNameResponse} with a
   * required `displayName` — `@oxyhq/core`'s `exchangeSsoCode` (≥3.6.0) throws
   * "SSO exchange returned an invalid user" if it is a plain string. Build it
   * via {@link structuredName} so the contract always holds.
   */
  user?: { id: string; username?: string; email?: string; avatar?: string; name?: UserNameResponse };
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
  const { apiBaseUrl, fedcmTokenSecret } = config;
  if (!fedcmTokenSecret) return null;

  // CRITICAL: the assertion `iss` claim MUST be the CENTRAL issuer, NEVER the
  // per-apex `config.fedcmIssuer`. The API's `POST /fedcm/exchange` validates
  // every assertion against the single central `https://auth.oxy.so` and rejects
  // any per-apex issuer (`Invalid issuer expected https://auth.oxy.so got
  // https://auth.mention.earth`). Because this function ONLY ever mints
  // API-bound assertions (mint ID token -> /fedcm/exchange), forcing the central
  // issuer here is correct for EVERY callsite and guarantees no caller — present
  // or future, central or per-apex host — can regress this. The per-apex
  // `config.fedcmIssuer` is still used UNCHANGED by the browser-native FedCM UI
  // surfaces (`/.well-known/web-identity`, the dynamic `/fedcm.json`), which MUST
  // keep returning the per-apex issuer; only this assertion mint is centralised.
  const fedcmIssuer = CENTRAL_FEDCM_ISSUER;

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
    // The OIDC `name` claim is a STRING (FedCM assertion field) — derive the
    // display string from the structured name. The structured object is carried
    // separately on the SESSION user below.
    const idTokenName = displayNameOf(user.name);
    if (idTokenName) idTokenPayload.name = idTokenName;
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

    // The API returns its own canonical `formatUserResponse` user (structured
    // `name.displayName`). Treat it as untrusted wire data: prefer its fields,
    // fall back to the resolved `user` we already hold, and ALWAYS run the name
    // through `structuredName` so the session contract holds even if an older
    // API deployment emits a plain-string `name` (or omits it). This is the
    // single producer of the SESSION user that flows verbatim to `/sso/code`
    // and the `/auth/silent` postMessage — `@oxyhq/core`'s `exchangeSsoCode`
    // (≥3.6.0) rejects a non-structured name with "invalid user".
    const exchangedUser = (exchanged.user ?? {}) as Record<string, unknown>;
    const sessionUserId =
      typeof exchangedUser.id === 'string' && exchangedUser.id ? exchangedUser.id : user.id;
    const sessionUsername =
      typeof exchangedUser.username === 'string' ? exchangedUser.username : user.username;
    return {
      sessionId,
      accessToken,
      expiresAt: typeof exchanged.expiresAt === 'string' ? exchanged.expiresAt : undefined,
      user: {
        id: sessionUserId,
        username: sessionUsername,
        email: typeof exchangedUser.email === 'string' ? exchangedUser.email : user.email,
        avatar: typeof exchangedUser.avatar === 'string' ? exchangedUser.avatar : user.avatar,
        name: structuredName(exchangedUser.name ?? user.name, sessionUsername, sessionUserId),
      },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Central top-level-redirect SSO (GET /sso)
//
// THREAT MODEL
// ------------
// `GET /sso` is the central, Clerk/Google/Meta-style cross-domain SSO entry.
// The RP performs a TOP-LEVEL navigation (window.location.assign) to
// `auth.oxy.so/sso?client_id=<rp>&return_to=<rp-callback>&state=<s>&prompt=none`.
// Because it is a top-level navigation (NOT an iframe/fetch), the host-only,
// first-party `fedcm_session` cookie on auth.oxy.so IS sent even under Safari
// ITP / Firefox Total Cookie Protection / Chrome's third-party-cookie phase-out.
//
// The endpoint NEVER puts a token/JWT/session in a URL. On success it redirects
// back to the RP callback with an OPAQUE, single-use, 30s-TTL `code` in the URL
// FRAGMENT (not the query — fragments are not sent to servers, not logged in
// access logs, and not leaked via Referer). The RP's callback page redeems the
// code at `POST /sso/exchange` for the real session.
//
// Controls layered here:
//   1. `prompt` MUST be `'none'` — this is a SILENT, no-UI bounce. Any other
//      value is rejected with an HTML 400 (never a redirect), so the endpoint
//      can never be coerced into showing a login UI cross-site.
//   2. `client_id` MUST be on the authoritative approved-clients allow-list
//      (`resolveApprovedClientOrigin`, the SAME list FedCM exchange enforces).
//   3. `return_to` MUST parse as https, its origin MUST equal the approved
//      client origin, AND its path MUST equal the fixed `SSO_CALLBACK_PATH`.
//      Until BOTH pass we never emit a redirect — the only `Location` this
//      handler ever writes is a fully-validated `return_to`. No open redirect.
//   4. The `code` is minted by the API (`POST /sso/code`, gated by the
//      `X-Oxy-Internal` shared secret) and bound to the approved origin there;
//      `/sso/exchange` re-checks the redeeming Origin == minted origin. A worker
//      bug cannot bypass approval — the API is the sole authority.
//   5. `state` is echoed verbatim in the fragment for the RP's own CSRF binding.
// ---------------------------------------------------------------------------

/**
 * Validate the RP-supplied `return_to` against the already-approved client
 * origin. Returns `true` ONLY when ALL hold:
 *   - it parses as an absolute URL,
 *   - its scheme is exactly `https:` (no http downgrade, no `javascript:` etc.),
 *   - its normalised origin equals the approved client origin, AND
 *   - its path is exactly `SSO_CALLBACK_PATH` (the single RP-owned callback).
 *
 * Fails CLOSED on any parse error. This is the open-redirect guard: GET /sso
 * NEVER writes a `Location` to a target this function has not blessed.
 */
function isReturnToOnClient(returnTo: string, approvedOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (normaliseOrigin(url.origin) !== approvedOrigin) return false;
  return url.pathname === SSO_CALLBACK_PATH;
}

/**
 * The issuer the API's `POST /fedcm/exchange` validates every assertion against
 * (the central-SSO model): `https://auth.<CENTRAL_IDP_APEX>` = `https://auth.oxy.so`.
 *
 * On the central host (`auth.oxy.so`) `resolveConfig().fedcmIssuer` already
 * derives to this value, so `GET /sso` mints assertions the API accepts. But the
 * per-apex second hop (`GET /sso/establish`) runs on `auth.<rp-apex>` (e.g.
 * `auth.mention.earth`), where `resolveConfig().fedcmIssuer` would derive to the
 * RP's host and the API would REJECT the exchange (`Invalid issuer`). This worker
 * is the SAME IdP serving every `auth.<apex>` CNAME and shares
 * `FEDCM_TOKEN_SECRET` with the API, so it is legitimate for it to mint a
 * central-issuer assertion from the per-apex host — exactly as `/sso` already
 * does on `auth.oxy.so`. `mintSessionForClient` forces this value for the
 * assertion `iss` at a SINGLE source of truth, so EVERY callsite (central
 * `/sso`, per-apex `/sso/establish`, per-apex `/auth/silent`) is correct and no
 * caller can regress it. The per-apex `Set-Cookie` is unaffected — the
 * `fedcm_session` cookie is host-only on `auth.<apex>`, independent of the
 * assertion issuer. NOTE: this is the ASSERTION-MINT issuer only; the
 * browser-native FedCM UI surfaces (`/.well-known/web-identity`, `/fedcm.json`)
 * MUST keep returning the PER-APEX issuer from `resolveConfig().fedcmIssuer`.
 */
const CENTRAL_FEDCM_ISSUER = `https://auth.${CENTRAL_IDP_APEX}`;

/**
 * Derive the per-apex first-party IdP host (`auth.<eTLD+1>`) for an approved
 * client origin, mirroring core `autoDetectAuthWebUrl`'s eTLD+1 logic
 * (last-two-labels with the multi-part-TLD guard).
 *
 * Returns `null` — meaning "no per-apex hop, use the central IdP directly" —
 * when:
 *   - the origin is unparseable,
 *   - the host is an IP literal (v4 or v6) or has fewer than two labels,
 *   - the trailing two labels form a known multi-part public suffix (the apex
 *     would be an attacker-registrable suffix), OR
 *   - the apex equals `CENTRAL_IDP_APEX` (`oxy.so`) — `auth.oxy.so` is already
 *     first-party to the client, so the central bounce already carries the
 *     durable credential and a second hop would be pure overhead.
 *
 * For an honest cross-registrable-domain client (e.g. `https://mention.earth`)
 * it returns `auth.mention.earth`, the host the client CNAMEs to this worker
 * and which is same-registrable-domain (first-party) with the RP page.
 */
function apexAuthHostForClient(clientOrigin: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(clientOrigin).hostname.toLowerCase();
  } catch {
    return null;
  }
  // `registrableApex` (core SINGLE SOURCE OF TRUTH) applies the same guards the
  // old inline code did: empty host, IPv4 (`/^\d+\.\d+\.\d+\.\d+$/`) / IPv6
  // (`[` / `:`) literals, `labels.length < 2`, and the `MULTIPART_TLDS`
  // multi-part-public-suffix bail. Returns the bare eTLD+1 or `null`.
  const apex = registrableApex(hostname);
  if (!apex) return null;

  // Same registrable domain as the central IdP → `auth.oxy.so` is already
  // first-party; skip the hop.
  if (apex === CENTRAL_IDP_APEX) return null;

  return `auth.${apex}`;
}

/** The non-secret outcome reported to the RP callback via the URL fragment. */
type SsoOutcome = 'ok' | 'none' | 'error';

/**
 * Build the fragment params for the RP callback redirect. `state` is always
 * echoed verbatim; `code` is present only on the `ok` outcome. The order is
 * stable (oxy_sso, then code, then state) so the fragment is deterministic.
 */
function buildSsoFragment(outcome: SsoOutcome, state: string, code?: string): Record<string, string> {
  const frag: Record<string, string> = { oxy_sso: outcome };
  if (outcome === 'ok' && typeof code === 'string' && code.length > 0) {
    frag.code = code;
  }
  frag.state = state;
  return frag;
}

/**
 * Redirect the top-level navigation back to the RP callback, carrying the SSO
 * outcome in the URL FRAGMENT (never the query/path). A 303 See Other forces
 * the browser to issue a GET and drops any request body.
 *
 * `returnTo` MUST already have passed `isReturnToOnClient` — this function does
 * NOT re-validate; it only serialises the fragment onto the blessed target. The
 * constructed URL (which may contain the single-use `code`) is NEVER logged.
 */
function redirectToCallback(
  c: AppContext,
  returnTo: string,
  fragObj: Record<string, string>
): Response {
  const url = new URL(returnTo);
  url.hash = new URLSearchParams(fragObj).toString();
  return c.redirect(url.toString(), 303);
}

/**
 * Mint a single-use SSO code for `session` bound to the approved `clientOrigin`
 * by calling the internal `POST /sso/code` on api.oxy.so with the
 * `X-Oxy-Internal` shared secret. The API validates `clientOrigin` against the
 * approved-clients allow-list again and stores the session under `sha256(code)`
 * with a 30s TTL. Returns the opaque `code`, or `null` on any failure (no
 * secret leaks: a `null` becomes an `oxy_sso=error` bounce, never a token).
 */
async function createSsoCode(
  config: ResolvedConfig,
  clientOrigin: string,
  session: SilentRestoreSession
): Promise<string | null> {
  if (!config.ssoInternalSecret) return null;
  try {
    const res = await fetch(`${config.apiBaseUrl}/sso/code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Oxy-Internal': config.ssoInternalSecret,
      },
      body: JSON.stringify({ clientOrigin, session }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const code = data.code;
    if (typeof code !== 'string' || code.length === 0) return null;
    return code;
  } catch {
    return null;
  }
}

/**
 * The verified claims of an establish-token. The token is the ONLY credential
 * that crosses the second SSO hop to `auth.<rp-apex>`; it never reaches JS and
 * only ever drives a Set-Cookie on a re-validated session.
 */
interface EstablishClaims {
  /** The central session id this token authorises planting first-party. */
  sessionId: string;
  /** The approved client origin the token is bound to (audience). */
  clientOrigin: string;
  /** The per-apex IdP host the cookie may be planted on. */
  apexAuthHost: string;
}

/**
 * Mint a short-lived, signed establish-token that carries an already-validated
 * central session across the second SSO hop to `auth.<rp-apex>`. Signed HS256
 * with the EXISTING `FEDCM_TOKEN_SECRET` (no new secret), bound to the approved
 * `clientOrigin` (aud) and the derived `apexAuthHost` (host), and stamped with
 * `purpose: 'sso-establish'` + a <=60s expiry. The token is opaque to the
 * browser (it only rides in the redirect URL and is re-verified server-side at
 * `/sso/establish`); it never returns a token to JS.
 */
async function createEstablishToken(
  config: ResolvedConfig,
  sessionId: string,
  clientOrigin: string,
  apexAuthHost: string
): Promise<string | null> {
  if (!config.fedcmTokenSecret) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: sessionId,
    aud: clientOrigin,
    host: apexAuthHost,
    purpose: ESTABLISH_TOKEN_PURPOSE,
    iat: now,
    exp: now + ESTABLISH_TOKEN_LIFETIME,
  };
  return createHS256JWT(payload, config.fedcmTokenSecret);
}

/**
 * Verify an establish-token at `/sso/establish`: checks the HS256 signature
 * (constant-time, alg-pinned), that `purpose` is exactly `'sso-establish'`,
 * that it has not expired, and that the bound `host` matches the request host
 * (so a token minted for `auth.mention.earth` cannot be replayed against
 * `auth.homiio.com`). Returns the typed claims, or `null` on ANY failure.
 *
 * The audience (`aud` == approved client origin) is returned for the caller to
 * re-validate against the live approved-clients allow-list — verification here
 * proves authenticity, the caller proves the client is still approved.
 */
async function verifyEstablishToken(
  config: ResolvedConfig,
  token: string,
  requestHost: string
): Promise<EstablishClaims | null> {
  const payload = await verifyHS256JWT(token, config.fedcmTokenSecret);
  if (!payload) return null;
  if (payload.purpose !== ESTABLISH_TOKEN_PURPOSE) return null;

  const exp = payload.exp;
  if (typeof exp !== 'number') return null;
  if (Math.floor(Date.now() / 1000) >= exp) return null;

  const sub = payload.sub;
  const aud = payload.aud;
  const host = payload.host;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (typeof aud !== 'string' || aud.length === 0) return null;
  if (typeof host !== 'string' || host.length === 0) return null;

  // The token is pinned to the host it was minted for. The request must be
  // served on exactly that host — defence against replaying a token captured
  // for one apex against a different (also-CNAMEd) apex.
  if (host.toLowerCase() !== requestHost.toLowerCase()) return null;

  return { sessionId: sub, clientOrigin: aud, apexAuthHost: host };
}

/**
 * Apply the no-store / no-referrer headers every sensitive SSO bounce sets.
 * These responses carry (or are one redirect away from) a single-use credential
 * and a callback URL — they must never be cached anywhere, and the Referer must
 * be stripped so the RP callback URL is not leaked onward.
 */
function applyNoStoreHeaders(c: AppContext): void {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Referrer-Policy', 'no-referrer');
}

/**
 * The canonical Oxy logo mark, inlined as an SVG path string so server-rendered
 * pages (which have no access to the React `<Logo>` component) present the SAME
 * brand mark as the `/login` screen. Mirrors `packages/auth/components/logo.tsx`:
 * the outer flower path inherits `currentColor` (the brand primary) and the
 * inner cut-out is filled white, exactly as the React component renders it.
 */
const OXY_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="80 263 1010 1003" fill="currentColor" aria-hidden="true" focusable="false"><path d="M520.4336 284.25c-48.73438 5.57422-93.89844 40.73047-120.91016 93.60938-13.57422 26.72656-22.57813 60.8828-24.4375 92.32421l-.85547 15.29297-12.29297-6.28906c-34.8711-17.72266-66.16797-25.4414-103.75781-25.58203-33.15625-.14453-56.59375 4.85937-81.3164 17.14844-37.73048 18.86718-61.59767 48.16406-72.46095 88.60937-4 15.0039-4.42968 47.30469-.85546 63.59766 8.28906 36.8711 26.72656 70.74218 54.30859 99.46875 13.71875 14.14843 36.01562 32.30078 48.01953 39.01562 3.14453 1.85938 5.85938 3.71485 5.85938 4.14453 0 .4297-2.57422 2.28907-5.71875 4.14454-12.28907 7.0039-34.29688 25.01171-47.875 39.16015-59.88282 62.16797-74.60157 144.77344-36.30079 203.51172 21.4375 32.8711 55.3086 54.3086 99.1836 62.88281 17.57812 3.42969 53.44922 3.42969 72.74219 0 23.72656-4.28906 45.44921-11.57422 67.88671-22.86719l13.00391-6.57421v8.28906c0 19.15234 4.85938 46.44922 12.29297 68.88672 29.72656 90.03515 106.32812 140.6289 182.64453 120.76172 35.44531-9.28907 69.3164-35.15625 92.32422-70.7422 19.72266-30.58202 33.01562-72.60155 35.30078-111.7578l.85938-15.15235 12.71875 6.4336c36.01562 18.0078 66.74218 25.4375 105.47265 25.29687 36.15625-.14453 62.59766-6.86328 90.75-23.29687 14.71875-8.57422 36.30078-29.8711 44.875-44.16016 14.00781-23.29688 19.00781-41.875 19.15234-70.3164.14063-29.15235-3.85937-46.16016-17.57812-75.31641-16.57813-35.01563-49.02344-71.17188-83.17969-92.32422-5.28515-3.28516-9.71875-6.28906-9.71875-6.71484 0-.4297 4.4336-3.4297 9.71875-6.71875 24.15235-15.00391 52.45313-42.44532 68.17188-66.16797 25.4375-38.16016 36.8711-79.32032 32.30078-116.6211-7.71875-62.16797-52.02344-106.75781-119.48047-120.05078-19.00781-3.85547-54.8789-3.57031-75.7461.57422-21.72265 4.28516-39.73046 10.28906-60.30859 20.29297l-17.57812 8.4336v-8.14844c0-40.30079-16.57813-91.89454-40.16016-125.33594-27.72656-39.01563-64.88281-62.45313-107.61719-67.88672-12.71875-1.57031-14.14843-1.57031-29.4375.14453z"/><g transform="translate(465 188)"><defs><clipPath id="oxyClip"><path d="M0 0h1427v1151H0z"/></clipPath></defs><g clip-path="url(#oxyClip)"><path d="M347.55328 964.6769c-49.26953 3.6211-93.6914-5.95703-133.25781-28.73437-36.3789-20.9414-67.09375-49.97656-92.14453-87.10547-23.0039-34.08984-41.0586-73.63281-54.16407-118.63281-12.41406-42.61719-20.35937-87.60156-23.83984-134.94922-3.27734-44.58203-1.6836-90.02734 4.78125-136.34375 6.73828-48.27734 19.41406-92.66406 38.02344-133.15625 19.95703-43.41797 46.86719-79.98047 80.73047-109.6875 38.33984-33.63672 84.80078-52.46094 139.38281-56.46875 54.17969-3.98437 101.57031 7.91797 142.17969 35.69922 35.92187 24.57422 65.29687 57.1836 88.13281 97.82031 20.57031 36.60938 36.33203 77.66797 47.28516 123.17969 10.30078 42.79687 17.04297 85.88672 20.23047 129.25781 3.62109 49.26953 2.11718 96.4414-4.51563 141.52344-6.98438 47.47266-19.98828 90.26563-39.00781 128.375-20.59375 41.27344-48.125 75.05078-82.58594 101.33594-36.99219 28.21093-80.73828 44.17578-131.23047 47.88672zm-10.72656-145.91796c21.5625-1.58594 39.30469-7.6875 53.22656-18.30469 16.45313-12.55078 29.91797-29.32813 40.40235-50.33203 12.0625-24.16797 20.44921-52.28125 25.16796-84.33984 5.06641-34.44922 6.1836-70.94922 3.35157-109.5-2.60547-35.4375-8.125-70.6875-16.5625-105.75-7.78907-32.34766-18.65235-60.9297-32.58985-85.7422-11.67578-20.77734-26.07422-37.02343-43.19531-48.73827-12.42969-8.50391-28.71094-12.01563-48.83984-10.53516-21.97657 1.61328-39.85157 8.46094-53.6172 20.53516-18.24218 16.0039-33 36.27343-44.27343 60.80468-12.61719 27.45313-21.30469 58.21485-26.0625 92.28125-5.02734 36.03516-6.28516 71.16407-3.76953 105.39454 2.72656 37.09375 8.85937 72.01171 18.39453 104.7539 8.84375 30.35938 20.5039 56.26563 34.97656 77.71875 12.42188 18.41016 27.03907 32.45703 43.84766 42.13281 13.6211 7.83985 30.13672 11.04688 49.54297 9.6211zm-13.76953-326.00781c5.33594-.39063 10.48047-1.96094 15.4336-4.70313 4.35155-2.41016 7.85546-5.32812 10.51171-8.75-1.22266 1.57422-2.5664 4.92188-4.03125 10.05078-2.5625 8.94922-4.1836 19.3789-4.86328 31.29688-.8086 14.15625-.6875 28.37109.36328 42.64453 1.21875 16.58984 3.5039 33.11328 6.86328 49.57031 3.08594 15.1289 6.90234 28.3125 11.44531 39.55078 2.89844 7.16016 5.48828 11.98047 7.77735 14.46094-2.85547-3.09375-6.64844-5.66797-11.38672-7.71875-6.2461-2.70703-12.67578-3.8164-19.28125-3.32813-7.82422.57422-15.04688 3.29688-21.66797 8.17188-4.82812 3.55469-8.26953 7.39844-10.32031 11.53516 3.17578-6.39844 5.63672-14.89063 7.38672-25.46875 2.29687-13.86329 3.46093-28.15625 3.49218-42.88282.03907-16.83593-.33203-30.52734-1.10546-41.07031-.91016-12.3711-2.70313-25.53906-5.37891-39.4961-2.34766-12.23046-5.45313-23.22265-9.3164-32.97656-2.39454-6.03515-4.7461-10.35547-7.0625-12.96093 3.26952 3.67968 7.53906 6.64453 12.80859 8.88671 6.05859 2.57813 12.17187 3.64063 18.33203 3.1875z"/><path d="M342.19 891.70425c-34.34375 2.53125-64.8125-3.85547-91.40625-19.15625-26.59375-15.3125-49.26172-36.85156-68-64.625-18.73047-27.78125-33.58594-60.5039-44.5625-98.17188-10.96875-37.67578-18.0039-77.625-21.10938-119.84375-2.89453-39.40625-1.46874-79.6953 4.28126-120.875 5.75-41.17578 16.42578-78.75 32.03124-112.71875 15.61329-33.97656 36.44532-62.39453 62.5-85.25 26.05079-22.85156 58.21875-35.6875 96.5-38.5 37.14454-2.72656 68.97657 4.98047 95.5 23.125 26.51954 18.13672 48.40625 42.5625 65.65625 73.28126 17.25782 30.71093 30.57032 65.53125 39.9375 104.46875 9.375 38.92968 15.50782 78.09375 18.40626 117.5 3.22656 43.90625 1.91406 85.74609-3.9375 125.51562-5.84375 39.76172-16.53907 75.21094-32.07813 106.34375-15.54297 31.13672-36.04297 56.41406-61.5 75.82813-25.44922 19.40625-56.1875 30.42968-92.21875 33.07812zm-24.5-471.89063c-10.69922.78125-19.53906 5.67188-26.51563 14.67188-6.98046 8.99219-12.49609 20.57031-16.54687 34.73438-4.04297 14.16796-6.5625 29.92187-7.5625 47.26562-.99219 17.33594-.84375 34.73047.4375 52.1875 1.44531 19.69922 4.16016 39.30469 8.14063 58.8125 3.98828 19.51172 9.09375 36.96484 15.3125 52.35938 6.22656 15.39843 13.49218 27.60156 21.79687 36.60937 8.30078 9 17.80078 13.10938 28.5 12.32813 12.38281-.91407 21.78125-7.83204 28.1875-20.75 6.40625-12.91407 11.07813-28.25391 14.01563-46.01563 2.9453-17.75781 4.4414-35.97656 4.48437-54.65625.03906-18.6875-.39844-34.21875-1.3125-46.59375-1.11719-15.19531-3.28125-31.17188-6.5-47.92188-3.21094-16.75-7.59375-32.1328-13.15625-46.15625-5.55469-14.01953-12.33984-25.54687-20.35938-34.57812-8.02343-9.03125-17.66406-13.1289-28.92187-12.29688z" fill="white"/></g></g></svg>`;

/**
 * Base brand stylesheet shared by server-rendered IdP pages. The custom
 * properties carry the EXACT `oxy` Bloom color preset triples consumed by the
 * `/login` React app (`@oxyhq/bloom/color-presets` → `APP_COLOR_PRESETS.oxy`),
 * wrapped in `hsl()` so this self-contained document needs no runtime theming
 * JS. `prefers-color-scheme` maps the preset's light/dark variants the same way
 * the app's `BloomThemeProvider mode="system"` does. No custom web font is
 * loaded here (no `@import`/`@font-face`): `--font-sans` matches the default
 * stack Bloom resolves — Inter preferred, falling back to the system sans —
 * exactly as the SPA renders once Bloom's default font applies globally.
 */
const BRAND_BASE_CSS = `:root{color-scheme:light dark;--background:hsl(277 55% 96%);--foreground:hsl(0 0% 12%);--card:hsl(277 58% 94%);--card-foreground:hsl(0 0% 12%);--muted-foreground:hsl(277 5% 42%);--primary:hsl(277 66% 56%);--primary-foreground:hsl(0 0% 100%);--border:hsl(277 40% 87%);--ring:hsl(277 66% 56%);--radius:0.875rem;--font-sans:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--background:hsl(277 50% 5%);--foreground:hsl(0 0% 93%);--card:hsl(277 20% 18%);--card-foreground:hsl(0 0% 93%);--muted-foreground:hsl(0 0% 70%);--border:hsl(277 12% 20%)}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;min-height:100svh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--background);color:var(--foreground);font-family:var(--font-sans);line-height:1.55;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}`;

/**
 * Render the HTML error page GET /sso returns for a malformed/unauthorised
 * request (bad `prompt`, unapproved `client_id`, or invalid `return_to`). We
 * deliberately render an HTML page with an HTTP 4xx status instead of
 * redirecting — when validation fails we have NO blessed target to redirect to,
 * so emitting any `Location` would risk an open redirect. The `reason` is a
 * fixed, non-sensitive token (`invalid_request`); no request values are
 * reflected into the page (no XSS sink).
 *
 * The markup mirrors the `/login` React screen (`AuthLayout` +
 * `AuthFormLayout`/`AuthFormHeader`): the real Oxy mark on top, a heading, body
 * copy, and a primary action styled like login's "Next"/"Sign in" button — so a
 * user can't tell this is a different page than the SPA. The heading uses the
 * same `--font-sans` family as the body (no custom display font).
 */
function renderSsoErrorHtml(reason: string): string {
  // `safeReason` is sanitised to a fixed token alphabet so nothing
  // request-derived can ever reach the markup. No other request value is
  // reflected — this preserves the no-reflected-input / no-XSS guarantee.
  const safeReason = reason.replace(/[^a-z_]/g, '');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Sign-in error · Oxy</title><style>
${BRAND_BASE_CSS}
.shell{width:100%;max-width:28rem;display:flex;flex-direction:column;gap:1.5rem}
.mark{display:flex;align-items:center}
.mark svg{height:3.5rem;width:auto;color:var(--primary)}
.card{display:flex;flex-direction:column;gap:.5rem}
h1{font-family:var(--font-sans);font-size:3rem;line-height:1.05;font-weight:800;letter-spacing:-0.02em;margin:0}
.lead{font-size:1.125rem;color:var(--muted-foreground);margin:.25rem 0 0}
.reason{display:inline-block;align-self:flex-start;margin-top:.75rem;padding:.25rem .625rem;border-radius:calc(var(--radius) - 4px);background:var(--card);color:var(--muted-foreground);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.8125rem}
.actions{margin-top:1rem}
.btn{display:inline-flex;align-items:center;justify-content:center;width:100%;appearance:none;border:0;cursor:pointer;font-family:var(--font-sans);font-weight:600;font-size:1rem;height:2.75rem;padding:0 1.5rem;border-radius:var(--radius);background:var(--primary);color:var(--primary-foreground);transition:transform .2s cubic-bezier(0.34,1.56,0.64,1),filter .15s ease}
.btn:hover{filter:brightness(1.06)}
.btn:active{transform:scale(0.96)}
.btn:focus-visible{outline:2px solid var(--ring);outline-offset:3px}
@media (prefers-reduced-motion:reduce){.btn{transition:none}.btn:active{transform:none}}
</style></head><body><main class="shell"><div class="mark" aria-hidden="true">${OXY_LOGO_SVG}</div><div class="card"><h1>Sign-in error</h1><p class="lead">We couldn't complete the single sign-on request. Head back to the app and try signing in again.</p><p class="reason">${safeReason}</p></div><div class="actions"><button type="button" class="btn" onclick="history.back()">Go back</button></div></main></body></html>`;
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
 * Same-origin guard for the `POST /fedcm/set-session` cookie-planting endpoint.
 *
 * THREAT: `/fedcm/set-session` plants the host-only `fedcm_session` cookie that
 * every other IdP endpoint (FedCM accounts/assertion, `/auth/silent`, `/sso`)
 * trusts to identify the logged-in user. If an attacker page on a different
 * site could drive this endpoint with `credentials: 'include'`, it could plant
 * an ATTACKER-controlled sessionId — a session-fixation / login-CSRF vector
 * that would then be honoured by the silent and `/sso` flows.
 *
 * The ONLY legitimate caller is the SPA itself, which is SAME-ORIGIN with the
 * IdP (it runs on `auth.oxy.so` — or on a CNAME'd `auth.<rp-apex>` host that is
 * same-origin with the endpoint it calls). So we require BOTH:
 *
 *   - `Sec-Fetch-Site: same-origin` (or `none` for a direct address-bar load /
 *     same-document fetch). A cross-site page cannot forge this header — it is
 *     set by the browser. We REJECT `same-site` and `cross-site`.
 *   - When an `Origin` header is present (it is on any fetch/XHR), it MUST equal
 *     the request's own origin. Defence-in-depth alongside Sec-Fetch-Site for
 *     older engines, and it makes the same-origin contract explicit.
 *
 * Requests from clients that omit BOTH headers (non-browser tooling, server-to-
 * server) are allowed through — they cannot be a cross-site browser attack by
 * construction, and the endpoint still independently validates the sessionId
 * against the API before planting anything.
 */
function isSameOriginSetSession(c: AppContext): boolean {
  const secFetchSite = c.req.header('sec-fetch-site');
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return false;
  }

  const origin = c.req.header('origin');
  if (origin) {
    const requestOrigin = normaliseOrigin(c.req.url);
    if (!requestOrigin || normaliseOrigin(origin) !== requestOrigin) {
      return false;
    }
  }
  return true;
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
    // FedCM `account.name` is a STRING (W3C spec) — derive the display string
    // from the structured name, falling back to the username.
    name: displayNameOf(user.name) || user.username || 'Oxy User',
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

  const requestOrigin = normaliseOrigin(c.req.header('origin') || '');
  const approvedClientOrigin = await resolveApprovedClientOrigin(apiBaseUrl, clientId);
  if (!requestOrigin || !approvedClientOrigin || requestOrigin !== approvedClientOrigin) {
    return c.json({ error: 'invalid_client' }, 400);
  }
  clientId = approvedClientOrigin;

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

  // Include basic claims. The OIDC `name` claim is a STRING — derive it from
  // the structured name object.
  if (user.email) payload.email = user.email;
  const assertionName = displayNameOf(user.name);
  if (assertionName) payload.name = assertionName;
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
  // Reject any cross-site attempt to plant/clear the cookie. The only
  // legitimate caller is the same-origin SPA (see `isSameOriginSetSession`).
  if (!isSameOriginSetSession(c)) {
    return c.json({ error: 'invalid_request' }, 403);
  }

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

/**
 * GET /sso
 *
 * Central, top-level-redirect cross-domain SSO (Clerk/Google/Meta pattern). The
 * RP performs a TOP-LEVEL navigation here so the first-party `fedcm_session`
 * cookie on auth.oxy.so is sent even under Safari ITP / Firefox TCP / Chrome's
 * third-party-cookie phase-out. On success the RP is bounced back to its
 * callback with an OPAQUE, single-use `code` in the URL FRAGMENT — NEVER a
 * token/JWT/session in any URL.
 *
 * Query (all REQUIRED):
 *   client_id  — the RP origin (validated against the approved-clients list)
 *   return_to  — absolute https URL on client_id, path == SSO_CALLBACK_PATH
 *   state      — opaque RP value echoed verbatim in the fragment (RP CSRF binding)
 *   prompt     — only `'none'` is honoured (silent, no-UI bounce)
 *
 * See the "Central top-level-redirect SSO" threat-model comment for the full
 * control layering. The ONLY redirect target this handler ever writes is a
 * fully-validated `return_to`; every failure before validation renders an HTML
 * error page (no `Location`), so there is no open-redirect surface.
 */
app.get('/sso', async (c) => {
  // 1. This is a sensitive auth bounce — never cache it anywhere, and strip the
  //    Referer so the RP callback URL is not leaked onward.
  applyNoStoreHeaders(c);

  const config = resolveConfig(c);
  const clientId = c.req.query('client_id');
  const returnTo = c.req.query('return_to');
  const state = c.req.query('state');
  const prompt = c.req.query('prompt');

  // 2. prompt MUST be exactly 'none' (silent bounce). Anything else is an
  //    invalid request — render an HTML error, never redirect. `state` may be
  //    absent here; we still cannot honour a non-silent prompt.
  if (prompt !== 'none') {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }

  // `state` and `return_to` are load-bearing for every downstream branch
  // (we echo `state` and redirect to `return_to`). A missing one is malformed.
  if (typeof state !== 'string' || state.length === 0) {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }
  if (typeof returnTo !== 'string' || returnTo.length === 0) {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }

  // 3. client_id MUST be an approved RP origin (authoritative allow-list — the
  //    same list FedCM exchange enforces). Fails closed to an HTML error.
  const approvedOrigin = await resolveApprovedClientOrigin(config.apiBaseUrl, clientId);
  if (!approvedOrigin) {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }

  // 4. return_to MUST be https, on the approved origin, at the fixed callback
  //    path. Until this passes we have NO blessed redirect target — render an
  //    HTML error rather than emit any Location (open-redirect guard).
  if (!isReturnToOnClient(returnTo, approvedOrigin)) {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }

  // 5. From here the ONLY redirect target is `returnTo` (origin == approved,
  //    path == SSO_CALLBACK_PATH). The outcome rides in the fragment.

  // 6. No session cookie → not logged in at the IdP. Silent prompt=none means
  //    an immediate logged-out bounce — NEVER show a login UI.
  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) {
    return redirectToCallback(c, returnTo, buildSsoFragment('none', state));
  }

  // 7. Resolve the cookie → user via the public, cookie-less endpoint. A stale
  //    cookie (session expired/revoked) → clear it and bounce logged-out.
  const user = await fetchUserFromAPI(config.apiBaseUrl, sessionId);
  if (!user) {
    deleteCookie(c, COOKIE_NAME, { ...FEDCM_COOKIE_OPTIONS });
    return redirectToCallback(c, returnTo, buildSsoFragment('none', state));
  }

  // 8. DURABLE-SESSION SECOND HOP. This bounce runs on the CENTRAL IdP host
  //    (auth.oxy.so), which is THIRD-PARTY to a cross-registrable-domain RP
  //    (e.g. mention.earth) under Safari ITP / Firefox TCP. Minting the code
  //    here would work for THIS load, but the RP could never restore the
  //    session on a reload without re-bouncing (the only refresh cookie lives
  //    on a third-party origin). To make the session durable we route through
  //    the RP's OWN per-apex IdP host (`auth.<rp-apex>`, CNAMEd to this worker
  //    and FIRST-PARTY to the RP), which plants its own host-only fedcm_session
  //    cookie. We carry the validated session there via a short-lived, signed,
  //    audience+host-bound establish-token (no credential in the URL but that
  //    token, which only ever sets a cookie — never returns a token to JS).
  //
  //    For *.oxy.so clients (apex == oxy.so) `apexAuthHostForClient` returns
  //    null — auth.oxy.so is ALREADY first-party to the client, so the central
  //    bounce already carries the durable credential. Skip the hop and mint the
  //    code directly (steps 9–10 below), exactly as before.
  const apexAuthHost = apexAuthHostForClient(approvedOrigin);
  if (apexAuthHost) {
    const establishToken = await createEstablishToken(
      config,
      sessionId,
      approvedOrigin,
      apexAuthHost
    );
    if (!establishToken) {
      return redirectToCallback(c, returnTo, buildSsoFragment('error', state));
    }
    const establishUrl = new URL(`https://${apexAuthHost}/sso/establish`);
    establishUrl.searchParams.set('et', establishToken);
    establishUrl.searchParams.set('return_to', returnTo);
    establishUrl.searchParams.set('state', state);
    // 303 forces a GET on the follow-up so the browser lands on /sso/establish
    // top-level on auth.<rp-apex> — first-party to the RP — where the durable
    // host-only cookie is planted.
    return c.redirect(establishUrl.toString(), 303);
  }

  // 9. (*.oxy.so path) Mint a real Oxy session for the approved origin via the
  //    full, already-audited FedCM nonce + exchange pipeline (server nonce born
  //    + burned inside this call). On any failure → error bounce (no leaks).
  const session = await mintSessionForClient(config, user, approvedOrigin);
  if (!session) {
    return redirectToCallback(c, returnTo, buildSsoFragment('error', state));
  }

  // 10. Wrap the session in an opaque, single-use, origin-bound code via the
  //     internal `POST /sso/code` (X-Oxy-Internal secret). On failure → error
  //     bounce. The code — never the session — travels in the fragment.
  const code = await createSsoCode(config, approvedOrigin, session);
  if (!code) {
    return redirectToCallback(c, returnTo, buildSsoFragment('error', state));
  }

  // 11. Success: bounce back with `oxy_sso=ok`, the opaque `code`, and `state`
  //     in the FRAGMENT. The RP callback redeems the code at /sso/exchange.
  return redirectToCallback(c, returnTo, buildSsoFragment('ok', state, code));
});

/**
 * GET /sso/establish
 *
 * The SECOND SSO hop, served on the RP's per-apex IdP host (`auth.<rp-apex>`,
 * CNAMEd to this worker). Because that host is same-registrable-domain with the
 * RP page, it is FIRST-PARTY to the RP even under Safari ITP / Firefox Total
 * Cookie Protection. Its job: plant a durable, host-only `fedcm_session` cookie
 * for THIS host (so future reloads restore via the first-party `/auth/silent`
 * iframe with NO top-level re-bounce/flash), then complete the SSO handoff by
 * minting the opaque code and bouncing to the RP callback.
 *
 * The browser arrives here via the 303 from the central `/sso` bounce. The ONLY
 * credential it carries is the signed, short-lived, audience+host-bound
 * establish-token (`?et=`). No session id or access token is ever exposed to JS.
 *
 * Query (all REQUIRED):
 *   et         — the signed establish-token (HS256, FEDCM_TOKEN_SECRET)
 *   return_to  — absolute https URL on the approved client, path == SSO_CALLBACK_PATH
 *   state      — opaque RP value echoed verbatim in the fragment (RP CSRF binding)
 *
 * SECURITY — every step fails CLOSED:
 *   - The establish-token signature + expiry + `purpose` + `host`==request-host
 *     are verified before anything else (forged/expired/replayed → HTML 400).
 *   - `clientOrigin` (the token's aud) is RE-validated against the live
 *     approved-clients allow-list (a client revoked between hops is rejected).
 *   - `return_to` is RE-validated with `isReturnToOnClient` (open-redirect guard).
 *   - The session is RE-validated against the API; the cookie is planted ONLY
 *     on a still-valid session for a still-approved client. On an invalid
 *     session we bounce `oxy_sso=error` and plant NOTHING.
 */
app.get('/sso/establish', async (c) => {
  applyNoStoreHeaders(c);

  const config = resolveConfig(c);
  const et = c.req.query('et');
  const returnTo = c.req.query('return_to');
  const state = c.req.query('state');

  // `state` and `return_to` are load-bearing (we echo `state` and redirect to
  // `return_to`). A missing one is malformed — render an HTML 400, no redirect.
  if (typeof state !== 'string' || state.length === 0) {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }
  if (typeof returnTo !== 'string' || returnTo.length === 0) {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }
  if (typeof et !== 'string' || et.length === 0) {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }

  // 1. Verify the establish-token: HS256 signature (constant-time, alg-pinned),
  //    purpose == 'sso-establish', not expired, and pinned host == this request
  //    host. Any failure → HTML 400 (never a redirect — we have no blessed
  //    target until the embedded return_to is independently re-validated).
  const requestHost = new URL(c.req.url).host;
  const claims = await verifyEstablishToken(config, et, requestHost);
  if (!claims) {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }

  // 2. RE-validate the token's audience against the LIVE approved-clients
  //    allow-list (a client could have been revoked between the two hops).
  const approvedOrigin = await resolveApprovedClientOrigin(config.apiBaseUrl, claims.clientOrigin);
  if (!approvedOrigin) {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }

  // 3. RE-validate return_to (https, on the approved origin, fixed callback
  //    path). Until this passes we emit NO Location — open-redirect guard.
  if (!isReturnToOnClient(returnTo, approvedOrigin)) {
    return c.html(renderSsoErrorHtml('invalid_request'), 400);
  }

  // 4. From here the ONLY redirect target is the validated `returnTo`.

  // 5. RE-validate the session against the API. The cookie is planted ONLY on a
  //    still-valid session. A session revoked between hops → error bounce, no
  //    cookie planted.
  const user = await fetchUserFromAPI(config.apiBaseUrl, claims.sessionId);
  if (!user) {
    return redirectToCallback(c, returnTo, buildSsoFragment('error', state));
  }

  // 6. PLANT THE DURABLE FIRST-PARTY CREDENTIAL. Set the host-only
  //    `fedcm_session` cookie for THIS request host (auth.<rp-apex>) using the
  //    SAME options `/fedcm/set-session` uses (no Domain, Secure, HttpOnly,
  //    SameSite=None, 30d). The value is the validated central sessionId,
  //    exactly as the central host stores it. Because this host is first-party
  //    to the RP, the cookie survives ITP/TCP — future reloads restore via the
  //    first-party `/auth/silent` iframe with no top-level re-bounce.
  setCookie(c, COOKIE_NAME, claims.sessionId, {
    ...FEDCM_COOKIE_OPTIONS,
    maxAge: COOKIE_MAX_AGE,
  });
  c.header('Set-Login', 'logged-in');

  // 7. Complete the SSO handoff: mint a real Oxy session for the approved
  //    origin via the full FedCM nonce + exchange pipeline (server nonce born +
  //    burned inside), then wrap it in an opaque, single-use, origin-bound code.
  //    Either failure → error bounce (the durable cookie is already set, so a
  //    reload will still restore first-party even if this immediate handoff
  //    failed).
  //
  //    This hop runs on `auth.<rp-apex>` (e.g. auth.mention.earth), so
  //    `config.fedcmIssuer` derives to the RP's host — but `mintSessionForClient`
  //    forces the CENTRAL `https://auth.oxy.so` issuer for the assertion `iss`
  //    internally (the API's `/fedcm/exchange` accepts only the central issuer),
  //    so the per-apex `config` is safe to pass directly. The host-only cookie
  //    planted in step 6 is independent of the assertion issuer.
  const session = await mintSessionForClient(config, user, approvedOrigin);
  if (!session) {
    return redirectToCallback(c, returnTo, buildSsoFragment('error', state));
  }
  const code = await createSsoCode(config, approvedOrigin, session);
  if (!code) {
    return redirectToCallback(c, returnTo, buildSsoFragment('error', state));
  }

  // 8. Success: bounce back to the RP callback with `oxy_sso=ok`, the opaque
  //    `code`, and `state` in the FRAGMENT. The RP redeems the code at
  //    /sso/exchange; subsequent reloads restore via the cookie we just planted.
  return redirectToCallback(c, returnTo, buildSsoFragment('ok', state, code));
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
