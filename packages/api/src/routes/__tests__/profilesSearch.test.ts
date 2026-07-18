/**
 * GET /profiles/search archived-exclusion coverage.
 *
 * Proves the people-search surface never returns archived accounts (dead
 * federated actors marked gone via POST /federation/actor-gone, or archived
 * org/project accounts):
 *
 *   1. the DB aggregation's `$match` carries `accountStatus: { $ne: 'archived' }`
 *      and an archived pool row is filtered while an active one surfaces, and
 *   2. the federated-resolution prepend never re-introduces an archived actor,
 *      while a live federated actor is still prepended.
 *
 * The router is mounted on a minimal Express app and exercised via `node:http`
 * round-trips (mirrors profilesSimilar.test.ts). The mocked `User.aggregate`
 * faithfully evaluates the route's `$match` against an in-memory pool so the
 * assertions verify the route's own filter rather than a stub's behaviour.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// The global mongoose mock (jest.setup.cjs) does not expose `Types`, which the
// profiles route relies on. Restore the REAL mongoose.
jest.mock('mongoose', () => jest.requireActual('mongoose'));
import { Types } from 'mongoose';
import { INFLUENCE_MIN } from '../../utils/reputation.constants';

const mockUserAggregate = jest.fn();
const mockUserFindOne = jest.fn();
const mockFollowAggregate = jest.fn();
const mockResolveAndUpsert = jest.fn();
const mockIsFediverseHandle = jest.fn();
const mockGetUserStats = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/optionalAuth', () => ({
  optionalUserOrServiceAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  resolveViewerId: (): string | undefined => undefined,
}));
jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../services/user.service', () => ({
  userService: {
    getUserStats: (...args: unknown[]) => mockGetUserStats(...args),
    // Minimal serializer: the route only asserts identity passes through.
    formatUserResponse: (profile: { _id: Types.ObjectId; username?: string }) => ({
      id: profile._id.toString(),
      username: profile.username,
    }),
  },
}));
jest.mock('../../services/federation.service', () => ({
  federationService: { resolveAndUpsert: (...args: unknown[]) => mockResolveAndUpsert(...args) },
  isFediverseHandle: (...args: unknown[]) => mockIsFediverseHandle(...args),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../models/Follow', () => ({
  __esModule: true,
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
  default: {
    aggregate: (...args: unknown[]) => mockFollowAggregate(...args),
  },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    aggregate: (...args: unknown[]) => mockUserAggregate(...args),
    findOne: (...args: unknown[]) => mockUserFindOne(...args),
  },
}));

import profilesRouter from '../profiles';
import { errorHandler } from '../../middleware/errorHandler';

interface PoolUser {
  _id: Types.ObjectId;
  username?: string;
  name?: { first?: string; last?: string };
  description?: string;
  accountStatus?: string;
  reputationTier?: string;
  type?: string;
  reputationRankWeight?: number;
}

interface ProfileResult {
  id: unknown;
  username?: string;
}

interface JsonResponse<T = ProfileResult[]> {
  status: number;
  body: { error?: string; message?: string; data?: T };
}

function requestJson<T = ProfileResult[]>(server: http.Server, path: string): Promise<JsonResponse<T>> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'GET', host: '127.0.0.1', port: address.port, path },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = raw.length > 0 ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Faithfully evaluate the route's search `$match` (an `accountStatus` $ne gate,
 * a `reputationTier` $ne gate, plus a `$or` of field regexes) against a
 * candidate pool, mirroring MongoDB's semantics for the exact operators the
 * filter uses — crucially, `{ $ne: X }` MATCHES a document whose field is
 * ABSENT (Mongo treats a missing field as not-equal), so an untiered user with
 * no `reputationTier` still surfaces.
 */
function matchesSearchFilter(user: PoolUser, filter: Record<string, unknown>): boolean {
  const acct = filter.accountStatus as { $ne?: string } | undefined;
  if (acct && typeof acct.$ne === 'string' && user.accountStatus === acct.$ne) {
    return false;
  }
  const tier = filter.reputationTier as { $ne?: string } | undefined;
  if (tier && typeof tier.$ne === 'string' && user.reputationTier === tier.$ne) {
    return false;
  }
  const or = filter.$or as Array<Record<string, RegExp>> | undefined;
  if (!Array.isArray(or)) return true;
  return or.some((clause) => {
    const [field, regex] = Object.entries(clause)[0];
    const value =
      field === 'name.first' ? user.name?.first
        : field === 'name.last' ? user.name?.last
          : field === 'description' ? user.description
            : user.username;
    return typeof value === 'string' && regex instanceof RegExp && regex.test(value);
  });
}

