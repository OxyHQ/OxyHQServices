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

describe('UserService.getViewerRelationship', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFollowFindLean.mockResolvedValue([]);
  });

  it('returns both directional flags when mutual follow edges exist', async () => {
    const viewer = new Types.ObjectId();
    const target = new Types.ObjectId();

    mockFollowFindLean.mockResolvedValue([
      { followerUserId: viewer, followedId: target },
      { followerUserId: target, followedId: viewer },
    ]);

    const result = await new UserService().getViewerRelationship(
      viewer.toHexString(),
      target.toHexString(),
    );

    expect(result).toEqual({ isFollowing: true, followsYou: true });
    expect(mockFollowFind).toHaveBeenCalledWith({
      followType: 'user',
      $or: [
        { followerUserId: viewer.toHexString(), followedId: target.toHexString() },
        { followerUserId: target.toHexString(), followedId: viewer.toHexString() },
      ],
    });
    expect(mockFollowFindSelect).toHaveBeenCalledWith('followerUserId followedId');
  });

  it('returns isFollowing only when the viewer follows the target', async () => {
    const viewer = new Types.ObjectId();
    const target = new Types.ObjectId();

    mockFollowFindLean.mockResolvedValue([
      { followerUserId: viewer, followedId: target },
    ]);

    const result = await new UserService().getViewerRelationship(
      viewer.toHexString(),
      target.toHexString(),
    );

    expect(result).toEqual({ isFollowing: true, followsYou: false });
  });

  it('returns followsYou only when the target follows the viewer', async () => {
    const viewer = new Types.ObjectId();
    const target = new Types.ObjectId();

    mockFollowFindLean.mockResolvedValue([
      { followerUserId: target, followedId: viewer },
    ]);

    const result = await new UserService().getViewerRelationship(
      viewer.toHexString(),
      target.toHexString(),
    );

    expect(result).toEqual({ isFollowing: false, followsYou: true });
  });

  it('returns both false when no follow edges exist', async () => {
    const viewer = new Types.ObjectId();
    const target = new Types.ObjectId();

    const result = await new UserService().getViewerRelationship(
      viewer.toHexString(),
      target.toHexString(),
    );

    expect(result).toEqual({ isFollowing: false, followsYou: false });
  });
});
