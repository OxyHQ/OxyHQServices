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
