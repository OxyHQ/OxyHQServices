/**
 * UserService.getFollowsOfFollowsIds — the viewer's bounded follows-of-follows ids.
 *
 * Follows-of-follows = the union of the accounts followed by the accounts the
 * VIEWER follows (a two-hop walk of the follow graph), MINUS the viewer's own
 * follows and the viewer themselves. This SEEDS Mention's friends-of-friends
 * feed, so the method is lean and ids-only (no hydrated DTOs, no `countDocuments`,
 * no `User` lookup). The viewer id is ALWAYS server-derived (the route resolves
 * it from the auth token via `resolveViewerId`); these tests cover the logic
 * outcomes the route relies on:
 *   - viewer with follows-of-follows → the candidate ids, excluding own
 *     follows/self, ranked by frequency then recency (as the aggregation returns)
 *   - no viewer (anonymous / service token w/o user) → [], zero DB queries
 *   - viewer follows nobody → [] (short-circuits before the aggregation)
 *   - the second hop is seeded by only the MAX_FOF_FIRST_HOP most-recent follows
 *   - an over-cap limit clamps to MAX_FOLLOWS_OF_FOLLOWS_IDS on the returned page
 *
 * Mirrors the `user.service.getMutualUserIds` harness: restore the real
 * `mongoose` (the global setup mocks it wholesale, stripping `Types`) and mock
 * the models as chainable query builders.
 */

// The global jest.setup.cjs mocks `mongoose` wholesale, which strips `Types`
// (and therefore `Types.ObjectId`). This suite only needs the real `Types`
// helper — the models themselves are mocked below — so restore the actual
// mongoose module.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import { Types } from 'mongoose';
import {
  MAX_FOLLOWS_OF_FOLLOWS_IDS,
  MAX_FOF_FIRST_HOP,
} from '../../utils/recommendationWeights';

// Chainable Follow query builder: select/limit/skip/sort return the builder,
// lean() is the terminal awaited result (sequenced per find() call).
const mockFollowLean = jest.fn();
const followQuery = {
  select: jest.fn(() => followQuery),
  limit: jest.fn(() => followQuery),
  skip: jest.fn(() => followQuery),
  sort: jest.fn(() => followQuery),
  lean: mockFollowLean,
};
const mockFollowFind = jest.fn(() => followQuery);
const mockFollowAggregate = jest.fn();
const mockFollowCountDocuments = jest.fn();

const mockUserFind = jest.fn();

jest.mock('../../models/Follow', () => ({
  __esModule: true,
  default: {
    find: mockFollowFind,
    aggregate: mockFollowAggregate,
    countDocuments: mockFollowCountDocuments,
  },
  FollowType: {
    USER: 'user',
    HASHTAG: 'hashtag',
    TOPIC: 'topic',
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    find: mockUserFind,
  },
}));

jest.mock('../../models/Subscription', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../securityActivityService', () => ({
  __esModule: true,
  default: {},
}));

import { UserService } from '../user.service';

interface AggregatePipelineStage {
  $match?: {
    followerUserId?: { $in?: Types.ObjectId[] };
    followType?: string;
    followedId?: { $nin?: Types.ObjectId[] };
  };
  $limit?: number;
}

