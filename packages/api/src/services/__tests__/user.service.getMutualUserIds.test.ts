/**
 * UserService.getMutualUserIds — the viewer's OWN mutual-follow ids.
 *
 * Mutual ids = the accounts the VIEWER follows that ALSO follow the viewer back
 * (the SELF intersection `following(viewer) ∩ followers(viewer)`). This powers
 * Mention's "Mutuals" feed, so the method is lean and ids-only (no hydrated DTOs,
 * no `countDocuments`, no `User` lookup). The viewer id is ALWAYS server-derived
 * (the route resolves it from the auth token via `resolveViewerId`); these tests
 * cover the logic outcomes the route relies on:
 *   - viewer with a mutual → the mutual's id, from the two-step Follow query
 *   - no viewer (anonymous / service token w/o user) → [], zero DB queries
 *   - viewer follows nobody → [] (short-circuits before the second query)
 *   - viewer shares no follow-back with anyone they follow → [] (empty page 2)
 *   - an over-cap limit clamps to MAX_MUTUAL_IDS on the returned page
 *
 * Mirrors the `user.service.getUserMutuals` harness: restore the real `mongoose`
 * (the global setup mocks it wholesale, stripping `Types`) and mock the models as
 * chainable query builders.
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
import { MAX_MUTUAL_IDS } from '../../utils/recommendationWeights';

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

const mockUserFind = jest.fn();

jest.mock('../../models/Follow', () => ({
  __esModule: true,
  default: {
    find: mockFollowFind,
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

describe('UserService.getMutualUserIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the ids of accounts the viewer follows that follow back', async () => {
    const viewerId = new Types.ObjectId().toHexString();

    // V = the people the viewer follows.
    const v1 = new Types.ObjectId();
    const v2 = new Types.ObjectId();
    // v1 follows the viewer back (mutual); v2 does not.

    mockFollowLean
      // 1) viewer's following set
      .mockResolvedValueOnce([{ followedId: v1 }, { followedId: v2 }])
      // 2) of those, the ones who follow the viewer back
      .mockResolvedValueOnce([{ followerUserId: v1 }]);

    const result = await new UserService().getMutualUserIds(viewerId, { limit: 50 });

    // Two-step Follow query, self-directed (target === viewer), ids only.
    expect(mockFollowFind).toHaveBeenCalledTimes(2);
    expect(mockFollowFind).toHaveBeenNthCalledWith(1, {
      followerUserId: viewerId,
      followType: 'user',
    });
    expect(mockFollowFind).toHaveBeenNthCalledWith(2, {
      followedId: viewerId,
      followType: 'user',
      followerUserId: { $in: [v1, v2] },
    });

    // Lean, ids-only: no hydration and no count query.
    expect(mockFollowCountDocuments).not.toHaveBeenCalled();
    expect(mockUserFind).not.toHaveBeenCalled();

    expect(result).toEqual([v1.toString()]);
  });

  it('returns empty for an anonymous viewer without querying the database', async () => {
    const result = await new UserService().getMutualUserIds(undefined, { limit: 50 });

    expect(result).toEqual([]);
    expect(mockFollowFind).not.toHaveBeenCalled();
  });

  it('returns empty when the viewer follows nobody (short-circuits before the second query)', async () => {
    const viewerId = new Types.ObjectId().toHexString();

    mockFollowLean.mockResolvedValueOnce([]);

    const result = await new UserService().getMutualUserIds(viewerId, { limit: 50 });

    expect(result).toEqual([]);
    expect(mockFollowFind).toHaveBeenCalledTimes(1);
  });

  it('returns empty when none of the viewer\'s followed accounts follow back', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    const v1 = new Types.ObjectId();

    mockFollowLean
      .mockResolvedValueOnce([{ followedId: v1 }])
      .mockResolvedValueOnce([]);

    const result = await new UserService().getMutualUserIds(viewerId, { limit: 50 });

    expect(result).toEqual([]);
    expect(mockFollowFind).toHaveBeenCalledTimes(2);
  });

  it('clamps an over-cap limit to MAX_MUTUAL_IDS on the returned page', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    const v1 = new Types.ObjectId();

    mockFollowLean
      .mockResolvedValueOnce([{ followedId: v1 }])
      .mockResolvedValueOnce([{ followerUserId: v1 }]);

    await new UserService().getMutualUserIds(viewerId, { limit: MAX_MUTUAL_IDS * 10 });

    // Page 1 bounds the following scan to MAX_MUTUAL_IDS; page 2 caps the
    // returned ids to the clamped limit (also MAX_MUTUAL_IDS here).
    expect(followQuery.limit.mock.calls).toEqual([[MAX_MUTUAL_IDS], [MAX_MUTUAL_IDS]]);
  });
});
