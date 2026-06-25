// The global jest.setup.cjs mocks `mongoose` wholesale, which strips `Types`
// (and therefore `Types.ObjectId`). This suite only needs the real `Types`
// helper — the models themselves are mocked below — so restore the actual
// mongoose module.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import { Types } from 'mongoose';

const mockFollowFindLean = jest.fn();
const mockFollowFindSelect = jest.fn(() => ({ lean: mockFollowFindLean }));
const mockFollowFind = jest.fn(() => ({ select: mockFollowFindSelect }));
const mockFollowFindOneAndDeleteLean = jest.fn();
const mockFollowFindOneAndDeleteSelect = jest.fn(() => ({ lean: mockFollowFindOneAndDeleteLean }));
const mockFollowFindOneAndDelete = jest.fn(() => ({ select: mockFollowFindOneAndDeleteSelect }));

const mockUserUpdateMany = jest.fn();
const mockUserFindByIdAndUpdate = jest.fn();

jest.mock('../../models/Follow', () => ({
  __esModule: true,
  default: {
    find: mockFollowFind,
    findOneAndDelete: mockFollowFindOneAndDelete,
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
    updateMany: mockUserUpdateMany,
    findByIdAndUpdate: mockUserFindByIdAndUpdate,
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

describe('UserService.bulkUnfollow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserUpdateMany.mockResolvedValue({ modifiedCount: 1 });
    mockUserFindByIdAndUpdate.mockResolvedValue(null);
  });

  it('decrements counters only for follow documents actually deleted', async () => {
    const currentUserId = new Types.ObjectId().toHexString();
    const targetDeleted = new Types.ObjectId();
    const targetRaced = new Types.ObjectId();

    mockFollowFindLean.mockResolvedValue([
      { followedId: targetDeleted },
      { followedId: targetRaced },
    ]);
    mockFollowFindOneAndDeleteLean
      .mockResolvedValueOnce({ followedId: targetDeleted })
      .mockResolvedValueOnce(null);

    const result = await new UserService().bulkUnfollow(currentUserId, [
      targetDeleted.toHexString(),
      targetRaced.toHexString(),
    ]);

    expect(mockFollowFindOneAndDelete).toHaveBeenCalledTimes(2);
    expect(mockUserUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUserUpdateMany).toHaveBeenCalledWith(
      { _id: { $in: [targetDeleted.toHexString()] } },
      { $inc: { '_count.followers': -1 } }
    );
    expect(mockUserFindByIdAndUpdate).toHaveBeenCalledWith(currentUserId, {
      $inc: { '_count.following': -1 },
    });
    expect(result.unfollowedCount).toBe(1);
    expect(result.results).toEqual([
      { userId: targetDeleted.toHexString(), success: true, wasFollowing: true },
      { userId: targetRaced.toHexString(), success: true, wasFollowing: false },
    ]);
  });

  it('does not decrement counters when all observed follows were already removed by a race', async () => {
    const currentUserId = new Types.ObjectId().toHexString();
    const targetId = new Types.ObjectId();

    mockFollowFindLean.mockResolvedValue([{ followedId: targetId }]);
    mockFollowFindOneAndDeleteLean.mockResolvedValueOnce(null);

    const result = await new UserService().bulkUnfollow(currentUserId, [targetId.toHexString()]);

    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    expect(mockUserFindByIdAndUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({
      results: [{ userId: targetId.toHexString(), success: true, wasFollowing: false }],
      unfollowedCount: 0,
    });
  });
});
