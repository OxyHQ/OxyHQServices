/**
 * GET /profiles/recommendations exclusion-set coverage.
 *
 * Proves the recommendation surface never leaks:
 *   - the caller themselves (self), nor
 *   - anyone the caller already follows,
 * even when those accounts would otherwise be surfaced by the
 * popular/random fill path.
 *
 * The router is mounted on a minimal Express app and exercised via
 * `node:http` round-trips (mirrors usersResolve.test.ts) so we hit the real
 * route handler — including the exact `excludeIds` set it computes and the
 * `$nin` it passes to the Follow/User aggregations. The mocked Mongoose models
 * faithfully honour that `$nin` so the assertions verify the route's own
 * exclusion logic rather than a stub's behaviour.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

// The global mongoose mock (jest.setup.cjs) does not expose `Types`, which the
// profiles route relies on (`new Types.ObjectId(...)`, `instanceof` checks).
// Restore the REAL mongoose so the route's ObjectId handling runs unmocked.
jest.mock('mongoose', () => jest.requireActual('mongoose'));
import { Types } from 'mongoose';

const mockFollowFind = jest.fn();
const mockFollowAggregate = jest.fn();
const mockUserAggregate = jest.fn();

// The dual-auth middleware is swappable per-test so we can run authenticated and
// logged-out paths against the same mounted router. The mocked
// `optionalUserOrServiceAuth` only attaches the principal the test selects
// (req.user for a user token, req.serviceApp for a service token); the route's
// REAL viewer-resolution logic is mirrored faithfully by the mocked
// `resolveViewerId` below (kept byte-aligned with the production rule:
// user → own session; service → X-Oxy-User-Id only with `user:read` + valid id;
// the dedicated unit test in optionalAuth.test.ts exercises the production fn
// directly). This keeps THIS route test hermetic (no real auth/session/mongoose
// module graph loaded).
let currentUserId: string | undefined;
let currentServiceApp: { appId: string; scopes: string[] } | undefined;
jest.mock('../../middleware/optionalAuth', () => {
  const { Types } = jest.requireActual('mongoose');
  return {
    optionalUserOrServiceAuth: (
      req: { user?: { _id: string }; serviceApp?: { appId: string; scopes: string[] } },
      _res: unknown,
      next: () => void
    ) => {
      if (currentServiceApp) {
        req.serviceApp = { type: 'service', appName: 'test', credentialId: 'c', ...currentServiceApp };
      } else if (currentUserId) {
        req.user = { _id: currentUserId };
      }
      next();
    },
    resolveViewerId: (req: {
      user?: { _id?: string };
      serviceApp?: { appId: string; scopes: string[] };
      headers: Record<string, string | string[] | undefined>;
    }): string | undefined => {
      if (req.user?._id) return req.user._id;
      const svc = req.serviceApp;
      if (!svc) return undefined;
      if (!svc.scopes.includes('user:read')) return undefined;
      const raw = req.headers['x-oxy-user-id'];
      const viewerId = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
      if (!viewerId || !Types.ObjectId.isValid(viewerId)) return undefined;
      return viewerId;
    },
  };
});

// Heavy / DB-touching imports pulled in by the profiles router are stubbed so
// importing the router doesn't crash. None are used by /recommendations.
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../services/user.service', () => ({
  userService: {
    getUserStats: jest.fn(),
    formatUserResponse: jest.fn(),
  },
}));
jest.mock('../../services/federation.service', () => ({
  federationService: { resolveAndUpsert: jest.fn() },
  isFediverseHandle: jest.fn().mockReturnValue(false),
}));
jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../models/Follow', () => ({
  __esModule: true,
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
  default: {
    find: (...args: unknown[]) => mockFollowFind(...args),
    aggregate: (...args: unknown[]) => mockFollowAggregate(...args),
  },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    aggregate: (...args: unknown[]) => mockUserAggregate(...args),
  },
}));

import profilesRouter from '../profiles';
import { errorHandler } from '../../middleware/errorHandler';

interface ProfileResult {
  id: unknown;
  username?: string;
}

interface JsonResponse {
  status: number;
  body: { error?: string; message?: string; data?: ProfileResult[] };
}

function requestJson(
  server: http.Server,
  path: string,
  headers: Record<string, string> = {}
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'GET', host: '127.0.0.1', port: address.port, path, headers },
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

/** Extract the `_id.$nin` ObjectId[] the route passed to a User.aggregate match. */
function extractNinIds(pipeline: unknown): Types.ObjectId[] {
  const stages = pipeline as Array<{ $match?: { _id?: { $nin?: Types.ObjectId[] } } }>;
  const matchStage = stages.find((s) => s.$match && s.$match._id && s.$match._id.$nin);
  return matchStage?.$match?._id?.$nin ?? [];
}

