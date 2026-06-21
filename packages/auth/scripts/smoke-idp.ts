/**
 * Post-deploy smoke gate for the auth.oxy.so FedCM Identity Provider.
 *
 * Runs AFTER the `oxy-auth` Cloudflare Pages deploy and hits the LIVE host(s)
 * using ONLY public, unauthenticated endpoints (no cookies, no secrets). It
 * asserts the critical IdP contract so a broken deploy turns the workflow RED
 * immediately instead of silently taking SSO down for the whole ecosystem.
 *
 * What it catches (each maps to a real past incident):
 *   - SPA renders blank / build totally broken           → `/`, `/login`, `/signup` lose the SPA root marker.
 *   - `_worker.js` missing (static-only deploy)           → `/fedcm/assertion` POST returns SPA HTML / 405 instead of worker JSON.
 *   - `/.well-known/web-identity` mis-typed / mis-shaped   → not 200 JSON, or `provider_urls` missing.
 *   - `/fedcm.json` served as SPA HTML                     → body is `<!doctype html>` instead of FedCM config JSON.
 *   - `/sso` error page crashes (500) after redesign       → not the branded error HTML.
 *   - `FEDCM_ISSUER` pinned across hosts (multi-domain)    → a per-apex host reports a foreign `provider_urls` issuer.
 *
 * Usage:
 *   bun run packages/auth/scripts/smoke-idp.ts
 *   SMOKE_TARGET=https://auth.oxy.so bun run packages/auth/scripts/smoke-idp.ts
 *   SMOKE_SECONDARY_HOSTS=auth.mention.earth,auth.syra.fm bun run packages/auth/scripts/smoke-idp.ts
 *   SMOKE_SKIP_SECONDARY=1 bun run packages/auth/scripts/smoke-idp.ts   # primary host only
 *
 * Exit code is non-zero if ANY assertion fails.
 *
 * No external dependencies — uses only `fetch` and the standard runtime so it
 * runs identically in CI and locally.
 */

/** Primary host under test. Configurable so it can target a custom-domain too. */
const PRIMARY_TARGET = (process.env.SMOKE_TARGET || 'https://auth.oxy.so').replace(/\/+$/, '');

/**
 * Per-apex IdP hosts that CNAME to the same `oxy-auth` worker. Each MUST report
 * its OWN issuer in `provider_urls` (the multi-domain FAPI contract). This is an
 * operational/DNS fact, not a source constant, so it is overridable via env and
 * carries the currently-live default set (verified against production). Set
 * `SMOKE_SKIP_SECONDARY=1` to check only the primary target (e.g. when smoking a
 * one-off custom host).
 */
const DEFAULT_SECONDARY_HOSTS = [
  'auth.mention.earth',
  'auth.alia.onl',
  'auth.homiio.com',
  'auth.syra.fm',
];
const SECONDARY_HOSTS = process.env.SMOKE_SKIP_SECONDARY
  ? []
  : (process.env.SMOKE_SECONDARY_HOSTS
      ? process.env.SMOKE_SECONDARY_HOSTS.split(',')
      : DEFAULT_SECONDARY_HOSTS
    )
      .map((h) => h.trim())
      .filter((h) => h.length > 0);

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