describe('UserService.getFollowsOfFollowsIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the union of follows-of-follows, excluding own follows and self', async () => {
    const viewerId = new Types.ObjectId().toHexString();

    // The people the viewer follows (first hop).
    const v1 = new Types.ObjectId();
    const v2 = new Types.ObjectId();

    // Two candidates surfaced by the second-hop aggregation (already filtered by
    // the pipeline: v1/v2/self are $nin-excluded server-side by Mongo).
    const fof1 = new Types.ObjectId();
    const fof2 = new Types.ObjectId();

    mockFollowLean.mockResolvedValueOnce([{ followedId: v1 }, { followedId: v2 }]);
    mockFollowAggregate.mockResolvedValueOnce([
      { _id: fof1, followerCount: 2, lastFollowedAt: new Date() },
      { _id: fof2, followerCount: 1, lastFollowedAt: new Date() },
    ]);

    const result = await new UserService().getFollowsOfFollowsIds(viewerId, { limit: 50 });

    // One find (the viewer's following) + one aggregate (the second hop).
    expect(mockFollowFind).toHaveBeenCalledTimes(1);
    expect(mockFollowFind).toHaveBeenCalledWith({
      followerUserId: viewerId,
      followType: 'user',
    });
    expect(followQuery.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(mockFollowAggregate).toHaveBeenCalledTimes(1);

    // Lean, ids-only: no hydration and no count query.
    expect(mockFollowCountDocuments).not.toHaveBeenCalled();
    expect(mockUserFind).not.toHaveBeenCalled();

    // The aggregation seeds the second hop with the viewer's follows and excludes
    // the viewer + everything the viewer already follows.
    const pipeline = mockFollowAggregate.mock.calls[0][0] as AggregatePipelineStage[];
    const matchStage = pipeline[0].$match;
    expect(matchStage?.followerUserId?.$in).toEqual([v1, v2]);
    expect(matchStage?.followType).toBe('user');
    const ninIds = (matchStage?.followedId?.$nin ?? []).map((id) => id.toString());
    expect(ninIds).toContain(viewerId);
    expect(ninIds).toContain(v1.toString());
    expect(ninIds).toContain(v2.toString());

    // Frequency-then-recency order preserved from the aggregation output.
    expect(result).toEqual([fof1.toString(), fof2.toString()]);
  });

  it('returns empty for an anonymous viewer without querying the database', async () => {
    const result = await new UserService().getFollowsOfFollowsIds(undefined, { limit: 50 });

    expect(result).toEqual([]);
    expect(mockFollowFind).not.toHaveBeenCalled();
    expect(mockFollowAggregate).not.toHaveBeenCalled();
  });

  it('returns empty when the viewer follows nobody (short-circuits before the aggregation)', async () => {
    const viewerId = new Types.ObjectId().toHexString();

    mockFollowLean.mockResolvedValueOnce([]);

    const result = await new UserService().getFollowsOfFollowsIds(viewerId, { limit: 50 });

    expect(result).toEqual([]);
    expect(mockFollowFind).toHaveBeenCalledTimes(1);
    expect(mockFollowAggregate).not.toHaveBeenCalled();
  });

  it('seeds the second hop with only the MAX_FOF_FIRST_HOP most-recent follows', async () => {
    const viewerId = new Types.ObjectId().toHexString();

    // Viewer follows more accounts than the first-hop cap.
    const following = Array.from({ length: MAX_FOF_FIRST_HOP + 25 }, () => ({
      followedId: new Types.ObjectId(),
    }));

    mockFollowLean.mockResolvedValueOnce(following);
    mockFollowAggregate.mockResolvedValueOnce([]);

    await new UserService().getFollowsOfFollowsIds(viewerId, { limit: 50 });

    // The following scan is bounded to the following cap...
    expect(followQuery.limit).toHaveBeenCalledWith(MAX_FOLLOWS_OF_FOLLOWS_IDS);

    // ...and only the most-recent MAX_FOF_FIRST_HOP of them seed the second hop.
    const pipeline = mockFollowAggregate.mock.calls[0][0] as AggregatePipelineStage[];
    expect(pipeline[0].$match?.followerUserId?.$in).toHaveLength(MAX_FOF_FIRST_HOP);
    // The exclusion set is the FULL (bounded) following set, not just the sample.
    expect(pipeline[0].$match?.followedId?.$nin).toHaveLength(following.length + 1);
  });

  it('clamps an over-cap limit to MAX_FOLLOWS_OF_FOLLOWS_IDS on the returned page', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    const v1 = new Types.ObjectId();

    mockFollowLean.mockResolvedValueOnce([{ followedId: v1 }]);
    mockFollowAggregate.mockResolvedValueOnce([]);

    await new UserService().getFollowsOfFollowsIds(viewerId, {
      limit: MAX_FOLLOWS_OF_FOLLOWS_IDS * 10,
    });

    // The aggregation's $limit stage caps the returned page to the clamped limit.
    const pipeline = mockFollowAggregate.mock.calls[0][0] as AggregatePipelineStage[];
    const limitStage = pipeline.find((stage) => stage.$limit !== undefined);
    expect(limitStage?.$limit).toBe(MAX_FOLLOWS_OF_FOLLOWS_IDS);
  });
});