type OrClauses = Array<Record<string, unknown>>;
type MatchStage = {
  $match?: {
    $or?: OrClauses;
    $and?: Array<{ $or?: OrClauses }>;
    [key: string]: unknown;
  };
};

/**
 * Collect every `$or` clause group reachable from a pipeline's `$match` stages,
 * whether the `$or` sits at the top level of the match or nested inside an
 * `$and` (the federated-eligibility and profile-quality helpers are combined
 * under `$and`, so each contributes its own `$or`).
 */
function collectOrGroups(pipeline: unknown): OrClauses[] {
  const stages = pipeline as MatchStage[];
  const groups: OrClauses[] = [];
  for (const stage of stages) {
    const match = stage.$match;
    if (!match) continue;
    if (Array.isArray(match.$or)) groups.push(match.$or);
    if (Array.isArray(match.$and)) {
      for (const clause of match.$and) {
        if (Array.isArray(clause.$or)) groups.push(clause.$or);
      }
    }
  }
  return groups;
}

function expectFederatedEligibilityMatch(pipeline: unknown, prefix = ''): void {
  const federatedClause = collectOrGroups(pipeline)
    .flat()
    .find((clause) => clause[`${prefix}type`] === 'federated');

  expect(federatedClause).toEqual(expect.objectContaining({
    [`${prefix}type`]: 'federated',
    [`${prefix}federation.actorUri`]: { $type: 'string', $ne: '' },
    [`${prefix}federation.domain`]: { $type: 'string', $ne: '' },
    [`${prefix}federation.lastResolvedAt`]: { $gte: expect.any(Date) },
    [`${prefix}federation.unavailableAt`]: { $exists: false },
  }));
}

/**
 * Assert the profile-quality bar is present in a recommendation pipeline: a
 * required non-empty `username` plus an `$or` of at least one curated-profile
 * signal (avatar / structured name / bio / description / verified).
 */
function expectProfileQualityMatch(pipeline: unknown, prefix = ''): void {
  const stages = pipeline as MatchStage[];
  const nonEmptyString = { $type: 'string', $ne: '' };

  // The `username` gate lives inside the profile-quality clause, which is itself
  // an `$and` member alongside the federated-eligibility clause. Find whichever
  // object carries it, top-level or nested under `$and`.
  const usernameValue = (() => {
    for (const stage of stages) {
      const match = stage.$match;
      if (!match) continue;
      if (match[`${prefix}username`] !== undefined) return match[`${prefix}username`];
      if (Array.isArray(match.$and)) {
        for (const clause of match.$and as Array<Record<string, unknown>>) {
          if (clause[`${prefix}username`] !== undefined) return clause[`${prefix}username`];
        }
      }
    }
    return undefined;
  })();
  expect(usernameValue).toEqual(nonEmptyString);

  const qualityOr = collectOrGroups(pipeline).find((group) =>
    group.some((clause) => clause[`${prefix}avatar`] !== undefined)
  );
  expect(qualityOr).toEqual(
    expect.arrayContaining([
      { [`${prefix}avatar`]: nonEmptyString },
      { [`${prefix}name.first`]: nonEmptyString },
      { [`${prefix}name.last`]: nonEmptyString },
      { [`${prefix}bio`]: nonEmptyString },
      { [`${prefix}description`]: nonEmptyString },
      { [`${prefix}verified`]: true },
    ])
  );
}

/**
 * Assert the account-level sensitivity gate is present in a recommendation
 * pipeline: a candidate must NOT be flagged `isSensitive` (set by moderation).
 * Uses `{ $ne: true }` so legacy/federated docs missing the field still pass.
 * The clause lives alongside the profile-quality and federated-eligibility
 * clauses inside the eligibility `$and`, so search both the top-level match and
 * any `$and` members.
 */