/** Drive the mocked `User.aggregate`: evaluate the `$match` against the pool. */
function aggregateSearch(pool: PoolUser[]): (pipeline: unknown) => Promise<unknown[]> {
  return (pipeline: unknown) => {
    const stages = pipeline as Array<{ $match?: Record<string, unknown> }>;
    const matchStage = stages[0]?.$match ?? {};
    const matched = pool.filter((u) => matchesSearchFilter(u, matchStage));
    return Promise.resolve([
      { profiles: matched, totalCount: [{ count: matched.length }] },
    ]);
  };
}

/**
 * The comparable value for a `$sort` key, mirroring the route's `$addFields`:
 *   `_nativePriority` — 1 for federated, 0 otherwise (native-first);
 *   `_reputationRank` — `reputationRankWeight ?? INFLUENCE_MIN`;
 *   `_id`            — the ObjectId hex (unique final tiebreaker).
 */
function sortKeyValue(user: PoolUser, key: string): number | string {
  if (key === '_nativePriority') return user.type === 'federated' ? 1 : 0;
  if (key === '_reputationRank') {
    return typeof user.reputationRankWeight === 'number' ? user.reputationRankWeight : INFLUENCE_MIN;
  }
  if (key === '_id') return user._id.toString();
  return 0;
}

/**
 * Faithful `User.aggregate` for the people-search `$facet`: filters the pool by
 * the stage-0 `$match`, then applies the `profiles` sub-pipeline's `$sort`,
 * `$skip` and `$limit` in order — so the assertions exercise the route's REAL
 * sort spec + paging math, not a stub. `totalCount` reflects the FULL match set
 * (before paging), exactly as the route's `$facet` computes it.
 */
function aggregateSearchPaged(pool: PoolUser[]): (pipeline: unknown) => Promise<unknown[]> {
  return (pipeline: unknown) => {
    const stages = pipeline as Array<{
      $match?: Record<string, unknown>;
      $facet?: { profiles?: Array<Record<string, unknown>> };
    }>;
    const matchStage = stages[0]?.$match ?? {};
    const matched = pool.filter((u) => matchesSearchFilter(u, matchStage));

    const profilesPipeline = stages.find((s) => s.$facet)?.$facet?.profiles ?? [];
    const sortSpec = profilesPipeline.find((s) => '$sort' in s)?.$sort as
      | Record<string, 1 | -1>
      | undefined;
    const skip = (profilesPipeline.find((s) => '$skip' in s)?.$skip as number | undefined) ?? 0;
    const limit =
      (profilesPipeline.find((s) => '$limit' in s)?.$limit as number | undefined) ?? matched.length;

    const ordered = sortSpec
      ? [...matched].sort((a, b) => {
          for (const [key, dir] of Object.entries(sortSpec)) {
            const av = sortKeyValue(a, key);
            const bv = sortKeyValue(b, key);
            let cmp = 0;
            if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv);
            else cmp = (av as number) - (bv as number);
            if (cmp !== 0) return dir === -1 ? -cmp : cmp;
          }
          return 0;
        })
      : matched;

    const paged = ordered.slice(skip, skip + limit);
    return Promise.resolve([{ profiles: paged, totalCount: [{ count: matched.length }] }]);
  };
}

const activeLocal = new Types.ObjectId();
const archivedActor = new Types.ObjectId();
const restrictedActor = new Types.ObjectId();
const trustedActor = new Types.ObjectId();

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/profiles', profilesRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  // Follower/following count aggregations return empty for every test.
  mockFollowAggregate.mockResolvedValue([]);
  mockIsFediverseHandle.mockReturnValue(false);
  mockGetUserStats.mockResolvedValue({ followers: 0, following: 0 });
  // Default: no local user (the resolve tests override per-case).
  mockUserFindOne.mockReturnValue(findOneQuery(null));
});

/**
 * A chainable stub matching `User.findOne(...).select(...).lean({ virtuals })`
 * as the `/profiles/resolve` local-first lookup calls it.
 */
