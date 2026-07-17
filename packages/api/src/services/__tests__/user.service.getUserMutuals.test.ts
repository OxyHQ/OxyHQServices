/**
 * UserService.getUserMutuals — "followers you know" tests.
 *
 * Mutuals = users U such that the VIEWER follows U AND U follows the target.
 * The viewer id is ALWAYS server-derived (the route resolves it from the auth
 * token via `resolveViewerId` and hands it to this method); these tests cover
 * the four logic outcomes the route relies on:
 *   - viewer with overlap → correct list + total (most-recent mutual first)
 *   - no viewer (anonymous / service token w/o user) → empty, zero DB queries
 *   - self-target (viewer === target) → empty, zero DB queries
 *   - viewer follows nobody → empty (short-circuits before count/user fetch)
 *
 * Mirrors the `user.service.bulkUnfollow` harness: restore the real `mongoose`
 * (the global setup mocks it wholesale, stripping `Types`) and mock the models
 * as chainable query builders. `formatUserResponse`/`displayName` run for real
 * so the emitted DTO is the exact public shape the route returns.
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
const mockFollowCountDocuments = jest.fn();
const mockFollowAggregate = jest.fn();

// Chainable User query builder: select/lean return the builder, exec() is the
// terminal awaited result.
const mockUserExec = jest.fn();
const userQuery = {
  select: jest.fn(() => userQuery),
  lean: jest.fn(() => userQuery),
  exec: mockUserExec,
};
const mockUserFind = jest.fn(() => userQuery);

jest.mock('../../models/Follow', () => ({
  __esModule: true,
  default: {
    find: mockFollowFind,
    countDocuments: mockFollowCountDocuments,
    aggregate: (...args: unknown[]) => mockFollowAggregate(...args),
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

describe('UserService.getUserMutuals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the mutual followers (viewer follows them AND they follow target) with total', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    const targetId = new Types.ObjectId().toHexString();

    // V = the people the viewer follows.
    const v1 = new Types.ObjectId();
    const v2 = new Types.ObjectId();
    // Mutual = a target-follower that is also in V.
    const mutual = new Types.ObjectId();

    mockFollowLean
      // 1) viewer's following set
      .mockResolvedValueOnce([{ followedId: v1 }, { followedId: v2 }]);
    mockFollowAggregate
      // 2) visible mutual count + page
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ userId: mutual }]);
    mockUserExec.mockResolvedValueOnce([
      {
        _id: mutual,
        username: 'mutualfriend',
        name: { first: 'Mutual', last: 'Friend' },
        avatar: 'file-mutual',
        color: '#3b82f6',
      },
    ]);

    const result = await new UserService().getUserMutuals(viewerId, targetId, {
      limit: 50,
      offset: 0,
    });

    expect(mockFollowFind).toHaveBeenCalledTimes(1);
    expect(mockFollowFind).toHaveBeenCalledWith({
      followerUserId: viewerId,
      followType: 'user',
    });
    expect(mockFollowAggregate).toHaveBeenCalledTimes(2);

    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: mutual.toHexString(),
      username: 'mutualfriend',
      avatar: 'file-mutual',
      color: '#3b82f6',
    });
    expect(typeof result.data[0].name.displayName).toBe('string');
    expect(result.data[0].name.displayName.length).toBeGreaterThan(0);
  });

  it('returns empty for an anonymous viewer without querying the database', async () => {
    const targetId = new Types.ObjectId().toHexString();

    const result = await new UserService().getUserMutuals(undefined, targetId, {
      limit: 50,
      offset: 0,
    });

    expect(result).toEqual({ data: [], total: 0, hasMore: false, limit: 50, offset: 0 });
    expect(mockFollowFind).not.toHaveBeenCalled();
    expect(mockFollowCountDocuments).not.toHaveBeenCalled();
    expect(mockUserFind).not.toHaveBeenCalled();
  });

  it('returns empty when the viewer is the target (no mutuals with yourself)', async () => {
    const sameId = new Types.ObjectId().toHexString();

    const result = await new UserService().getUserMutuals(sameId, sameId, {
      limit: 50,
      offset: 0,
    });

    expect(result).toEqual({ data: [], total: 0, hasMore: false, limit: 50, offset: 0 });
    expect(mockFollowFind).not.toHaveBeenCalled();
    expect(mockFollowCountDocuments).not.toHaveBeenCalled();
    expect(mockUserFind).not.toHaveBeenCalled();
  });

  it('returns empty when the viewer follows nobody (short-circuits before count/user fetch)', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    const targetId = new Types.ObjectId().toHexString();

    mockFollowLean.mockResolvedValueOnce([]);

    const result = await new UserService().getUserMutuals(viewerId, targetId, {
      limit: 50,
      offset: 0,
    });

    expect(result).toEqual({ data: [], total: 0, hasMore: false, limit: 50, offset: 0 });
    expect(mockFollowFind).toHaveBeenCalledTimes(1);
    expect(mockFollowCountDocuments).not.toHaveBeenCalled();
    expect(mockUserFind).not.toHaveBeenCalled();
  });

  it('returns empty when the viewer shares no followers with the target (total 0)', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    const targetId = new Types.ObjectId().toHexString();
    const v1 = new Types.ObjectId();

    mockFollowLean.mockResolvedValueOnce([{ followedId: v1 }]);
    mockFollowAggregate.mockResolvedValueOnce([]);

    const result = await new UserService().getUserMutuals(viewerId, targetId, {
      limit: 50,
      offset: 0,
    });

    expect(result).toEqual({ data: [], total: 0, hasMore: false, limit: 50, offset: 0 });
    expect(mockFollowFind).toHaveBeenCalledTimes(1);
    expect(mockFollowAggregate).toHaveBeenCalledTimes(1);
    expect(mockUserFind).not.toHaveBeenCalled();
  });
});