function expectNonSensitiveMatch(pipeline: unknown, prefix = ''): void {
  const stages = pipeline as MatchStage[];
  const field = `${prefix}isSensitive`;
  const value = (() => {
    for (const stage of stages) {
      const match = stage.$match;
      if (!match) continue;
      if (match[field] !== undefined) return match[field];
      if (Array.isArray(match.$and)) {
        for (const clause of match.$and as Array<Record<string, unknown>>) {
          if (clause[field] !== undefined) return clause[field];
        }
      }
    }
    return undefined;
  })();
  expect(value).toEqual({ $ne: true });
}

const userA = new Types.ObjectId(); // the caller (self)
const userB = new Types.ObjectId(); // followed by A
const userC = new Types.ObjectId(); // followed by A
const userD = new Types.ObjectId(); // a stranger — should be recommendable

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
  currentUserId = undefined;
  currentServiceApp = undefined;
});

describe('GET /profiles/recommendations exclusion set', () => {
  it('never returns self (A) nor already-followed users (B, C), even when the fill path would surface them', async () => {
    currentUserId = userA.toHexString();

    // Following set: A follows B and C. The route loads this via
    // Follow.find(...).select('followedId').limit(...).lean().
    const lean = jest.fn().mockResolvedValue([
      { followedId: userB },
      { followedId: userC },
    ]);
    const limit = jest.fn().mockReturnValue({ lean });
    const select = jest.fn().mockReturnValue({ limit, lean });
    mockFollowFind.mockReturnValue({ select });

    // No mutual-overlap recommendations, forcing the random User.aggregate fill.
    mockFollowAggregate.mockResolvedValue([]);

    // The fill candidate pool deliberately INCLUDES A, B and C alongside the
    // legitimate stranger D. The mock honours the route's `$nin: excludeIds`
    // exactly as MongoDB would, so anything leaking through proves a bug in the
    // route's exclude-set computation rather than in this stub.
    const pool = [
      { _id: userA, username: 'a', name: 'A', followersCount: 9, followingCount: 9, mutualCount: 0 },
      { _id: userB, username: 'b', name: 'B', followersCount: 9, followingCount: 9, mutualCount: 0 },
      { _id: userC, username: 'c', name: 'C', followersCount: 9, followingCount: 9, mutualCount: 0 },
      { _id: userD, username: 'd', name: 'D', followersCount: 1, followingCount: 1, mutualCount: 0 },
    ];
    mockUserAggregate.mockImplementation((pipeline: unknown) => {
      const excluded = extractNinIds(pipeline).map((id) => id.toString());
      return Promise.resolve(
        pool.filter((u) => !excluded.includes(u._id.toString()))
      );
    });

    const res = await requestJson(server, '/profiles/recommendations?limit=10');

    expect(res.status).toBe(200);
    const returnedIds = (res.body.data ?? []).map((p) => String(p.id));

    expect(returnedIds).not.toContain(userA.toString()); // never self
    expect(returnedIds).not.toContain(userB.toString()); // never an already-followed user
    expect(returnedIds).not.toContain(userC.toString());
    expect(returnedIds).toContain(userD.toString()); // the stranger is recommendable

    // The exclude set the route handed to the DB must be exactly {A, B, C}.
    const ninArg = mockUserAggregate.mock.calls[0][0];
    const excludedIds = extractNinIds(ninArg).map((id) => id.toString()).sort();
    expect(excludedIds).toEqual([userA.toString(), userB.toString(), userC.toString()].sort());
  });

  it('returns 200 with public profiles for an unauthenticated caller', async () => {
    currentUserId = undefined;

    // Public path: follower-ranked aggregation over the Follow collection.
    mockFollowAggregate.mockResolvedValue([
      { _id: userD, username: 'd', name: 'D', followersCount: 5, followingCount: 2, mutualCount: 0 },
    ]);
    // Public fill is only reached when the ranked window is short; provide an
    // empty fill so the assertion focuses on the public ranked result.
    mockUserAggregate.mockResolvedValue([]);

    const res = await requestJson(server, '/profiles/recommendations?limit=10');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const returnedIds = (res.body.data ?? []).map((p) => String(p.id));
    expect(returnedIds).toContain(userD.toString());
    // The personalized following-set query is never issued without a caller.
    expect(mockFollowFind).not.toHaveBeenCalled();
  });

  it('requires recently resolved federated users in recommendation pipelines', async () => {
    currentUserId = undefined;
    mockFollowAggregate.mockResolvedValue([]);
    mockUserAggregate.mockResolvedValue([]);

    const res = await requestJson(server, '/profiles/recommendations?limit=10');

    expect(res.status).toBe(200);
    expectFederatedEligibilityMatch(mockFollowAggregate.mock.calls[0][0], 'user.');
    expectFederatedEligibilityMatch(mockUserAggregate.mock.calls[0][0]);
  });

  it('enforces the minimum profile-quality bar on the public and random-fill pipelines', async () => {
    currentUserId = undefined;
    // Empty follower-ranked window so the route also issues the random-fill
    // User.aggregate, letting us assert the quality bar on both pipelines.
    mockFollowAggregate.mockResolvedValue([]);
    mockUserAggregate.mockResolvedValue([]);

    const res = await requestJson(server, '/profiles/recommendations?limit=10');

    expect(res.status).toBe(200);
    // Follower-ranked public pipeline (user under `user.`).
    expectProfileQualityMatch(mockFollowAggregate.mock.calls[0][0], 'user.');
    // Random-fill pipeline scanning the users collection directly.
    expectProfileQualityMatch(mockUserAggregate.mock.calls[0][0]);
  });

  it('excludes account-level sensitive (NSFW) profiles from the public and random-fill pipelines', async () => {
    currentUserId = undefined;
    // Empty follower-ranked window so the route also issues the random-fill
    // User.aggregate, letting us assert the sensitivity gate on both pipelines.
    mockFollowAggregate.mockResolvedValue([]);
    mockUserAggregate.mockResolvedValue([]);

    const res = await requestJson(server, '/profiles/recommendations?limit=10');

    expect(res.status).toBe(200);
    // Follower-ranked public pipeline (user under `user.`).
    expectNonSensitiveMatch(mockFollowAggregate.mock.calls[0][0], 'user.');
    // Random-fill pipeline scanning the users collection directly.
    expectNonSensitiveMatch(mockUserAggregate.mock.calls[0][0]);
  });

  it('applies the profile-quality bar to the personalized fill for an authenticated caller', async () => {
    currentUserId = userA.toHexString();

    const lean = jest.fn().mockResolvedValue([{ followedId: userB }]);
    const limit = jest.fn().mockReturnValue({ lean });
    const select = jest.fn().mockReturnValue({ limit, lean });
    mockFollowFind.mockReturnValue({ select });

    // No mutual-overlap results → forces the random User.aggregate fill, which
    // must carry the quality bar.
    mockFollowAggregate.mockResolvedValue([]);
    mockUserAggregate.mockResolvedValue([]);

    const res = await requestJson(server, '/profiles/recommendations?limit=10');

    expect(res.status).toBe(200);
    expectProfileQualityMatch(mockUserAggregate.mock.calls[0][0]);
  });
});