function findOneQuery(user: PoolUser | null): {
  select: jest.Mock;
  lean: jest.Mock;
} {
  const query = {
    select: jest.fn(),
    lean: jest.fn().mockResolvedValue(user),
  };
  query.select.mockReturnValue(query);
  return query;
}

describe('GET /profiles/search archived exclusion', () => {
  it('adds accountStatus: { $ne: "archived" } to the aggregation $match', async () => {
    mockUserAggregate.mockImplementation(aggregateSearch([]));

    const res = await requestJson(server, '/profiles/search?query=test');
    expect(res.status).toBe(200);

    const pipeline = mockUserAggregate.mock.calls[0][0] as Array<{ $match?: Record<string, unknown> }>;
    expect(pipeline[0].$match?.accountStatus).toEqual({ $ne: 'archived' });
  });

  it('adds reputationTier: { $ne: "restricted" } to the aggregation $match', async () => {
    mockUserAggregate.mockImplementation(aggregateSearch([]));

    const res = await requestJson(server, '/profiles/search?query=test');
    expect(res.status).toBe(200);

    const pipeline = mockUserAggregate.mock.calls[0][0] as Array<{ $match?: Record<string, unknown> }>;
    expect(pipeline[0].$match?.reputationTier).toEqual({ $ne: 'restricted' });
  });

  it('filters archived accounts while surfacing active matches', async () => {
    const pool: PoolUser[] = [
      { _id: activeLocal, username: 'active_match', accountStatus: 'active' },
      { _id: archivedActor, username: 'archived_match', accountStatus: 'archived' },
    ];
    mockUserAggregate.mockImplementation(aggregateSearch(pool));

    const res = await requestJson(server, '/profiles/search?query=match');
    expect(res.status).toBe(200);

    const ids = (res.body.data ?? []).map((p) => String(p.id));
    expect(ids).toContain(activeLocal.toString());
    expect(ids).not.toContain(archivedActor.toString());
  });

  it('filters restricted-tier users while surfacing trusted and untiered matches', async () => {
    const pool: PoolUser[] = [
      // Active + no reputationTier (absent field) — must still surface.
      { _id: activeLocal, username: 'untiered_match', accountStatus: 'active' },
      // Active + explicit non-punitive tier — must still surface.
      { _id: trustedActor, username: 'trusted_match', accountStatus: 'active', reputationTier: 'trusted' },
      // Active but punitive `restricted` tier — must be hidden.
      { _id: restrictedActor, username: 'restricted_match', accountStatus: 'active', reputationTier: 'restricted' },
    ];
    mockUserAggregate.mockImplementation(aggregateSearch(pool));

    const res = await requestJson(server, '/profiles/search?query=match');
    expect(res.status).toBe(200);

    const ids = (res.body.data ?? []).map((p) => String(p.id));
    expect(ids).toContain(activeLocal.toString());
    expect(ids).toContain(trustedActor.toString());
    expect(ids).not.toContain(restrictedActor.toString());
  });

  it('hides a restricted OR archived user while an active untiered user shows', async () => {
    const pool: PoolUser[] = [
      // Active, no tier — the only row that should survive both gates.
      { _id: activeLocal, username: 'clean_match', accountStatus: 'active' },
      // Archived (any tier) — hidden by the accountStatus gate.
      { _id: archivedActor, username: 'archived_match', accountStatus: 'archived', reputationTier: 'trusted' },
      // Restricted (active) — hidden by the reputationTier gate.
      { _id: restrictedActor, username: 'restricted_match', accountStatus: 'active', reputationTier: 'restricted' },
    ];
    mockUserAggregate.mockImplementation(aggregateSearch(pool));

    const res = await requestJson(server, '/profiles/search?query=match');
    expect(res.status).toBe(200);

    const ids = (res.body.data ?? []).map((p) => String(p.id));
    expect(ids).toEqual([activeLocal.toString()]);
  });

  it('does NOT prepend a federated actor that resolves as restricted', async () => {
    mockUserAggregate.mockImplementation(aggregateSearch([]));
    mockIsFediverseHandle.mockReturnValue(true);
    mockResolveAndUpsert.mockResolvedValue({
      _id: restrictedActor,
      username: 'abuser@remote.example',
      type: 'federated',
      accountStatus: 'active',
      reputationTier: 'restricted',
    });

    const res = await requestJson(server, '/profiles/search?query=abuser@remote.example');
    expect(res.status).toBe(200);

    const ids = (res.body.data ?? []).map((p) => String(p.id));
    expect(ids).not.toContain(restrictedActor.toString());
    expect(res.body.data).toHaveLength(0);
  });

  it('does NOT prepend a federated actor that resolves as archived', async () => {
    mockUserAggregate.mockImplementation(aggregateSearch([]));
    mockIsFediverseHandle.mockReturnValue(true);
    mockResolveAndUpsert.mockResolvedValue({
      _id: archivedActor,
      username: 'gone@remote.example',
      type: 'federated',
      accountStatus: 'archived',
    });

    const res = await requestJson(server, '/profiles/search?query=gone@remote.example');
    expect(res.status).toBe(200);

    const ids = (res.body.data ?? []).map((p) => String(p.id));
    expect(ids).not.toContain(archivedActor.toString());
    expect(res.body.data).toHaveLength(0);
  });

  it('prepends a live federated actor resolved via federation', async () => {
    mockUserAggregate.mockImplementation(aggregateSearch([]));
    mockIsFediverseHandle.mockReturnValue(true);
    mockResolveAndUpsert.mockResolvedValue({
      _id: activeLocal,
      username: 'alive@remote.example',
      type: 'federated',
      accountStatus: 'active',
    });

    const res = await requestJson(server, '/profiles/search?query=alive@remote.example');
    expect(res.status).toBe(200);

    const ids = (res.body.data ?? []).map((p) => String(p.id));
    expect(ids).toContain(activeLocal.toString());
  });
});

