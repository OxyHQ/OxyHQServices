/**
 * UserService follow-graph ordering — the `$sort` stage actually handed to Mongo.
 *
 * The route tests prove `sort` reaches the service; these prove the service
 * turns it into the right pipeline stage, and in particular that the sort key
 * carries the `_id` TIEBREAK.
 *
 * Why the tiebreak matters: `createdAt` alone is not unique, and an unstable
 * sort under `$skip`/`$limit` lets a tied document surface on two consecutive
 * pages while another is skipped entirely. Measured against a real mongod on 40
 * followers sharing one `createdAt`, walking four pages of ten returned only 22
 * DISTINCT users out of 40 under the old `{createdAt:-1}` sort, and a clean
 * 40/40 once `_id` was appended.
 *
 * Harness mirrors `user.service.getUserMutuals` — restore the real `mongoose`
 * (the global setup mocks it wholesale, stripping `Types`) and mock the models
 * as chainable query builders.
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
const mockFollowAggregate = jest.fn();

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
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: { find: mockUserFind },
}));

jest.mock('../../models/Subscription', () => ({ __esModule: true, default: {} }));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/userCache', () => ({ __esModule: true, default: {} }));
jest.mock('../securityActivityService', () => ({ __esModule: true, default: {} }));

import { UserService } from '../user.service';

/** The `$sort` stage of the PAGE aggregation (the 2nd `aggregate` call). */
function pageSortStage(): Record<string, number> {
  const pagePipeline = mockFollowAggregate.mock.calls[1][0] as Array<Record<string, unknown>>;
  const stage = pagePipeline.find((s) => '$sort' in s);
  if (!stage) {
    throw new Error('page pipeline has no $sort stage');
  }
  return stage.$sort as Record<string, number>;
}

/** Prime the mocks for one page that resolves to a single user. */
function primeOnePage(): Types.ObjectId {
  const hit = new Types.ObjectId();
  mockFollowAggregate
    .mockResolvedValueOnce([{ total: 1 }])
    .mockResolvedValueOnce([{ userId: hit }]);
  mockUserExec.mockResolvedValueOnce([
    { _id: hit, username: 'someone', name: { first: 'Some', last: 'One' }, color: '#3b82f6' },
  ]);
  return hit;
}

describe('UserService follow-graph $sort stage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe.each([
    ['getUserFollowers', (svc: UserService, id: string, sort?: 'recent' | 'oldest') =>
      svc.getUserFollowers(id, { limit: 50, offset: 0, sort })],
    ['getUserFollowing', (svc: UserService, id: string, sort?: 'recent' | 'oldest') =>
      svc.getUserFollowing(id, { limit: 50, offset: 0, sort })],
  ])('%s', (_label, call) => {
    it('defaults to newest-first with an _id tiebreak', async () => {
      primeOnePage();
      await call(new UserService(), new Types.ObjectId().toHexString(), undefined);

      expect(pageSortStage()).toEqual({ createdAt: -1, _id: -1 });
    });

    it('sorts newest-first for sort=recent', async () => {
      primeOnePage();
      await call(new UserService(), new Types.ObjectId().toHexString(), 'recent');

      expect(pageSortStage()).toEqual({ createdAt: -1, _id: -1 });
    });

    it('sorts oldest-first for sort=oldest, mirroring BOTH keys', async () => {
      primeOnePage();
      await call(new UserService(), new Types.ObjectId().toHexString(), 'oldest');

      // Both keys flip, so `oldest` is the exact reverse of `recent` rather
      // than a different order that merely starts at the other end.
      expect(pageSortStage()).toEqual({ createdAt: 1, _id: 1 });
    });

    it('always includes a unique tiebreak, whatever the ordering', async () => {
      for (const sort of ['recent', 'oldest'] as const) {
        jest.clearAllMocks();
        primeOnePage();
        await call(new UserService(), new Types.ObjectId().toHexString(), sort);

        const keys = Object.keys(pageSortStage());
        expect(keys).toContain('_id');
        expect(keys[keys.length - 1]).toBe('_id');
      }
    });
  });

  describe('getUserMutuals', () => {
    it('threads sort through to the mutuals page pipeline', async () => {
      const viewerId = new Types.ObjectId().toHexString();
      const targetId = new Types.ObjectId().toHexString();

      mockFollowLean.mockResolvedValueOnce([{ followedId: new Types.ObjectId() }]);
      primeOnePage();

      await new UserService().getUserMutuals(viewerId, targetId, {
        limit: 50,
        offset: 0,
        sort: 'oldest',
      });

      expect(pageSortStage()).toEqual({ createdAt: 1, _id: 1 });
    });
  });
});
