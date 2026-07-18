/**
 * GET /profiles/:userId/similar discovery-gate coverage.
 *
 * Proves the co-follower "similar profiles" surface applies the SAME
 * eligibility/quality bar as `/profiles/recommendations`: incomplete
 * shell/QA accounts and stale/unavailable federated actors are filtered out
 * before they reach the response.
 *
 * The router is mounted on a minimal Express app and exercised via
 * `node:http` round-trips (mirrors profilesRecommendations.test.ts). The
 * mocked `Follow.aggregate` honours the post-`$unwind` `$match` the route adds
 * — applying it against an in-memory candidate pool exactly as MongoDB would —
 * so the assertions verify the route's own gate rather than a stub's behaviour.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// The global mongoose mock (jest.setup.cjs) does not expose `Types`, which the
// profiles route relies on (`new Types.ObjectId(...)`, `instanceof` checks).
// Restore the REAL mongoose so the route's ObjectId handling runs unmocked.
jest.mock('mongoose', () => jest.requireActual('mongoose'));
import { Types } from 'mongoose';

const mockFollowFind = jest.fn();
const mockFollowAggregate = jest.fn();

// The similar route is bearer-gated. Mock authMiddleware to populate the
// `{ id }` shape the route reads (`req.user?.id`).
let currentUserId: string | undefined;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (
    req: { user?: { id: string } },
    _res: unknown,
    next: () => void
  ) => {
    if (currentUserId) {
      req.user = { id: currentUserId };
    }
    next();
  },
}));

// Heavy / DB-touching imports pulled in by the profiles router are stubbed so
// importing the router doesn't crash. None are used by /:userId/similar.
jest.mock('../../middleware/optionalAuth', () => ({
  optionalUserOrServiceAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  resolveViewerId: (req: { user?: { _id?: string } }): string | undefined => req.user?._id,
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
    aggregate: jest.fn(),
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

const NON_EMPTY_STRING = { $type: 'string', $ne: '' };

/**
 * A minimal candidate row as it exists in the `users` collection (nested under
 * `user.` after the route's `$lookup` + `$unwind`).
 */
interface UserDoc {
  _id: Types.ObjectId;
  username?: string;
  avatar?: string;
  name?: { first?: string; last?: string };
  bio?: string;
  description?: string;
  verified?: boolean;
  type?: string;
  accountStatus?: string;
  reputationTier?: string;
  isSensitive?: boolean;
  privacySettings?: { isPrivateAccount?: boolean };
  federation?: {
    actorUri?: string;
    domain?: string;
    lastResolvedAt?: Date;
    unavailableAt?: Date;
  };
}

/** Whether a value satisfies the `{ $type:'string', $ne:'' }` non-empty gate. */
function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

/**
 * Faithfully evaluate the route's post-`$unwind` eligibility/quality `$match`
 * against a candidate user document, mirroring MongoDB's semantics for the
 * exact `$and`/`$or`/`$type`/`$gte`/`$exists` operators the gate uses.
 */
function passesEligibilityGate(user: UserDoc, minResolvedAt: Date): boolean {
  if (user.privacySettings?.isPrivateAccount === true) return false;
  if (user.accountStatus === 'archived') return false;
  if (user.reputationTier === 'restricted') return false;
  if (user.isSensitive === true) return false;

  // profile-quality bar: non-empty username AND at least one curated signal.
  if (!isNonEmptyString(user.username)) return false;
  const hasCuratedSignal =
    isNonEmptyString(user.avatar) ||
    isNonEmptyString(user.name?.first) ||
    isNonEmptyString(user.name?.last) ||
    isNonEmptyString(user.bio) ||
    isNonEmptyString(user.description) ||
    user.verified === true;
  if (!hasCuratedSignal) return false;

  // federated-eligibility bar: non-federated OR fresh+available federated.
  if (user.type !== 'federated') return true;
  return (
    isNonEmptyString(user.federation?.actorUri) &&
    isNonEmptyString(user.federation?.domain) &&
    !!user.federation?.lastResolvedAt &&
    user.federation.lastResolvedAt >= minResolvedAt &&
    user.federation?.unavailableAt === undefined
  );
}

/**
 * Drive the mocked `Follow.aggregate` for the similar pipeline: locate the
 * post-`$unwind` eligibility `$match`, apply it against the candidate pool, and
 * emit the same projected row shape the real `profileProjectionStage` produces.
 */
function aggregateSimilar(pool: UserDoc[]): (pipeline: unknown) => Promise<unknown[]> {
  return (pipeline: unknown) => {
    const stages = pipeline as Array<{
      $match?: { $and?: Array<{ $or?: Array<Record<string, unknown>> }> };
    }>;
    const gateStage = stages.find(
      (s) => s.$match && Array.isArray(s.$match.$and)
    );
    // The gate must be present — `minResolvedAt` is read off the federated
    // clause so the freshness comparison matches the route's own cutoff.
    const federatedClause = gateStage?.$match?.$and
      ?.flatMap((c) => c.$or ?? [])
      .find((c) => c['user.type'] === 'federated');
    const gteClause = federatedClause?.['user.federation.lastResolvedAt'] as
      | { $gte?: Date }
      | undefined;
    const minResolvedAt = gteClause?.$gte ?? new Date(0);

    const eligible = gateStage
      ? pool.filter((u) => passesEligibilityGate(u, minResolvedAt))
      : pool;

    return Promise.resolve(
      eligible.map((u) => ({
        _id: u._id,
        username: u.username,
        name: u.name,
        avatar: u.avatar,
        description: u.description,
        type: u.type,
        federation: u.federation,
        mutualCount: 1,
        followersCount: 0,
        followingCount: 0,
      }))
    );
  };
}

