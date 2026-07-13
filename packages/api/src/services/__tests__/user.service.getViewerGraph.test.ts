/**
 * UserService.getViewerGraph — the viewer's OWN social graph in one payload.
 *
 * `getViewerGraph` consolidates three per-viewer reads into a single call:
 *   - `followingIds` — the accounts the viewer follows (one bounded Follow query)
 *   - `mutualIds`    — the subset who follow back, REUSING `getMutualUserIds`
 *     (its own two-step Follow query)
 *   - `blockedIds`   — the accounts the viewer has blocked (`Block.find({ userId })`)
 *
 * These tests cover the outcomes the `GET /users/me/graph` route relies on:
 *   - a populated viewer → the three lists, ids-only, from the parallel reads
 *   - no viewer (anonymous / service token w/o user) → all-empty, zero DB queries
 *   - the following and blocked scans are bounded by their caps
 *
 * Mirrors the `getMutualUserIds` harness: restore the real `mongoose` (the global
 * setup mocks it wholesale, stripping `Types`) and mock the models as chainable
 * query builders. `Follow.find` is shared across the following + mutual queries,
 * so `lean()` results are sequenced by invocation order:
 *   1) graph following  2) mutuals: viewer-following  3) mutuals: follow-back.
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
import { MAX_FOLLOWING_IDS, MAX_BLOCKED_IDS } from '../../utils/recommendationWeights';

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

// Chainable Block query builder (blocked-ids read).
const mockBlockLean = jest.fn();
const blockQuery = {
  select: jest.fn(() => blockQuery),
  limit: jest.fn(() => blockQuery),
  lean: mockBlockLean,
};
const mockBlockFind = jest.fn(() => blockQuery);

const mockUserFind = jest.fn();

jest.mock('../../models/Follow', () => ({
  __esModule: true,
  default: {
    find: mockFollowFind,
  },
  FollowType: {
    USER: 'user',
    HASHTAG: 'hashtag',
    TOPIC: 'topic',
  },
}));

jest.mock('../../models/Block', () => ({
  __esModule: true,
  default: {
    find: mockBlockFind,
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

// getViewerGraph never touches the cache (only the write paths do), but
// user.service imports it at module load — stub it so the suite never reaches
// the Redis config layer.
jest.mock('../../utils/graphCache', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
  },
}));

jest.mock('../securityActivityService', () => ({
  __esModule: true,
  default: {},
}));

import { UserService } from '../user.service';

describe('UserService.getViewerGraph', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns following, mutual, and blocked ids from the parallel reads', async () => {
    const viewerId = new Types.ObjectId().toHexString();

    const f1 = new Types.ObjectId(); // followed AND follows back → mutual
    const f2 = new Types.ObjectId(); // followed only
    const b1 = new Types.ObjectId(); // blocked

    mockFollowLean
      // 1) graph: the viewer's following set
      .mockResolvedValueOnce([{ followedId: f1 }, { followedId: f2 }])
      // 2) mutuals: the viewer's following set (getMutualUserIds' first query)
      .mockResolvedValueOnce([{ followedId: f1 }, { followedId: f2 }])
      // 3) mutuals: of those, the ones who follow the viewer back
      .mockResolvedValueOnce([{ followerUserId: f1 }]);

    mockBlockLean.mockResolvedValueOnce([{ blockedId: b1 }]);

    const result = await new UserService().getViewerGraph(viewerId);

    expect(result).toEqual({
      followingIds: [f1.toString(), f2.toString()],
      mutualIds: [f1.toString()],
      blockedIds: [b1.toString()],
    });

    // Blocked read is scoped to the viewer, ids-only, and never hydrates users.
    expect(mockBlockFind).toHaveBeenCalledWith({ userId: viewerId });
    expect(mockUserFind).not.toHaveBeenCalled();
  });

  it('returns an all-empty graph for an anonymous viewer without querying the database', async () => {
    const result = await new UserService().getViewerGraph(undefined);

    expect(result).toEqual({ followingIds: [], mutualIds: [], blockedIds: [] });
    expect(mockFollowFind).not.toHaveBeenCalled();
    expect(mockBlockFind).not.toHaveBeenCalled();
  });

  it('bounds the following and blocked scans by their caps', async () => {
    const viewerId = new Types.ObjectId().toHexString();

    mockFollowLean
      .mockResolvedValueOnce([]) // graph following
      .mockResolvedValueOnce([]); // mutuals following (short-circuits before back query)
    mockBlockLean.mockResolvedValueOnce([]);

    await new UserService().getViewerGraph(viewerId, {
      followingLimit: MAX_FOLLOWING_IDS * 10,
      blockedLimit: MAX_BLOCKED_IDS * 10,
    });

    // The graph following scan (first Follow.find) is clamped to the cap.
    expect(followQuery.limit).toHaveBeenNthCalledWith(1, MAX_FOLLOWING_IDS);
    // The blocked scan is clamped to the cap.
    expect(blockQuery.limit).toHaveBeenCalledWith(MAX_BLOCKED_IDS);
  });
});
