/**
 * Local (Bun/Node) entrypoint for the FedCM IdP server.
 *
 * Runs the Hono FedCM app (`server/index.ts`) on a real TCP port via
 * `@hono/node-server`, serving the Vite-built SPA from `./dist` with an
 * `index.html` history fallback. Used for local development and the standalone
 * Node deployment path (`bun run start`).
 *
 * Production on Cloudflare Pages does NOT use this file — it uses
 * `server/worker.ts` (advanced-mode `_worker.js`). The Node-only imports below
 * (`@hono/node-server`) are intentionally isolated here so they are NEVER
 * pulled into the Workers bundle (which cannot import `node:http2` etc.).
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app, readEnv, type WorkerEnv } from './index';

/**
 * Scoped startup logger. Writes one informational line per call to stdout
 * with a stable `[FedCM Server]` prefix — these are user-facing CLI banners,
 * not debug `console.log` calls. Kept as a dedicated function so the
 * boundary between "diagnostic startup output" and "ad-hoc debugging" is
 * explicit and greppable.
 */
function logStartup(message: string): void {
  process.stdout.write(`[FedCM Server] ${message}\n`);
}

function startServer(): void {
  const secret = readEnv(undefined, 'FEDCM_TOKEN_SECRET');
  const isProd = readEnv(undefined, 'NODE_ENV') === 'production';

  if (!secret && isProd) {
    process.stderr.write('[FedCM Server] FATAL: FEDCM_TOKEN_SECRET environment variable is required in production\n');
    process.exit(1);
  }
  if (!secret) {
    process.stderr.write('[FedCM Server] WARNING: FEDCM_TOKEN_SECRET is not set. The /fedcm/assertion endpoint will not work.\n');
  }

  const port = parseInt(process.env.PORT || '3002', 10);

  // Mount the FedCM routes first, then static-asset serving with SPA fallback.
  // `app` has no catch-all, so these static handlers receive every non-FedCM
  // request.
  const nodeApp = new Hono<{ Bindings: WorkerEnv }>();
  nodeApp.route('/', app);
  nodeApp.use('/*', serveStatic({ root: './dist' }));
  nodeApp.get('*', serveStatic({ path: './dist/index.html' }));

  logStartup(`Starting on port ${port}`);
  logStartup(`API: ${readEnv(undefined, 'OXY_API_URL') || 'https://api.oxy.so'}`);
  logStartup(`Issuer: ${readEnv(undefined, 'FEDCM_ISSUER') || 'https://auth.oxy.so'}`);

  serve({ fetch: nodeApp.fetch, port }, (info) => {
    logStartup(`Listening on http://localhost:${info.port}`);
  });
}

startServer();
