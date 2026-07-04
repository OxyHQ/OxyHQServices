/**
 * auth.oxy.so server — third-party OAuth IdP + device-account chooser feed.
 *
 * This Hono app serves ONE dynamic route — the account-chooser feed
 * (`GET /api/device-accounts`) — and returns 404 for everything else so the
 * runtime entrypoints fall back to the Vite-built SPA (login / signup /
 * authorize / recover / settings):
 *
 *   - Production: bundled to `dist/_worker.js` (Cloudflare Pages advanced mode).
 *     `server/worker.ts` runs this app and serves the SPA via `env.ASSETS`.
 *   - Local / tests: `server/node.ts` runs this app on a TCP port and serves
 *     `./dist` statically.
 *
 * The FedCM Identity Provider endpoints, the cross-domain `/sso` bounce +
 * `/auth/silent` restore, and the `fedcm_session` cookie machinery were all
 * removed: the central device session — the `oxy_device` cookie minted by
 * api.oxy.so on a first-party `POST /auth/login` — is the single session
 * authority now. auth.oxy.so is a pure third-party "Sign in with Oxy" OAuth
 * IdP (login + authorize + consent), plus this chooser feed.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';

// ---------------------------------------------------------------------------
// Runtime configuration
// ---------------------------------------------------------------------------

/**
 * The device-first anchor cookie (`Domain=.oxy.so`, so it rides first-party to
 * auth.oxy.so). Read by the account-chooser feed to resolve the device's
 * session set via the API's internal `POST /auth/device/resolve`. Must match the
 * API's `DEVICE_COOKIE_NAME` (`packages/api/src/utils/deviceCookie.ts`).
 */
const DEVICE_COOKIE_NAME = 'oxy_device';

/**
 * Cloudflare Pages Worker bindings (secrets / vars) plus the static-asset
 * fetcher Pages injects in advanced mode. All optional so the same type works
 * when running under Bun/Node where these come from `process.env` instead.
 */
interface WorkerEnv {
  OXY_API_URL?: string;
  // Shared secret presented as the `X-Oxy-Internal` header on the
  // server-to-server `POST /auth/device/resolve` call. MUST equal the API's
  // `SSO_INTERNAL_SECRET` (GitHub secret → SSM `/oxy/oxy-api/SSO_INTERNAL_SECRET`).
  // When unset, the chooser feed fails closed to an empty list.
  SSO_INTERNAL_SECRET?: string;
  NODE_ENV?: string;
  ASSETS?: { fetch: typeof fetch };
}

type AppContext = Context<{ Bindings: WorkerEnv }>;

interface ResolvedConfig {
  apiBaseUrl: string;
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
 * Resolve runtime config from the request context. On Cloudflare Pages secrets
 * arrive per-request via `c.env`; under Bun/Node they come from `process.env`.
 * Resolved per-request (not at module load) because the Workers runtime does
 * not expose bindings at module-evaluation time.
 */
function resolveConfig(c: AppContext): ResolvedConfig {
  const env = c.env;
  return {
    apiBaseUrl: (readEnv(env, 'OXY_API_URL') || 'https://api.oxy.so').replace(/\/+$/, ''),
    ssoInternalSecret: readEnv(env, 'SSO_INTERNAL_SECRET') || '',
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: WorkerEnv }>();

/**
 * GET /api/device-accounts — the account chooser's device-session feed.
 *
 * The IdP is first-party to `oxy.so`, so the browser sends the `Domain=.oxy.so`
 * `oxy_device` cookie on this same-origin request. We forward its RAW value to
 * the API's cookie-less `POST /auth/device/resolve` under the shared
 * `X-Oxy-Internal` secret, which resolves the device's `DeviceSession` into the
 * set of accounts signed in on this device.
 *
 * Fail-closed to an empty list on: no cookie, no configured secret, a non-2xx
 * resolve, or a malformed body. The internal secret travels ONLY in the outbound
 * request header (never in the response), and the cookie value is never logged.
 */
app.get('/api/device-accounts', async (c) => {
  const { apiBaseUrl, ssoInternalSecret } = resolveConfig(c);
  const empty = { activeAccountId: null, accounts: [] as unknown[] };

  const deviceKey = getCookie(c, DEVICE_COOKIE_NAME);
  if (!deviceKey || !ssoInternalSecret) {
    return c.json(empty);
  }

  try {
    const res = await fetch(`${apiBaseUrl}/auth/device/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Accept: 'application/json',
        'X-Oxy-Internal': ssoInternalSecret,
      },
      body: JSON.stringify({ deviceKey }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return c.json(empty);
    const data = (await res.json()) as { activeAccountId?: unknown; accounts?: unknown };
    if (!data || !Array.isArray(data.accounts)) {
      return c.json(empty);
    }
    const activeAccountId = typeof data.activeAccountId === 'string' ? data.activeAccountId : null;
    // Forward the resolved shape as-is (the client strictly validates it against
    // `deviceResolveResponseSchema`). The worker only reads the cookie, injects
    // the internal secret, and fails closed.
    return c.json({ activeAccountId, accounts: data.accounts });
  } catch {
    return c.json(empty);
  }
});

// NOTE: there is deliberately NO catch-all `*` route on `app`. Static-asset
// fallback for the SPA is owned by each runtime entrypoint:
//   - Cloudflare Pages: `server/worker.ts` falls back to `env.ASSETS.fetch()`
//     when the Hono app returns 404 (no dynamic route matched).
//   - Local Bun/Node: `server/node.ts` adds `@hono/node-server` static handlers.
// Keeping `app` free of a catch-all (and free of any Node-only imports) lets the
// endpoint tests assert clean 404s and keeps the Workers bundle free of `node:*`.

// Export the configured Hono app so it can be exercised in tests via
// `app.request(...)` and re-used by the Cloudflare Pages worker entry
// (`server/worker.ts`) and the local Node entry (`server/node.ts`).
export { app, readEnv };
export type { WorkerEnv };
