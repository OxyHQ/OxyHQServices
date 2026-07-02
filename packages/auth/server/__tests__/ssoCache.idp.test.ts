/**
 * IdP worker (auth.oxy.so) approved-clients + grants caching.
 *
 * The worker fetches `${apiBaseUrl}/fedcm/clients/approved` on EVERY /sso,
 * /sso/establish, /auth/silent and /fedcm request, and per-user grants
 * (`/fedcm/grants/:userId`) on the accounts + silent-consent paths. From shared
 * Cloudflare egress IPs this hammered the API into 429s → the fails-closed
 * `invalid_request` bounce loop we saw live. These tests pin the caching that
 * fixes it, driving the exported cache functions directly with a counting fetch
 * stub and a controllable system clock.
 *
 * Two DISTINCT policies are asserted:
 *   - approved-clients (public allow-list): 60s fresh TTL, single-flight
 *     de-dup, and BOUNDED-STALE serving (up to 10min) on failure — bounded
 *     staleness beats a fails-closed collapse. Past the cap it fails closed.
 *   - grants (per-user consent): 30s fresh TTL, single-flight de-dup, but NO
 *     stale-on-failure — a stale grant must never gate consent, so a failed
 *     lookup falls through to the fail-closed empty list.
 *
 * Run with `bun test`. The upstream API is stubbed via a global `fetch` mock;
 * `setSystemTime` advances the clock to cross TTL / stale-cap boundaries without
 * real waits.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, setSystemTime } from 'bun:test';

const RP_ORIGIN = 'https://accounts.oxy.so';
const OTHER_ORIGIN = 'https://console.oxy.so';
const API_BASE = 'https://api.oxy.so';
const USER_A = '507f1f77bcf86cd799439011';
const USER_B = '507f1f77bcf86cd799439012';

// The cache functions read `ssoInternalSecret` off the config for grants; the
// other fields are unused by these two functions but keep the shape honest.
const CONFIG = {
  apiBaseUrl: API_BASE,
  fedcmIssuer: 'https://auth.oxy.so',
  fedcmTokenSecret: 'test-fedcm-secret',
  ssoInternalSecret: 'test-sso-internal-secret-32-chars-long!!',
};

// Configure env BEFORE importing the server module (it reads env at load).
process.env.FEDCM_TOKEN_SECRET = CONFIG.fedcmTokenSecret;
process.env.FEDCM_ISSUER = CONFIG.fedcmIssuer;
process.env.OXY_API_URL = API_BASE;
process.env.SSO_INTERNAL_SECRET = CONFIG.ssoInternalSecret;
process.env.NODE_ENV = 'test';

// A fixed epoch base; individual tests advance the clock relative to it.
const BASE = 1_700_000_000_000;

const realFetch = globalThis.fetch;

// ---- Stub state (reset in beforeEach) --------------------------------------
type StubMode = 'ok' | 'fail' | 'empty';
let approvedFetchCount = 0;
let approvedMode: StubMode = 'ok';
let approvedList: string[] = [RP_ORIGIN];
let grantsFetchCount = 0;
let grantsMode: StubMode = 'ok';
let grantsList: string[] = [RP_ORIGIN];

// When armed, the approved-clients handler blocks on this gate before
// responding — lets a test fire concurrent callers while a single fetch is
// still in flight, to prove single-flight de-dup.
let approvedGate: Promise<void> | null = null;
let openApprovedGate: (() => void) | null = null;
function armApprovedGate(): void {
  approvedGate = new Promise<void>((resolve) => {
    openApprovedGate = () => resolve();
  });
}

function installStub(): void {
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/fedcm/clients/approved')) {
      approvedFetchCount += 1;
      if (approvedGate) await approvedGate;
      if (approvedMode === 'fail') {
        return new Response('err', { status: 500 });
      }
      const clients = approvedMode === 'empty' ? [] : approvedList;
      return new Response(JSON.stringify({ success: true, clients }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('/fedcm/grants/')) {
      grantsFetchCount += 1;
      if (grantsMode === 'fail') {
        return new Response('err', { status: 500 });
      }
      const origins = grantsMode === 'empty' ? [] : grantsList;
      return new Response(JSON.stringify({ origins }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

let resolveApprovedClientOrigin: (
  apiBaseUrl: string,
  clientId: string | undefined
) => Promise<string | null>;
let fetchApprovedClients: (
  config: typeof CONFIG,
  userId: string,
  forceRefresh?: boolean
) => Promise<string[]>;
let resetSsoCaches: () => void = () => {};

beforeAll(async () => {
  installStub();
  const mod = await import('../index');
  resolveApprovedClientOrigin = mod.resolveApprovedClientOrigin;
  fetchApprovedClients = mod.fetchApprovedClients;
  resetSsoCaches = mod.__resetSsoCachesForTests;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  setSystemTime();
});

beforeEach(() => {
  resetSsoCaches();
  approvedFetchCount = 0;
  approvedMode = 'ok';
  approvedList = [RP_ORIGIN];
  grantsFetchCount = 0;
  grantsMode = 'ok';
  grantsList = [RP_ORIGIN];
  approvedGate = null;
  openApprovedGate = null;
  setSystemTime(new Date(BASE));
  installStub();
});

afterEach(() => {
  setSystemTime();
});

describe('approved-clients cache (60s TTL, bounded-stale)', () => {
  it('serves the second call within TTL from cache without re-fetching', async () => {
    const first = await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN);
    expect(first).toBe(RP_ORIGIN);
    expect(approvedFetchCount).toBe(1);

    // Advance just under the 60s TTL — still fresh.
    setSystemTime(new Date(BASE + 59_000));
    const second = await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN);
    expect(second).toBe(RP_ORIGIN);
    expect(approvedFetchCount).toBe(1); // no second network round-trip

    // A different-but-approved client resolves off the SAME cached list.
    approvedList = [RP_ORIGIN, OTHER_ORIGIN]; // would only matter on a re-fetch
    const other = await resolveApprovedClientOrigin(API_BASE, OTHER_ORIGIN);
    expect(other).toBeNull(); // not in the cached list; still no re-fetch
    expect(approvedFetchCount).toBe(1);
  });

  it('re-fetches once the TTL has elapsed', async () => {
    await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN);
    expect(approvedFetchCount).toBe(1);

    setSystemTime(new Date(BASE + 61_000)); // past the 60s TTL
    await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN);
    expect(approvedFetchCount).toBe(2);
  });

  it('serves the stale list when a refresh fails within the stale cap', async () => {
    // Prime the cache with a good list.
    expect(await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN)).toBe(RP_ORIGIN);
    expect(approvedFetchCount).toBe(1);

    // TTL elapsed AND the refresh now fails — but we are still inside the 10min
    // stale cap, so the prior good list must be served (bounded staleness).
    approvedMode = 'fail';
    setSystemTime(new Date(BASE + 5 * 60_000)); // 5min: past TTL, within 10min cap
    const stale = await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN);
    expect(stale).toBe(RP_ORIGIN);
    expect(approvedFetchCount).toBe(2); // it DID attempt a refresh (which failed)
  });

  it('fails closed once the stale cap is exceeded', async () => {
    expect(await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN)).toBe(RP_ORIGIN);

    approvedMode = 'fail';
    setSystemTime(new Date(BASE + 11 * 60_000)); // 11min: beyond the 10min stale cap
    const result = await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN);
    expect(result).toBeNull();
  });

  it('fails closed on the very first fetch failure (no prior cache to serve)', async () => {
    approvedMode = 'fail';
    const result = await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN);
    expect(result).toBeNull();
    expect(approvedFetchCount).toBe(1);
  });

  it('never caches an empty list as truth (empty is non-authoritative)', async () => {
    // A 200 with an empty `clients` array is treated as non-authoritative — it
    // is NOT stored, so the next call re-fetches rather than honouring "nothing
    // approved" for 60s.
    approvedMode = 'empty';
    expect(await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN)).toBeNull();
    expect(approvedFetchCount).toBe(1);

    approvedMode = 'ok';
    const recovered = await resolveApprovedClientOrigin(API_BASE, RP_ORIGIN);
    expect(recovered).toBe(RP_ORIGIN);
    expect(approvedFetchCount).toBe(2); // re-fetched because empty was not cached
  });

  it('shares a single in-flight fetch across concurrent callers', async () => {
    armApprovedGate();

    // Fire two resolutions before the first fetch resolves.
    const p1 = resolveApprovedClientOrigin(API_BASE, RP_ORIGIN);
    const p2 = resolveApprovedClientOrigin(API_BASE, RP_ORIGIN);

    // Let the single in-flight fetch complete, then await both.
    openApprovedGate?.();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(RP_ORIGIN);
    expect(r2).toBe(RP_ORIGIN);
    expect(approvedFetchCount).toBe(1); // de-duped onto ONE network round-trip
  });
});

describe('grants cache (30s TTL, NO stale-on-failure)', () => {
  it('serves the second lookup within TTL from cache without re-fetching', async () => {
    const first = await fetchApprovedClients(CONFIG, USER_A);
    expect(first).toEqual([RP_ORIGIN]);
    expect(grantsFetchCount).toBe(1);

    setSystemTime(new Date(BASE + 29_000)); // within 30s TTL
    const second = await fetchApprovedClients(CONFIG, USER_A);
    expect(second).toEqual([RP_ORIGIN]);
    expect(grantsFetchCount).toBe(1);
  });

  it('re-fetches once the 30s TTL has elapsed', async () => {
    await fetchApprovedClients(CONFIG, USER_A);
    expect(grantsFetchCount).toBe(1);

    setSystemTime(new Date(BASE + 31_000)); // past the 30s TTL
    await fetchApprovedClients(CONFIG, USER_A);
    expect(grantsFetchCount).toBe(2);
  });

  it('caches independently per userId', async () => {
    await fetchApprovedClients(CONFIG, USER_A);
    await fetchApprovedClients(CONFIG, USER_B);
    expect(grantsFetchCount).toBe(2); // distinct users → distinct fetches

    // Each is now cached on its own key.
    await fetchApprovedClients(CONFIG, USER_A);
    await fetchApprovedClients(CONFIG, USER_B);
    expect(grantsFetchCount).toBe(2);
  });

  it('caches a legitimately-empty grant list (a real "no grants yet" state)', async () => {
    grantsMode = 'empty';
    expect(await fetchApprovedClients(CONFIG, USER_A)).toEqual([]);
    expect(grantsFetchCount).toBe(1);

    // Empty success IS authoritative for grants → cached, no re-fetch.
    expect(await fetchApprovedClients(CONFIG, USER_A)).toEqual([]);
    expect(grantsFetchCount).toBe(1);
  });

  it('fails closed on error and NEVER serves a stale grant list', async () => {
    // Prime a good grant list.
    expect(await fetchApprovedClients(CONFIG, USER_A)).toEqual([RP_ORIGIN]);
    expect(grantsFetchCount).toBe(1);

    // TTL elapsed AND the refresh fails: grants gate consent, so this must fail
    // closed (empty list) — NOT serve the prior [RP_ORIGIN].
    grantsMode = 'fail';
    setSystemTime(new Date(BASE + 31_000));
    const afterFailure = await fetchApprovedClients(CONFIG, USER_A);
    expect(afterFailure).toEqual([]);
    expect(grantsFetchCount).toBe(2); // it attempted a refresh

    // The failure was not cached either — a subsequent success repopulates.
    grantsMode = 'ok';
    const recovered = await fetchApprovedClients(CONFIG, USER_A);
    expect(recovered).toEqual([RP_ORIGIN]);
  });

  it('does not attempt a fetch when no internal secret is configured', async () => {
    const noSecret = { ...CONFIG, ssoInternalSecret: '' };
    const result = await fetchApprovedClients(noSecret, USER_A);
    expect(result).toEqual([]);
    expect(grantsFetchCount).toBe(0); // fails closed before any network call
  });

  it('shares a single in-flight lookup across concurrent callers for the same user', async () => {
    // No gate needed: fire both before awaiting so they enqueue on one promise.
    const p1 = fetchApprovedClients(CONFIG, USER_A);
    const p2 = fetchApprovedClients(CONFIG, USER_A);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual([RP_ORIGIN]);
    expect(r2).toEqual([RP_ORIGIN]);
    expect(grantsFetchCount).toBe(1);
  });

  it('forceRefresh bypasses a fresh cache (the /sso/establish between-hops re-check)', async () => {
    // Prime the cache as the central /sso hop would, while the grant exists.
    grantsList = [RP_ORIGIN, OTHER_ORIGIN];
    expect(await fetchApprovedClients(CONFIG, USER_A)).toEqual([RP_ORIGIN, OTHER_ORIGIN]);
    expect(grantsFetchCount).toBe(1);

    // Grant revoked between hops. A cached read (within TTL) would still show it,
    // but forceRefresh must read the LIVE, now-revoked list.
    grantsList = [RP_ORIGIN];
    const cachedRead = await fetchApprovedClients(CONFIG, USER_A);
    expect(cachedRead).toEqual([RP_ORIGIN, OTHER_ORIGIN]); // stale cache still holds the grant
    expect(grantsFetchCount).toBe(1);

    const liveRead = await fetchApprovedClients(CONFIG, USER_A, true);
    expect(liveRead).toEqual([RP_ORIGIN]); // revocation observed
    expect(grantsFetchCount).toBe(2);
  });
});
