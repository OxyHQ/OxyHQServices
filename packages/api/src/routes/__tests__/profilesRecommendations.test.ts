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

// optionalAuthMiddleware is swappable per-test so we can run authenticated and
// logged-out paths against the same mounted router. getUserId stays the REAL
// implementation (it is a pure `req.user?._id` read) so we exercise the route's
// genuine identity extraction.
let currentUserId: string | undefined;
jest.mock('../../middleware/optionalAuth', () => ({
  optionalAuthMiddleware: (
    req: { user?: { _id: string } },
    _res: unknown,
    next: () => void
  ) => {
    if (currentUserId) {
      req.user = { _id: currentUserId };
    }
    next();
  },
  getUserId: (req: { user?: { _id?: string } }): string | undefined => req.user?._id,
}));

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

function requestJson(server: http.Server, path: string): Promise<JsonResponse> {
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

/** Extract the `_id.$nin` ObjectId[] the route passed to a User.aggregate match. */
function extractNinIds(pipeline: unknown): Types.ObjectId[] {
  const stages = pipeline as Array<{ $match?: { _id?: { $nin?: Types.ObjectId[] } } }>;
  const matchStage = stages.find((s) => s.$match && s.$match._id && s.$match._id.$nin);
  return matchStage?.$match?._id?.$nin ?? [];
}

function expectFederatedEligibilityMatch(pipeline: unknown, prefix = ''): void {
  const stages = pipeline as Array<{ $match?: Record<string, unknown> }>;
  const matchStage = stages.find((stage) => {
    const clauses = stage.$match?.$or as Array<Record<string, unknown>> | undefined;
    return clauses?.some((clause) => clause[`${prefix}type`] === 'federated');
  });
  const federatedClause = (matchStage?.$match?.$or as Array<Record<string, unknown>> | undefined)
    ?.find((clause) => clause[`${prefix}type`] === 'federated');

  expect(federatedClause).toEqual(expect.objectContaining({
    [`${prefix}type`]: 'federated',
    [`${prefix}federation.actorUri`]: { $type: 'string', $ne: '' },
    [`${prefix}federation.domain`]: { $type: 'string', $ne: '' },
    [`${prefix}federation.lastResolvedAt`]: { $gte: expect.any(Date) },
    [`${prefix}federation.unavailableAt`]: { $exists: false },
  }));
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
});

describe('GET /profiles/recommendations exclusion set', () => {
  it('never returns self (A) nor already-followed users (B, C), even when the fill path would surface them', async () => {
    currentUserId = userA.toHexString();

    // Following set: A follows B and C. The route loads this via
    // Follow.find(...).select('followedId').lean().
    const lean = jest.fn().mockResolvedValue([
      { followedId: userB },
      { followedId: userC },
    ]);
    const select = jest.fn().mockReturnValue({ lean });
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
});