/**
 * Native-first, deterministic ordering. People search must return Oxy NATIVE
 * users (local/agent/etc.) before FEDERATED ones and page with a strict total
 * order (`_nativePriority` → `reputationRankWeight` desc → `_id`) so the client's
 * infinite scroll never sees a duplicated or skipped row across offset pages.
 * The mocked `User.aggregate` faithfully applies the route's OWN `$facet.profiles`
 * `$sort`/`$skip`/`$limit`, so these assertions verify the real sort spec.
 */
describe('GET /profiles/search native-first ordering + pagination stability', () => {
  it('emits a $facet.profiles $sort that is native-first and _id-final, before $skip/$limit', async () => {
    mockUserAggregate.mockImplementation(aggregateSearchPaged([]));

    const res = await requestJson(server, '/profiles/search?query=test');
    expect(res.status).toBe(200);

    const pipeline = mockUserAggregate.mock.calls[0][0] as Array<{
      $facet?: { profiles?: Array<Record<string, unknown>> };
    }>;
    const profilesPipeline = pipeline.find((s) => s.$facet)?.$facet?.profiles ?? [];
    const sortStage = profilesPipeline.find((s) => '$sort' in s)?.$sort as Record<string, number>;

    const sortKeys = Object.keys(sortStage);
    // Native/federated tier is the PRIMARY sort key (ascending: 0 native, 1 fed).
    expect(sortKeys[0]).toBe('_nativePriority');
    expect(sortStage._nativePriority).toBe(1);
    // `_id` is the FINAL tiebreaker (ascending) → strict total order.
    expect(sortKeys[sortKeys.length - 1]).toBe('_id');
    expect(sortStage._id).toBe(1);

    // The sort orders the WHOLE match set — it precedes $skip and $limit.
    const sortIdx = profilesPipeline.findIndex((s) => '$sort' in s);
    const skipIdx = profilesPipeline.findIndex((s) => '$skip' in s);
    const limitIdx = profilesPipeline.findIndex((s) => '$limit' in s);
    expect(sortIdx).toBeGreaterThanOrEqual(0);
    expect(sortIdx).toBeLessThan(skipIdx);
    expect(sortIdx).toBeLessThan(limitIdx);
  });

  it('orders NATIVE users before FEDERATED, regardless of reputation rank', async () => {
    const nativeHigh = new Types.ObjectId();
    const nativeLow = new Types.ObjectId();
    const fedHigh = new Types.ObjectId();
    const fedLow = new Types.ObjectId();
    // Input order is deliberately shuffled; the route's $sort must reorder it.
    const pool: PoolUser[] = [
      { _id: fedHigh, username: 'fed_high_match', accountStatus: 'active', type: 'federated', reputationRankWeight: 9 },
      { _id: nativeLow, username: 'native_low_match', accountStatus: 'active', reputationRankWeight: 1 },
      { _id: fedLow, username: 'fed_low_match', accountStatus: 'active', type: 'federated', reputationRankWeight: 2 },
      { _id: nativeHigh, username: 'native_high_match', accountStatus: 'active', type: 'agent', reputationRankWeight: 5 },
    ];
    mockUserAggregate.mockImplementation(aggregateSearchPaged(pool));

    const res = await requestJson(server, '/profiles/search?query=match&limit=10&offset=0');
    expect(res.status).toBe(200);

    const ids = (res.body.data ?? []).map((p) => String(p.id));
    // Natives first (an `agent` is native), ranked by reputation desc within each
    // tier; the highest-rep federated (9) still ranks BELOW every native.
    expect(ids).toEqual([
      nativeHigh.toString(),
      nativeLow.toString(),
      fedHigh.toString(),
      fedLow.toString(),
    ]);
  });

  it('is STABLE across two offset pages — no duplicate, no skipped row', async () => {
    // Two natives + two federated, all with EQUAL reputation rank, so within a
    // tier the ONLY separator is the `_id` final tiebreaker. Without it, the page
    // boundary could duplicate or drop a row.
    const nativeA = new Types.ObjectId();
    const nativeB = new Types.ObjectId();
    const fedA = new Types.ObjectId();
    const fedB = new Types.ObjectId();
    const pool: PoolUser[] = [
      { _id: fedB, username: 'p_fedb_match', accountStatus: 'active', type: 'federated', reputationRankWeight: 1 },
      { _id: nativeB, username: 'p_natb_match', accountStatus: 'active', reputationRankWeight: 1 },
      { _id: fedA, username: 'p_feda_match', accountStatus: 'active', type: 'federated', reputationRankWeight: 1 },
      { _id: nativeA, username: 'p_nata_match', accountStatus: 'active', reputationRankWeight: 1 },
    ];
    mockUserAggregate.mockImplementation(aggregateSearchPaged(pool));

    // Expected global order: natives (by _id asc) then federated (by _id asc).
    const natives = [nativeA.toString(), nativeB.toString()].sort();
    const feds = [fedA.toString(), fedB.toString()].sort();
    const expectedFullOrder = [...natives, ...feds];

    const page1 = await requestJson(server, '/profiles/search?query=match&limit=2&offset=0');
    const page2 = await requestJson(server, '/profiles/search?query=match&limit=2&offset=2');
    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);

    const ids1 = (page1.body.data ?? []).map((p) => String(p.id));
    const ids2 = (page2.body.data ?? []).map((p) => String(p.id));

    // Page 1 = both natives, page 2 = both federated (native-first holds across
    // the page boundary).
    expect(ids1).toEqual(expectedFullOrder.slice(0, 2));
    expect(ids2).toEqual(expectedFullOrder.slice(2, 4));
    // No row appears on both pages (no duplication)…
    expect(ids1.filter((id) => ids2.includes(id))).toHaveLength(0);
    // …and the two pages together cover every match with nothing skipped.
    expect([...ids1, ...ids2].sort()).toEqual([...expectedFullOrder].sort());
  });

  it('keeps the archived/restricted exclusion under native-first ordering', async () => {
    const nativeOk = new Types.ObjectId();
    const fedOk = new Types.ObjectId();
    const archived = new Types.ObjectId();
    const restricted = new Types.ObjectId();
    const pool: PoolUser[] = [
      { _id: fedOk, username: 'ok_fed_match', accountStatus: 'active', type: 'federated', reputationRankWeight: 3 },
      { _id: archived, username: 'archived_match', accountStatus: 'archived', reputationRankWeight: 9 },
      { _id: nativeOk, username: 'ok_native_match', accountStatus: 'active', reputationRankWeight: 1 },
      { _id: restricted, username: 'restricted_match', accountStatus: 'active', reputationTier: 'restricted', reputationRankWeight: 9 },
    ];
    mockUserAggregate.mockImplementation(aggregateSearchPaged(pool));

    const res = await requestJson(server, '/profiles/search?query=match&limit=10&offset=0');
    expect(res.status).toBe(200);

    const ids = (res.body.data ?? []).map((p) => String(p.id));
    // Archived + restricted are gone even though both had higher rep; the native
    // survivor still precedes the federated survivor.
    expect(ids).toEqual([nativeOk.toString(), fedOk.toString()]);
  });

  it('prepends an exact-handle federated match at the FRONT, natives following', async () => {
    const fedExact = new Types.ObjectId();
    const nativeMatch = new Types.ObjectId();
    const pool: PoolUser[] = [
      { _id: nativeMatch, username: 'alive_native', accountStatus: 'active', reputationRankWeight: 5 },
    ];
    mockUserAggregate.mockImplementation(aggregateSearchPaged(pool));
    mockIsFediverseHandle.mockReturnValue(true);
    mockResolveAndUpsert.mockResolvedValue({
      _id: fedExact,
      username: 'alive@remote.example',
      type: 'federated',
      accountStatus: 'active',
    });

    const res = await requestJson(server, '/profiles/search?query=alive');
    expect(res.status).toBe(200);

    const ids = (res.body.data ?? []).map((p) => String(p.id));
    // Documented exception: the exact fediverse-handle hit is prepended ahead of
    // the native-first block (the caller typed that precise handle).
    expect(ids[0]).toBe(fedExact.toString());
    expect(ids).toContain(nativeMatch.toString());
  });
});