/**
 * Dual-auth viewer resolution (service token + X-Oxy-User-Id).
 *
 * The route now resolves the personalization viewer via the REAL
 * `resolveViewerId`. A valid service principal bearing `user:read` may name the
 * viewer through the `X-Oxy-User-Id` header; the route must then run the
 * PERSONALIZED path (load that viewer's following set via Follow.find) rather
 * than the anonymous public path. A user-token caller must ignore the header,
 * and a service lacking the scope / sending no header falls back to anonymous.
 */
describe('POST /profiles/recommendations dual-auth viewer resolution', () => {
  function postJson(
    server: http.Server,
    headers: Record<string, string> = {}
  ): Promise<JsonResponse> {
    const address = server.address() as AddressInfo;
    const payload = JSON.stringify({ limit: 10 });
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          host: '127.0.0.1',
          port: address.port,
          path: '/profiles/recommendations',
          headers: { 'content-type': 'application/json', ...headers },
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => { raw += chunk; });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} });
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on('error', reject);
      req.end(payload);
    });
  }

  /** Wire Follow.find so the personalized following-set load resolves to [B]. */
  function stubFollowingSet(followed: Types.ObjectId[]): void {
    const lean = jest.fn().mockResolvedValue(followed.map((id) => ({ followedId: id })));
    const limit = jest.fn().mockReturnValue({ lean });
    const select = jest.fn().mockReturnValue({ limit, lean });
    mockFollowFind.mockReturnValue({ select });
  }

  it('service token + valid X-Oxy-User-Id (with user:read) personalizes for that viewer', async () => {
    currentServiceApp = { appId: 'app1', scopes: ['user:read', 'files:write'] };
    stubFollowingSet([userB]);
    mockFollowAggregate.mockResolvedValue([]);
    mockUserAggregate.mockResolvedValue([]);

    const res = await postJson(server, { 'x-oxy-user-id': userA.toHexString() });

    expect(res.status).toBe(200);
    // Personalized path ran: the route loaded the VIEWER's following set.
    expect(mockFollowFind).toHaveBeenCalledTimes(1);
    expect(mockFollowFind.mock.calls[0][0]).toMatchObject({
      followerUserId: userA.toHexString(),
    });
    // The viewer (A) and the followed user (B) are excluded from the fill.
    const excludedIds = extractNinIds(mockUserAggregate.mock.calls[0][0]).map((id) => id.toString());
    expect(excludedIds).toContain(userA.toString());
    expect(excludedIds).toContain(userB.toString());
  });

  it('service token WITHOUT user:read ignores X-Oxy-User-Id (anonymous/public)', async () => {
    currentServiceApp = { appId: 'app1', scopes: ['files:write'] };
    mockFollowAggregate.mockResolvedValue([]);
    mockUserAggregate.mockResolvedValue([]);

    const res = await postJson(server, { 'x-oxy-user-id': userA.toHexString() });

    expect(res.status).toBe(200);
    // No viewer resolved → public path → the following-set query is never issued.
    expect(mockFollowFind).not.toHaveBeenCalled();
  });

  it('service token with a MALFORMED X-Oxy-User-Id falls back to anonymous', async () => {
    currentServiceApp = { appId: 'app1', scopes: ['user:read'] };
    mockFollowAggregate.mockResolvedValue([]);
    mockUserAggregate.mockResolvedValue([]);

    const res = await postJson(server, { 'x-oxy-user-id': 'not-an-objectid' });

    expect(res.status).toBe(200);
    expect(mockFollowFind).not.toHaveBeenCalled();
  });

  it('service token with NO X-Oxy-User-Id is anonymous (service acting as itself)', async () => {
    currentServiceApp = { appId: 'app1', scopes: ['user:read'] };
    mockFollowAggregate.mockResolvedValue([]);
    mockUserAggregate.mockResolvedValue([]);

    const res = await postJson(server, {});

    expect(res.status).toBe(200);
    expect(mockFollowFind).not.toHaveBeenCalled();
  });

  it('USER token IGNORES X-Oxy-User-Id and personalizes for its OWN session user (anti-impersonation)', async () => {
    // A logged-in user (D) tries to smuggle another user (A) via the header.
    currentUserId = userD.toHexString();
    currentServiceApp = undefined;
    stubFollowingSet([userC]);
    mockFollowAggregate.mockResolvedValue([]);
    mockUserAggregate.mockResolvedValue([]);

    const res = await postJson(server, { 'x-oxy-user-id': userA.toHexString() });

    expect(res.status).toBe(200);
    // The viewer is the SESSION user (D), NOT the header value (A).
    expect(mockFollowFind).toHaveBeenCalledTimes(1);
    expect(mockFollowFind.mock.calls[0][0]).toMatchObject({
      followerUserId: userD.toHexString(),
    });
    const excludedIds = extractNinIds(mockUserAggregate.mock.calls[0][0]).map((id) => id.toString());
    expect(excludedIds).toContain(userD.toString());
    expect(excludedIds).not.toContain(userA.toString());
  });

  it('no principal at all (no token) is anonymous/public', async () => {
    currentServiceApp = undefined;
    currentUserId = undefined;
    mockFollowAggregate.mockResolvedValue([]);
    mockUserAggregate.mockResolvedValue([]);

    const res = await postJson(server, {});

    expect(res.status).toBe(200);
    expect(mockFollowFind).not.toHaveBeenCalled();
  });
});

