/**
 * Cloudflare Pages Function — `GET /api/device-accounts`.
 *
 * The auth.oxy.so IdP's ONE dynamic route (the device-account chooser feed). It
 * runs as a Pages Function (file-based routing: `functions/api/device-accounts`
 * → `/api/device-accounts`), NOT an advanced-mode `_worker.js` — CF Pages was
 * not executing the single-file worker on this project, so it fell through to
 * the static SPA. Everything else (login / signup / authorize / recover /
 * settings) is the pure-static Vite SPA that CF serves directly, with SPA
 * history-fallback for unmatched navigations.
 *
 * The route logic is the shared `deviceAccountsResponse` (`lib/device-accounts`)
 * so it stays framework-free and unit-testable.
 */
import { deviceAccountsResponse, type DeviceAccountsEnv } from '../../lib/device-accounts';

/**
 * Minimal Pages Function context shape — only the fields this handler uses.
 * Avoids a `@cloudflare/workers-types` dependency; the runtime supplies the full
 * `EventContext` and ignores the narrower type.
 */
interface PagesFunctionContext<Env> {
  request: Request;
  env: Env;
}

export const onRequestGet = (ctx: PagesFunctionContext<DeviceAccountsEnv>): Promise<Response> =>
  deviceAccountsResponse(ctx.request, ctx.env);