async function probe(
  url: string,
  init?: RequestInit
): Promise<FetchOutcome> {
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
    return {
      status: 0,
      contentType: '',
      body: '',
      error: err instanceof Error ? err.message : String(err),
    };
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

/**
 * `GET /.well-known/web-identity` MUST be 200, JSON, and carry a non-empty
 * `provider_urls`. When `expectedIssuerOrigin` is provided, every entry MUST be
 * absolute to that origin — this is the multi-domain FAPI guard (a pinned
 * `FEDCM_ISSUER` would make a per-apex host report the central issuer instead).
 */
async function checkWebIdentity(
  hostBase: string,
  expectedIssuerOrigin?: string
): Promise<void> {
  const url = `${hostBase}/.well-known/web-identity`;
  const out = await probe(url, { headers: { Accept: 'application/json' } });
  if (out.error) {
    record(`web-identity @ ${hostBase}`, false, `request failed: ${out.error}`);
    return;
  }
  if (out.status !== 200) {
    record(`web-identity @ ${hostBase}`, false, `expected 200, got ${out.status}`);
    return;
  }
  if (!out.contentType.includes('application/json')) {
    record(`web-identity @ ${hostBase}`, false, `expected JSON content-type, got "${out.contentType}"`);
    return;
  }
  if (isHtmlBody(out.body)) {
    record(`web-identity @ ${hostBase}`, false, 'body is SPA HTML, not JSON (static-only deploy?)');
    return;
  }
  const json = parseJson(out.body);
  const providerUrls = json?.provider_urls;
  if (!Array.isArray(providerUrls) || providerUrls.length === 0) {
    record(`web-identity @ ${hostBase}`, false, 'missing or empty provider_urls');
    return;
  }
  const allStrings = providerUrls.every((u) => typeof u === 'string' && u.length > 0);
  if (!allStrings) {
    record(`web-identity @ ${hostBase}`, false, 'provider_urls contains a non-string entry');
    return;
  }
  if (expectedIssuerOrigin) {
    const offenders = (providerUrls as string[]).filter((u) => !u.startsWith(`${expectedIssuerOrigin}/`));
    if (offenders.length > 0) {
      record(
        `web-identity @ ${hostBase}`,
        false,
        `per-apex issuer mismatch: expected origin ${expectedIssuerOrigin}, got ${JSON.stringify(offenders)} (FEDCM_ISSUER pinned?)`
      );
      return;
    }
  }
  record(`web-identity @ ${hostBase}`, true, `provider_urls=${JSON.stringify(providerUrls)}`);
}

/**
 * The FedCM config URL referenced by `web-identity` MUST be 200 JSON with the
 * required endpoint fields — NOT SPA HTML. This is the canonical "static-only
 * deploy serves the SPA" detector for the GET surface.
 */
async function checkFedcmConfig(hostBase: string): Promise<void> {
  const wk = await probe(`${hostBase}/.well-known/web-identity`, { headers: { Accept: 'application/json' } });
  const wkJson = parseJson(wk.body);
  const providerUrls = wkJson?.provider_urls;
  const configUrl =
    Array.isArray(providerUrls) && typeof providerUrls[0] === 'string'
      ? (providerUrls[0] as string)
      : `${hostBase}/fedcm.json`;

  const out = await probe(configUrl, { headers: { Accept: 'application/json' } });
  if (out.error) {
    record(`fedcm config @ ${hostBase}`, false, `request failed: ${out.error}`);
    return;
  }
  if (out.status !== 200) {
    record(`fedcm config @ ${hostBase}`, false, `expected 200 at ${configUrl}, got ${out.status}`);
    return;
  }
  if (isHtmlBody(out.body)) {
    record(`fedcm config @ ${hostBase}`, false, `serves SPA HTML, NOT JSON (static-only deploy — worker missing) [${configUrl}]`);
    return;
  }
  if (!out.contentType.includes('application/json')) {
    record(`fedcm config @ ${hostBase}`, false, `expected JSON content-type, got "${out.contentType}"`);
    return;
  }
  const json = parseJson(out.body);
  const required = ['accounts_endpoint', 'id_assertion_endpoint', 'disconnect_endpoint', 'login_url'];
  const missing = required.filter((k) => typeof json?.[k] !== 'string');
  if (missing.length > 0) {
    record(`fedcm config @ ${hostBase}`, false, `missing required fields: ${missing.join(', ')}`);
    return;
  }
  record(`fedcm config @ ${hostBase}`, true, `endpoints present at ${configUrl}`);
}

/** A SPA HTML page MUST be 200 and contain the SPA root marker. */
async function checkSpaPage(hostBase: string, path: string): Promise<void> {
  const url = `${hostBase}${path}`;
  const out = await probe(url, { headers: { Accept: 'text/html' } });
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
 * `GET /sso` with no params MUST render the branded error page (4xx HTML with
 * the rendered template), NOT a 500 crash and NOT a blank/SPA page. This is the
 * just-redesigned error page — assert it still renders.
 */
async function checkSsoErrorPage(hostBase: string): Promise<void> {
  const out = await probe(`${hostBase}/sso`, { headers: { Accept: 'text/html' } });
  if (out.error) {
    record('sso error page', false, `request failed: ${out.error}`);
    return;
  }
  if (out.status >= 500) {
    record('sso error page', false, `server crash: got ${out.status} (expected a rendered 4xx)`);
    return;
  }
  if (!out.contentType.includes('text/html')) {
    record('sso error page', false, `expected text/html, got "${out.contentType}"`);
    return;
  }
  // The branded error template carries this fixed, non-sensitive title.
  if (!out.body.includes('Sign-in error')) {
    record('sso error page', false, 'branded error page not rendered (missing "Sign-in error")');
    return;
  }
  record('sso error page', true, `branded error rendered (HTTP ${out.status})`);
}

/**
 * `POST /fedcm/assertion` with a garbage body and NO `Sec-Fetch-Dest:
 * webidentity` MUST be answered BY THE WORKER as `400 {"error":...}` JSON. A
 * static-only deploy would instead 405 or return SPA HTML — this directly
 * proves `_worker.js` is live and intercepting `/fedcm/*` POSTs.
 */
async function checkWorkerAssertion(hostBase: string): Promise<void> {
  const out = await probe(`${hostBase}/fedcm/assertion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (out.error) {
    record('worker /fedcm/assertion', false, `request failed: ${out.error}`);
    return;
  }
  if (out.status === 405) {
    record('worker /fedcm/assertion', false, '405 Method Not Allowed — static-only deploy (worker NOT live)');
    return;
  }
  if (isHtmlBody(out.body)) {
    record('worker /fedcm/assertion', false, 'responded with SPA HTML — static-only deploy (worker NOT live)');
    return;
  }
  if (out.status < 400 || out.status >= 500) {
    record('worker /fedcm/assertion', false, `expected a worker 4xx, got ${out.status}`);
    return;
  }
  const json = parseJson(out.body);
  if (!json || typeof json.error !== 'string') {
    record('worker /fedcm/assertion', false, `expected JSON {error}, got "${out.body.slice(0, 80)}"`);
    return;
  }
  record('worker /fedcm/assertion', true, `worker answered ${out.status} {"error":"${json.error}"}`);
}

async function run(): Promise<void> {
  log(`\nIdP smoke gate — primary target: ${PRIMARY_TARGET}`);
  if (SECONDARY_HOSTS.length > 0) {
    log(`Secondary per-apex hosts: ${SECONDARY_HOSTS.join(', ')}\n`);
  } else {
    log('Secondary per-apex hosts: (skipped)\n');
  }

  log(`Primary host (${PRIMARY_TARGET}):`);
  await checkWebIdentity(PRIMARY_TARGET);
  await checkFedcmConfig(PRIMARY_TARGET);
  await checkSpaPage(PRIMARY_TARGET, '/');
  await checkSpaPage(PRIMARY_TARGET, '/login');
  await checkSpaPage(PRIMARY_TARGET, '/signup');
  await checkSsoErrorPage(PRIMARY_TARGET);
  await checkWorkerAssertion(PRIMARY_TARGET);

  for (const host of SECONDARY_HOSTS) {
    const base = `https://${host}`;
    const expectedOrigin = base;
    log(`\nPer-apex host (${host}) — multi-domain FAPI issuer contract:`);
    await checkWebIdentity(base, expectedOrigin);
  }

  const failed = results.filter((r) => !r.ok);
  log(
    `\n${failed.length === 0 ? 'OK' : 'FAILED'}: ${results.length - failed.length}/${results.length} checks passed.`
  );
  if (failed.length > 0) {
    logError(`\n${failed.length} assertion(s) failed:`);
    for (const f of failed) {
      logError(`  - ${f.name}: ${f.detail}`);
    }
    process.exit(1);
  }
}

run().catch((err) => {
  logError(`IdP smoke gate crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
