/**
 * Cloudflare Pages advanced-mode entry (`dist/_worker.js`).
 *
 * Pages "advanced mode" lets a single `_worker.js` at the build-output root
 * intercept every request before static-asset serving. We run the Hono FedCM
 * IdP app (`server/index.ts`) for the `/fedcm/*` + `/.well-known/web-identity`
 * routes, and fall back to the static asset store (`env.ASSETS`) — which also
 * performs SPA history-fallback to `index.html` — for everything else.
 *
 * Build: `bun build server/worker.ts --outfile dist/_worker.js
 *         --target browser --format esm` (see package.json `build:worker`).
 *
 * Secrets (FEDCM_TOKEN_SECRET, OXY_API_URL, FEDCM_ISSUER, NODE_ENV) are read
 * from the Pages project's environment/secret bindings via `env`, which Hono
 * exposes to handlers as `c.env`.
 *
 * @see https://developers.cloudflare.com/pages/functions/advanced-mode/
 */

import type { ExecutionContext } from 'hono';
import { app, type WorkerEnv } from './index';

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    // Hand the request to the FedCM IdP app. Hono returns a 404 when no route
    // matches (any non-FedCM path) — that's the signal to serve the SPA.
    const response = await app.fetch(request, env, ctx);

    if (response.status === 404 && env.ASSETS) {
      // Serve the static SPA. The Pages ASSETS binding handles MIME types and
      // SPA history fallback (unmatched paths -> index.html) automatically.
      return env.ASSETS.fetch(request);
    }

    return response;
  },
};