/**
 * BUG A — a leading `@` on a people-search query must be stripped BEFORE the
 * regex is built, otherwise the literal `@` never matches the STORED username.
 * The mocked `User.aggregate` evaluates the route's ACTUAL compiled regex against
 * the pool, so these assertions exercise the real strip + escape, not a stub.
 */
describe('GET /profiles/search leading-@ handling', () => {
  it('strips a single leading @ so a Bluesky handle matches the stored username', async () => {
    // Stored atproto username has NO leading @; the query the client sends does.
    const pool: PoolUser[] = [
      { _id: activeLocal, username: 'adamrbjack.bsky.social@bsky.social', accountStatus: 'active' },
    ];
    mockUserAggregate.mockImplementation(aggregateSearch(pool));

    const res = await requestJson(
      server,
      `/profiles/search?query=${encodeURIComponent('@adamrbjack.bsky.social@bsky.social')}`
    );
    expect(res.status).toBe(200);

    const usernames = (res.body.data ?? []).map((p) => p.username);
    expect(usernames).toContain('adamrbjack.bsky.social@bsky.social');
  });

  it('strips only the leading @ — a mid-string @ (user@host) is preserved', async () => {
    const userAtHost = new Types.ObjectId();
    const userNoAt = new Types.ObjectId();
    const pool: PoolUser[] = [
      // Should match: `@user@host.example` → stripped to `user@host.example`.
      { _id: userAtHost, username: 'user@host.example', accountStatus: 'active' },
      // Must NOT match: only surfaces if the mid-string @ were also stripped.
      { _id: userNoAt, username: 'userhost.example', accountStatus: 'active' },
    ];
    mockUserAggregate.mockImplementation(aggregateSearch(pool));

    const res = await requestJson(
      server,
      `/profiles/search?query=${encodeURIComponent('@user@host.example')}`
    );
    expect(res.status).toBe(200);

    const usernames = (res.body.data ?? []).map((p) => p.username);
    expect(usernames).toContain('user@host.example');
    expect(usernames).not.toContain('userhost.example');
  });
});