/**
 * Scored pipeline behavior — proves the (now sole) reputation-weighted scorer
 * runs end-to-end for a viewer with a non-empty candidate union: it scores the
 * mutual-overlap candidates, ranks them by composite score, and looks up
 * follower/following counts for the returned page only. This is the default path
 * (the REC_SCORING_V2 flag and legacy fallback were removed), so this test
 * guards that the scorer stays wired for real candidates rather than only the
 * empty-union popular fallback the exclusion tests exercise.
 */
describe('GET /profiles/recommendations scored ranking', () => {
  it('scores and ranks mutual-overlap candidates, returning them highest-score first', async () => {
    currentUserId = userA.toHexString();

    // Viewer A follows B. The scored path loads the following set, then the
    // mutual-overlap aggregation (people followed by B).
    const lean = jest.fn().mockResolvedValue([{ followedId: userB }]);
    const limit = jest.fn().mockReturnValue({ lean });
    const select = jest.fn().mockReturnValue({ limit, lean });
    mockFollowFind.mockReturnValue({ select });

    // Mutual map: C has more overlap than D, so before any other signal C should
    // outrank D on the graph term.
    mockFollowAggregate.mockResolvedValue([
      { _id: userC, mutualCount: 8 },
      { _id: userD, mutualCount: 2 },
    ]);

    // First User.aggregate = the scoring pass over the candidate union {C, D};
    // second = the page follower/following count lookup. Distinguish them by the
    // presence of a `$sample`/score projection vs the count projection.
    mockUserAggregate.mockImplementation((pipeline: unknown) => {
      const stages = pipeline as Array<Record<string, unknown>>;
      const isCountPass = stages.some(
        (s) => s.$project && (s.$project as Record<string, unknown>).followersCount
      );
      if (isCountPass) {
        return Promise.resolve([
          { _id: userC, followersCount: 30, followingCount: 5 },
          { _id: userD, followersCount: 10, followingCount: 2 },
        ]);
      }
      // Scoring pass: emit both candidates with neutral aggregation-side scores
      // so the in-app graph term (mutualCount) drives the ranking.
      return Promise.resolve([
        {
          _id: userC, username: 'c', name: { first: 'C' }, avatar: 'x', verified: false,
          completenessScore: 1, verifiedScore: 0, repCandScore: 0.5,
        },
        {
          _id: userD, username: 'd', name: { first: 'D' }, avatar: 'x', verified: false,
          completenessScore: 1, verifiedScore: 0, repCandScore: 0.5,
        },
      ]);
    });

    const res = await requestJson(server, '/profiles/recommendations?limit=10');

    expect(res.status).toBe(200);
    const returnedIds = (res.body.data ?? []).map((p) => String(p.id));
    // Both candidates surface, with the higher-mutual-overlap C ranked first.
    expect(returnedIds).toEqual([userC.toString(), userD.toString()]);

    // The scoring pass matched the candidate UNION (C, D) — not a full-collection
    // scan — and excluded the viewer (A) and the followed user (B).
    const scoringMatch = (mockUserAggregate.mock.calls[0][0] as Array<{ $match?: { _id?: { $in?: Types.ObjectId[] } } }>)
      .find((s) => s.$match && s.$match._id && s.$match._id.$in);
    const candidateIds = (scoringMatch?.$match?._id?.$in ?? []).map((id) => id.toString());
    expect(candidateIds.sort()).toEqual([userC.toString(), userD.toString()].sort());
    expect(candidateIds).not.toContain(userA.toString());
    expect(candidateIds).not.toContain(userB.toString());

    // The scoring pass also applies the account-level sensitivity gate so a
    // candidate flagged NSFW by moderation is floored out of the scored surface,
    // mirroring the restricted/private exclusions.
    expectNonSensitiveMatch(mockUserAggregate.mock.calls[0][0]);
  });
});
