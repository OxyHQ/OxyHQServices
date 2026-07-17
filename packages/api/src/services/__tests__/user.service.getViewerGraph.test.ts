/**
 * UserService.getViewerGraph — the viewer's OWN social graph in one payload.
 *
 * `getViewerGraph` consolidates three per-viewer reads into a single call:
 *   - `followingIds` — the accounts the viewer follows (eligibility-filtered aggregate)
 *   - `mutualIds`    — the subset who follow back, REUSING `getMutualUserIds`
 *   - `blockedIds`   — the accounts the viewer has blocked (`Block.find({ userId })`)
 */

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import { Types } from 'mongoose';
import { MAX_FOLLOWING_IDS, MAX_BLOCKED_IDS } from '../../utils/recommendationWeights';

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

const mockBlockLean = jest.fn();
const blockQuery = {
  select: jest.fn(() => blockQuery),
  limit: jest.fn(() => blockQuery),
  lean: mockBlockLean,
};
const mockBlockFind = jest.fn(() => blockQuery);

const mockUserFindLean = jest.fn();
const mockUserFind = jest.fn(() => ({
  select: jest.fn(() => ({
    lean: mockUserFindLean,
  })),
}));

jest.mock('../../models/Follow', () => ({
  __esModule: true,
  default: {
    find: mockFollowFind,
    aggregate: mockFollowAggregate,
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

    const f1 = new Types.ObjectId();
    const f2 = new Types.ObjectId();
    const b1 = new Types.ObjectId();

    mockFollowAggregate
      .mockResolvedValueOnce([{ total: 2 }])
      .mockResolvedValueOnce([{ userId: f1 }, { userId: f2 }]);

    mockFollowLean
      .mockResolvedValueOnce([{ followedId: f1 }, { followedId: f2 }])
      .mockResolvedValueOnce([{ followerUserId: f1 }]);

    mockUserFindLean.mockResolvedValueOnce([{ _id: f1 }]);
    mockBlockLean.mockResolvedValueOnce([{ blockedId: b1 }]);

    const result = await new UserService().getViewerGraph(viewerId);

    expect(result).toEqual({
      followingIds: [f1.toString(), f2.toString()],
      mutualIds: [f1.toString()],
      blockedIds: [b1.toString()],
    });

    expect(mockBlockFind).toHaveBeenCalledWith({ userId: viewerId });
    expect(mockFollowAggregate).toHaveBeenCalledTimes(2);
  });

  it('returns an all-empty graph for an anonymous viewer without querying the database', async () => {
    const result = await new UserService().getViewerGraph(undefined);

    expect(result).toEqual({ followingIds: [], mutualIds: [], blockedIds: [] });
    expect(mockFollowFind).not.toHaveBeenCalled();
    expect(mockFollowAggregate).not.toHaveBeenCalled();
    expect(mockBlockFind).not.toHaveBeenCalled();
  });

  it('bounds the following and blocked scans by their caps', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    const f1 = new Types.ObjectId();

    mockFollowAggregate
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ userId: f1 }]);
    mockFollowLean.mockResolvedValueOnce([]);
    mockBlockLean.mockResolvedValueOnce([]);

    await new UserService().getViewerGraph(viewerId, {
      followingLimit: MAX_FOLLOWING_IDS * 10,
      blockedLimit: MAX_BLOCKED_IDS * 10,
    });

    const pagePipeline = mockFollowAggregate.mock.calls[1]?.[0] as Array<{ $limit?: number }>;
    expect(pagePipeline?.find((stage) => stage.$limit !== undefined)?.$limit).toBe(MAX_FOLLOWING_IDS);
    expect(blockQuery.limit).toHaveBeenCalledWith(MAX_BLOCKED_IDS);
  });
});
