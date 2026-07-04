/**
 * Post-deploy smoke gate for auth.oxy.so (third-party OAuth IdP + device chooser).
 *
 * Runs AFTER the `oxy-auth` Cloudflare Pages deploy and hits the LIVE host using
 * ONLY public, unauthenticated endpoints (no cookies, no secrets). It asserts the
 * post-FedCM-deletion contract so a broken deploy turns the workflow RED instead
 * of silently breaking sign-in for the whole ecosystem.
 *
 * What it catches:
 *   - SPA renders blank / build totally broken   → `/`, `/login`, `/signup`, `/authorize` lose the SPA root marker.
 *   - `_worker.js` missing (static-only deploy)  → `GET /api/device-accounts` returns SPA HTML instead of worker JSON.
 *   - device chooser feed broken                 → `GET /api/device-accounts` (no cookie) is not `200 {accounts:[]}`.
 *   - FedCM manifest NOT removed                  → `/.well-known/web-identity` still serves the FedCM config JSON.
 *
 * Usage:
 *   bun run packages/auth/scripts/smoke-idp.ts
 *   SMOKE_TARGET=https://auth.oxy.so bun run packages/auth/scripts/smoke-idp.ts
 *
 * Exit code is non-zero if ANY assertion fails. No external dependencies — uses
 * only `fetch` and the standard runtime so it runs identically in CI and locally.
 */

/** Host under test. Configurable so it can target a custom-domain too. */
const PRIMARY_TARGET = (process.env.SMOKE_TARGET || 'https://auth.oxy.so').replace(/\/+$/, '');

const REQUEST_TIMEOUT_MS = 15000;
/** The single DOM marker the Vite SPA mounts into (`packages/auth/index.html`). */
const SPA_ROOT_MARKER = 'id="root"';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

/** Standard-out / standard-error are this CLI gate's intended output channel. */
function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function logError(line: string): void {
  process.stderr.write(`${line}\n`);
}

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

interface FetchOutcome {
  status: number;
  contentType: string;
  body: string;
  error?: string;
}

async function probe(url: string, init?: RequestInit): Promise<FetchOutcome> {
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      body,
    };
  } catch (err) {
    return { status: 0, contentType: '', body: '', error: err instanceof Error ? err.message : String(err) };
  }
}

function isHtmlBody(body: string): boolean {
  return /^\s*<!doctype html/i.test(body) || /^\s*<html[\s>]/i.test(body);
}

/** Parse a JSON body, returning `null` (never throwing) on invalid JSON. */
function parseJson(body: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(body) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A SPA HTML page MUST be 200 and contain the SPA root marker. */
async function checkSpaPage(hostBase: string, path: string): Promise<void> {
  const out = await probe(`${hostBase}${path}`, { headers: { Accept: 'text/html' } });
  if (out.error) {
    record(`SPA ${path}`, false, `request failed: ${out.error}`);
    return;
  }
  if (out.status !== 200) {
    record(`SPA ${path}`, false, `expected 200, got ${out.status}`);
    return;
  }
  if (!out.body.includes(SPA_ROOT_MARKER)) {
    record(`SPA ${path}`, false, `missing SPA root marker (${SPA_ROOT_MARKER}) — build broken?`);
    return;
  }
  record(`SPA ${path}`, true, '200 + root marker present');
}

/**
 * `GET /api/device-accounts` with NO `oxy_device` cookie MUST be answered BY THE
 * WORKER as `200 { activeAccountId: null, accounts: [] }` JSON. A static-only
 * deploy would instead return SPA HTML — so this ALSO proves `_worker.js` is live
 * and intercepting the dynamic route (it is the only dynamic endpoint now).
 */
async function checkDeviceAccounts(hostBase: string): Promise<void> {
  const out = await probe(`${hostBase}/api/device-accounts`, { headers: { Accept: 'application/json' } });
  if (out.error) {
    record('device-accounts feed', false, `request failed: ${out.error}`);
    return;
  }
  if (isHtmlBody(out.body)) {
    record('device-accounts feed', false, 'responded with SPA HTML — static-only deploy (worker NOT live)');
    return;
  }
  if (out.status !== 200) {
    record('device-accounts feed', false, `expected 200, got ${out.status}`);
    return;
  }
  const json = parseJson(out.body);
  if (!json || !Array.isArray(json.accounts)) {
    record('device-accounts feed', false, `expected JSON {accounts:[]}, got "${out.body.slice(0, 80)}"`);
    return;
  }
  if (json.accounts.length !== 0) {
    record('device-accounts feed', false, `expected an empty account list without a cookie, got ${json.accounts.length}`);
    return;
  }
  record('device-accounts feed', true, 'worker answered 200 {accounts:[]} (no cookie)');
}

/**
 * The FedCM manifest MUST be GONE. `GET /.well-known/web-identity` no longer has
 * a handler, so it falls through to the SPA (or 404) — anything EXCEPT a valid
 * `200 application/json` FedCM config with `provider_urls` is a pass. A regression
 * that re-adds the endpoint (200 JSON + provider_urls) fails.
 */
async function checkWebIdentityGone(hostBase: string): Promise<void> {
  const out = await probe(`${hostBase}/.well-known/web-identity`, { headers: { Accept: 'application/json' } });
  if (out.error) {
    record('web-identity removed', false, `request failed: ${out.error}`);
    return;
  }
  const json = out.contentType.includes('application/json') ? parseJson(out.body) : null;
  if (out.status === 200 && json && Array.isArray(json.provider_urls)) {
    record('web-identity removed', false, 'FedCM manifest is STILL served (provider_urls present) — endpoint not deleted');
    return;
  }
  record('web-identity removed', true, `no FedCM manifest (status ${out.status}, ${out.contentType || 'no content-type'})`);
}

async function run(): Promise<void> {
  log(`\nauth.oxy.so smoke gate — target: ${PRIMARY_TARGET}\n`);

  await checkSpaPage(PRIMARY_TARGET, '/login');
  await checkSpaPage(PRIMARY_TARGET, '/signup');
  await checkSpaPage(PRIMARY_TARGET, '/authorize');
  await checkDeviceAccounts(PRIMARY_TARGET);
  await checkWebIdentityGone(PRIMARY_TARGET);

  const failed = results.filter((r) => !r.ok);
  log(`\n${failed.length === 0 ? 'OK' : 'FAILED'}: ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    logError(`\n${failed.length} assertion(s) failed:`);
    for (const f of failed) {
      logError(`  - ${f.name}: ${f.detail}`);
    }
    process.exit(1);
  }
}

run().catch((err) => {
  logError(`auth smoke gate crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
