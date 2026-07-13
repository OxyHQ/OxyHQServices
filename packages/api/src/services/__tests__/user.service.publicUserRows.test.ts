/**
 * The PUBLIC user row contract of the follower / following / mutual lists.
 *
 * These three endpoints feed the same UI row across the ecosystem (avatar,
 * display name, handle, bio, verified badge, federated badge). They each used
 * to carry their own hand-written `.select('username name avatar color -email')`
 * projection, which omitted `bio`, `verified` and `federation` — so the API
 * emitted `bio: undefined` on every row while the model, the serializer and the
 * wire contract all had the field. These tests lock the fix: all three query
 * with the ONE shared projection, and the DTO carries the public row fields.
 *
 * Same harness as `user.service.getUserMutuals`: restore the real `mongoose`
 * (the global setup mocks it wholesale, stripping `Types`) and mock the models
 * as chainable query builders. `formatUserResponse` runs for real, so what is
 * asserted below is the exact payload the route returns.
 */

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import { Types } from 'mongoose';

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

const mockUserExec = jest.fn();
const mockUserSelect = jest.fn(() => userQuery);
const userQuery = {
  select: mockUserSelect,
  lean: jest.fn(() => userQuery),
  exec: mockUserExec,
};
const mockUserFind = jest.fn(() => userQuery);

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
import { PUBLIC_USER_PROFILE_SELECT } from '../../utils/publicUserProjection';

/** A federated row: bio + verified + remote-actor info must all survive. */
function federatedUserDoc(id: Types.ObjectId) {
  return {
    _id: id,
    username: 'remote',
    name: { first: 'Remote', last: 'Friend' },
    avatar: 'https://mastodon.social/avatars/remote.png',
    color: 'blue',
    bio: 'Bio that the rows never used to receive.',
    description: 'A longer public description.',
    verified: true,
    type: 'federated',
    federation: { actorUri: 'https://mastodon.social/users/remote', domain: 'mastodon.social' },
    privacySettings: { fediverseSharing: true },
  };
}

describe('public user row projection (followers / following / mutuals)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('projects the shared public-row field set on getUserFollowers and emits the full DTO', async () => {
    const targetId = new Types.ObjectId().toHexString();
    const followerId = new Types.ObjectId();

    mockFollowCountDocuments.mockResolvedValueOnce(1);
    mockFollowLean.mockResolvedValueOnce([{ followerUserId: followerId }]);
    mockUserExec.mockResolvedValueOnce([federatedUserDoc(followerId)]);

    const result = await new UserService().getUserFollowers(targetId, { limit: 50, offset: 0 });

    expect(mockUserSelect).toHaveBeenCalledWith(PUBLIC_USER_PROFILE_SELECT);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: followerId.toHexString(),
      username: 'remote',
      bio: 'Bio that the rows never used to receive.',
      description: 'A longer public description.',
      verified: true,
      isFederated: true,
      federation: { domain: 'mastodon.social' },
    });
  });

  it('projects the shared public-row field set on getUserFollowing and emits the full DTO', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    const followedId = new Types.ObjectId();

    mockFollowCountDocuments.mockResolvedValueOnce(1);
    mockFollowLean.mockResolvedValueOnce([{ followedId }]);
    mockUserExec.mockResolvedValueOnce([federatedUserDoc(followedId)]);

    const result = await new UserService().getUserFollowing(viewerId, { limit: 50, offset: 0 });

    expect(mockUserSelect).toHaveBeenCalledWith(PUBLIC_USER_PROFILE_SELECT);
    expect(result.data[0]).toMatchObject({
      id: followedId.toHexString(),
      bio: 'Bio that the rows never used to receive.',
      verified: true,
      isFederated: true,
    });
  });

  it('projects the shared public-row field set on getUserMutuals and emits the full DTO', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    const targetId = new Types.ObjectId().toHexString();
    const mutualId = new Types.ObjectId();

    mockFollowLean
      .mockResolvedValueOnce([{ followedId: mutualId }])
      .mockResolvedValueOnce([{ followerUserId: mutualId }]);
    mockFollowCountDocuments.mockResolvedValueOnce(1);
    mockUserExec.mockResolvedValueOnce([federatedUserDoc(mutualId)]);

    const result = await new UserService().getUserMutuals(viewerId, targetId, {
      limit: 50,
      offset: 0,
    });

    expect(mockUserSelect).toHaveBeenCalledWith(PUBLIC_USER_PROFILE_SELECT);
    expect(result.data[0]).toMatchObject({
      id: mutualId.toHexString(),
      bio: 'Bio that the rows never used to receive.',
      verified: true,
      isFederated: true,
    });
  });

  it('keeps private fields out of the projection', () => {
    const paths = PUBLIC_USER_PROFILE_SELECT.split(' ');

    // Inclusion-only projection: anything not listed cannot reach the row.
    expect(paths).not.toContain('email');
    expect(paths).not.toContain('phone');
    expect(paths).not.toContain('password');
    expect(paths).not.toContain('refreshToken');
    // Only the public, derived consent flag — never the whole settings subdoc.
    expect(paths).not.toContain('privacySettings');
    expect(paths).toContain('privacySettings.fediverseSharing');
  });
});