const caller = new Types.ObjectId();
const target = new Types.ObjectId();
const follower = new Types.ObjectId();

// Candidate co-followed accounts.
const completeProfile = new Types.ObjectId(); // username + avatar — passes
const shellProfile = new Types.ObjectId();    // username only, no signal — filtered
const freshFederated = new Types.ObjectId();   // fresh, available — passes
const staleFederated = new Types.ObjectId();   // resolved too long ago — filtered
const privateProfile = new Types.ObjectId(); // opted out of discovery — filtered

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
  currentUserId = caller.toHexString();

  // The route loads targetFollowers + currentFollowing in that order. The
  // target-followers load is now bounded:
  //   Follow.find(...).select('followerUserId').sort({ _id: 1 }).limit(N).lean()
  // while the current-following load stays Follow.find(...).select(...).lean().
  const targetFollowersLean = jest.fn().mockResolvedValue([{ followerUserId: follower }]);
  const currentFollowingLean = jest.fn().mockResolvedValue([]);
  mockFollowFind
    .mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({ lean: targetFollowersLean }),
        }),
      }),
    })
    .mockReturnValueOnce({ select: jest.fn().mockReturnValue({ lean: currentFollowingLean }) });
});

describe('GET /profiles/:userId/similar discovery gate', () => {
  it('filters shell/QA and stale federated candidates while surfacing complete and fresh-federated profiles', async () => {
    const now = Date.now();
    const pool: UserDoc[] = [
      { _id: completeProfile, username: 'complete', avatar: 'avatar-id' },
      { _id: shellProfile, username: 'shell' },
      {
        _id: freshFederated,
        username: 'fresh',
        avatar: 'fed-avatar',
        type: 'federated',
        federation: {
          actorUri: 'https://remote.example/users/fresh',
          domain: 'remote.example',
          lastResolvedAt: new Date(now - 24 * 60 * 60 * 1000), // 1 day ago — fresh
        },
      },
      {
        _id: staleFederated,
        username: 'stale',
        avatar: 'fed-avatar',
        type: 'federated',
        federation: {
          actorUri: 'https://remote.example/users/stale',
          domain: 'remote.example',
          lastResolvedAt: new Date(now - 40 * 24 * 60 * 60 * 1000), // 40 days ago — stale
        },
      },
      {
        _id: privateProfile,
        username: 'private',
        avatar: 'private-avatar',
        privacySettings: { isPrivateAccount: true },
      },
    ];

    mockFollowAggregate.mockImplementation(aggregateSimilar(pool));

    const res = await requestJson(server, `/profiles/${target.toHexString()}/similar?limit=10`);

    expect(res.status).toBe(200);
    const returnedIds = (res.body.data ?? []).map((p) => String(p.id));

    expect(returnedIds).toContain(completeProfile.toString()); // curated profile passes
    expect(returnedIds).toContain(freshFederated.toString());  // fresh federated passes
    expect(returnedIds).not.toContain(shellProfile.toString());  // shell filtered
    expect(returnedIds).not.toContain(staleFederated.toString()); // stale federated filtered
    expect(returnedIds).not.toContain(privateProfile.toString()); // private account filtered
  });

  it('adds the eligibility/quality $match after the $unwind, before the follow-count lookups', async () => {
    mockFollowAggregate.mockResolvedValue([]);

    const res = await requestJson(server, `/profiles/${target.toHexString()}/similar?limit=10`);
    expect(res.status).toBe(200);

    const pipeline = mockFollowAggregate.mock.calls[0][0] as Array<Record<string, unknown>>;

    const unwindIndex = pipeline.findIndex((s) => '$unwind' in s);
    const gateIndex = pipeline.findIndex(
      (s) => '$match' in s && Array.isArray((s.$match as { $and?: unknown[] }).$and)
    );
    const followerLookupIndex = pipeline.findIndex(
      (s) =>
        '$lookup' in s &&
        (s.$lookup as { as?: string }).as === 'followersArr'
    );

    expect(unwindIndex).toBeGreaterThanOrEqual(0);
    expect(gateIndex).toBeGreaterThan(unwindIndex);
    expect(followerLookupIndex).toBeGreaterThan(gateIndex);

    // The gate combines federated-eligibility and profile-quality under `$and`,
    // each contributing its own `$or`. The profile-quality clause requires a
    // non-empty `user.username`.
    const gateMatch = pipeline[gateIndex].$match as {
      $and: Array<Record<string, unknown>>;
      'user.privacySettings.isPrivateAccount'?: { $ne?: boolean };
    };
    expect(gateMatch['user.privacySettings.isPrivateAccount']).toEqual({ $ne: true });

    const usernameClause = gateMatch.$and.find(
      (c) => c['user.username'] !== undefined
    );
    expect(usernameClause?.['user.username']).toEqual(NON_EMPTY_STRING);

    const qualityOr = gateMatch.$and
      .flatMap((c) => (Array.isArray(c.$or) ? (c.$or as Array<Record<string, unknown>>) : []))
      .filter((clause) => clause['user.avatar'] !== undefined);
    expect(qualityOr).toEqual(
      expect.arrayContaining([{ 'user.avatar': NON_EMPTY_STRING }])
    );

    const federatedClause = gateMatch.$and
      .flatMap((c) => (Array.isArray(c.$or) ? (c.$or as Array<Record<string, unknown>>) : []))
      .find((clause) => clause['user.type'] === 'federated');
    expect(federatedClause).toEqual(
      expect.objectContaining({
        'user.type': 'federated',
        'user.federation.actorUri': NON_EMPTY_STRING,
        'user.federation.domain': NON_EMPTY_STRING,
        'user.federation.lastResolvedAt': { $gte: expect.any(Date) },
        'user.federation.unavailableAt': { $exists: false },
      })
    );
  });
});
