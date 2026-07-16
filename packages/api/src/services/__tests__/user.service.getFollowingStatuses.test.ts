// The global jest.setup.cjs mocks `mongoose` wholesale, which strips `Types`
// (and therefore `Types.ObjectId`). This suite needs the real `Types` helper —
// the models themselves are mocked below — so restore the actual mongoose.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import { Types } from 'mongoose';

const mockFollowFindLean = jest.fn();
const mockFollowFindSelect = jest.fn(() => ({ lean: mockFollowFindLean }));
const mockFollowFind = jest.fn(() => ({ select: mockFollowFindSelect }));

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

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {},
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

describe('UserService.getFollowingStatuses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFollowFindLean.mockResolvedValue([]);
  });

  it('maps every requested id to a boolean — followed ids true, the rest false', async () => {
    const viewer = new Types.ObjectId().toHexString();
    const followed = new Types.ObjectId();
    const notFollowed = new Types.ObjectId();

    mockFollowFindLean.mockResolvedValue([{ followedId: followed }]);

    const result = await new UserService().getFollowingStatuses(viewer, [
      followed.toHexString(),
      notFollowed.toHexString(),
    ]);

    expect(mockFollowFind).toHaveBeenCalledTimes(1);
    expect(mockFollowFind).toHaveBeenCalledWith({
      followerUserId: viewer,
      followType: 'user',
      followedId: { $in: [followed.toHexString(), notFollowed.toHexString()] },
    });
    expect(result).toEqual({
      [followed.toHexString()]: true,
      [notFollowed.toHexString()]: false,
    });
  });

  it('runs at most ONE query regardless of N', async () => {
    const viewer = new Types.ObjectId().toHexString();
    const ids = Array.from({ length: 50 }, () => new Types.ObjectId().toHexString());

    mockFollowFindLean.mockResolvedValue([]);

    const result = await new UserService().getFollowingStatuses(viewer, ids);

    expect(mockFollowFind).toHaveBeenCalledTimes(1);
    expect(Object.keys(result)).toHaveLength(50);
    expect(Object.values(result).every((v) => v === false)).toBe(true);
  });

  it('defaults structurally-invalid ids to false and never puts them in the query', async () => {
    const viewer = new Types.ObjectId().toHexString();
    const valid = new Types.ObjectId();

    mockFollowFindLean.mockResolvedValue([{ followedId: valid }]);

    const result = await new UserService().getFollowingStatuses(viewer, [
      valid.toHexString(),
      'not-an-object-id',
    ]);

    expect(mockFollowFind).toHaveBeenCalledWith({
      followerUserId: viewer,
      followType: 'user',
      followedId: { $in: [valid.toHexString()] },
    });
    expect(result).toEqual({
      [valid.toHexString()]: true,
      'not-an-object-id': false,
    });
  });

  it('dedupes requested ids while still mapping each requested id', async () => {
    const viewer = new Types.ObjectId().toHexString();
    const id = new Types.ObjectId();

    mockFollowFindLean.mockResolvedValue([{ followedId: id }]);

    const result = await new UserService().getFollowingStatuses(viewer, [
      id.toHexString(),
      id.toHexString(),
    ]);

    expect(mockFollowFind).toHaveBeenCalledWith({
      followerUserId: viewer,
      followType: 'user',
      followedId: { $in: [id.toHexString()] },
    });
    expect(result).toEqual({ [id.toHexString()]: true });
  });

  it('returns all-false with NO query for an anonymous viewer', async () => {
    const target = new Types.ObjectId().toHexString();

    const result = await new UserService().getFollowingStatuses('', [target]);

    expect(mockFollowFind).not.toHaveBeenCalled();
    expect(result).toEqual({ [target]: false });
  });

  it('returns {} with NO query for an empty id set', async () => {
    const viewer = new Types.ObjectId().toHexString();

    const result = await new UserService().getFollowingStatuses(viewer, []);

    expect(mockFollowFind).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });
});