/**
 * BUG B — `/profiles/resolve` must be LOCAL-FIRST: a handle that already maps to
 * a known Oxy user resolves straight from the DB (crucial for atproto/Bluesky
 * actors whose `user@bsky.social` username oxy-api's WebFinger can never
 * resolve). Only an UNKNOWN handle falls through to `resolveAndUpsert`.
 */
describe('GET /profiles/resolve local-first', () => {
  it('resolves an existing federated user by exact username WITHOUT WebFinger', async () => {
    const known: PoolUser = {
      _id: activeLocal,
      username: 'adamrbjack.bsky.social@bsky.social',
      accountStatus: 'active',
      type: 'federated',
    };
    mockUserFindOne.mockReturnValue(findOneQuery(known));
    // Prove the local lookup runs regardless of the strict handle-format check.
    mockIsFediverseHandle.mockReturnValue(false);

    const res = await requestJson<ProfileResult | null>(
      server,
      `/profiles/resolve?handle=${encodeURIComponent('adamrbjack.bsky.social@bsky.social')}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.id).toBe(activeLocal.toString());
    expect(res.body.data?.username).toBe('adamrbjack.bsky.social@bsky.social');

    // The exact handle is used as the username lookup key…
    expect(mockUserFindOne).toHaveBeenCalledWith({ username: 'adamrbjack.bsky.social@bsky.social' });
    // …and remote discovery is never invoked for a known user.
    expect(mockResolveAndUpsert).not.toHaveBeenCalled();
  });

  it('returns null for an archived local match without WebFinger', async () => {
    mockUserFindOne.mockReturnValue(
      findOneQuery({ _id: archivedActor, username: 'gone@remote.example', accountStatus: 'archived' })
    );

    const res = await requestJson<ProfileResult | null>(
      server,
      `/profiles/resolve?handle=${encodeURIComponent('gone@remote.example')}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect(mockResolveAndUpsert).not.toHaveBeenCalled();
  });

  it('returns null for a restricted-tier local match without WebFinger', async () => {
    mockUserFindOne.mockReturnValue(
      findOneQuery({
        _id: restrictedActor,
        username: 'abuser@remote.example',
        accountStatus: 'active',
        reputationTier: 'restricted',
      })
    );

    const res = await requestJson<ProfileResult | null>(
      server,
      `/profiles/resolve?handle=${encodeURIComponent('abuser@remote.example')}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect(mockResolveAndUpsert).not.toHaveBeenCalled();
  });

  it('falls through to resolveAndUpsert for an unknown handle', async () => {
    // No local user (default findOne → null); it is a valid fediverse handle.
    mockIsFediverseHandle.mockReturnValue(true);
    mockResolveAndUpsert.mockResolvedValue({
      _id: activeLocal,
      username: 'newuser@remote.example',
      type: 'federated',
      accountStatus: 'active',
    });

    const res = await requestJson<ProfileResult | null>(
      server,
      `/profiles/resolve?handle=${encodeURIComponent('newuser@remote.example')}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.id).toBe(activeLocal.toString());
    expect(mockResolveAndUpsert).toHaveBeenCalledWith('newuser@remote.example');
  });

  it('strips a single leading @ before the local username lookup', async () => {
    const known: PoolUser = {
      _id: activeLocal,
      username: 'adamrbjack.bsky.social@bsky.social',
      accountStatus: 'active',
      type: 'federated',
    };
    mockUserFindOne.mockReturnValue(findOneQuery(known));
    mockIsFediverseHandle.mockReturnValue(false);

    const res = await requestJson<ProfileResult | null>(
      server,
      `/profiles/resolve?handle=${encodeURIComponent('@adamrbjack.bsky.social@bsky.social')}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.id).toBe(activeLocal.toString());
    expect(mockUserFindOne).toHaveBeenCalledWith({ username: 'adamrbjack.bsky.social@bsky.social' });
    expect(mockResolveAndUpsert).not.toHaveBeenCalled();
  });

  it('lowercases a mixed-case federated handle before the local username lookup', async () => {
    const known: PoolUser = {
      _id: activeLocal,
      username: 'alice@mastodon.social',
      accountStatus: 'active',
      type: 'federated',
    };
    mockUserFindOne.mockImplementation((query: { username?: string }) => {
      expect(query.username).toBe('alice@mastodon.social');
      return findOneQuery(known);
    });
    mockIsFediverseHandle.mockReturnValue(true);

    const res = await requestJson<ProfileResult | null>(
      server,
      `/profiles/resolve?handle=${encodeURIComponent('Alice@Mastodon.Social')}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.id).toBe(activeLocal.toString());
    expect(mockResolveAndUpsert).not.toHaveBeenCalled();
  });

  it('returns null for a restricted user resolved via discovery', async () => {
    mockIsFediverseHandle.mockReturnValue(true);
    mockResolveAndUpsert.mockResolvedValue({
      _id: restrictedActor,
      username: 'abuser@remote.example',
      type: 'federated',
      accountStatus: 'active',
      reputationTier: 'restricted',
    });

    const res = await requestJson<ProfileResult | null>(
      server,
      `/profiles/resolve?handle=${encodeURIComponent('abuser@remote.example')}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});
