/**
 * Pre-deploy assertion: the BUILT `dist/_worker.js` actually EXECUTES and serves
 * the `/api/device-accounts` feed as JSON.
 *
 * `test -f dist/_worker.js` only proves the file exists — it does NOT prove the
 * advanced-mode Pages Function runs and routes correctly (the class of regression
 * behind the "worker present but serves SPA HTML" incident). This imports the
 * built worker module and invokes its `fetch` with a stub `env` (empty internal
 * secret → the feed fails closed to `{accounts:[]}` without any network call) and
 * a stub `ASSETS` binding that returns SPA HTML — so a JSON response proves the
 * app route matched (not the ASSETS/SPA fallback).
 *
 * Exit non-zero (failing the deploy) if the built worker does not answer
 * `/api/device-accounts` with `200 application/json` containing `accounts`.
 */
import worker from '../dist/_worker.js';

const env = {
  OXY_API_URL: 'https://api.oxy.so',
  SSO_INTERNAL_SECRET: '',
  ASSETS: {
    fetch: async () =>
      new Response('<!doctype html><html><body>SPA</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

const res = await worker.fetch(new Request('https://auth.oxy.so/api/device-accounts'), env, ctx);
const contentType = res.headers.get('content-type') || '';
const body = await res.text();

if (res.status !== 200 || !contentType.includes('application/json') || !body.includes('"accounts"')) {
  process.stderr.write(
    `::error::built _worker.js did NOT serve /api/device-accounts as JSON ` +
      `(got ${res.status} "${contentType}" body="${body.slice(0, 80)}") — the Pages Function would not run in prod\n`,
  );
  process.exit(1);
}

process.stdout.write(`OK: built _worker.js serves /api/device-accounts as JSON (${body})\n`);
