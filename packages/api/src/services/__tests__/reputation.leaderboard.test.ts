/**
 * getLeaderboard eligibility tests.
 *
 * The public trust leaderboard must exclude archived accounts and users in the
 * punitive `restricted` reputation tier — the same gates people search applies.
 */

import { Types } from 'mongoose';

const mockAggregate = jest.fn();

jest.mock('../../models/ReputationBalance', () => ({
  __esModule: true,
  ReputationBalance: {
    aggregate: (...args: unknown[]) => mockAggregate(...args),
  },
}));
jest.mock('../../models/ReputationTransaction', () => ({
  __esModule: true,
  ReputationTransaction: {},
}));
jest.mock('../../models/ReputationRule', () => ({
  __esModule: true,
  ReputationRule: {},
}));
jest.mock('../../models/ReputationDispute', () => ({
  __esModule: true,
  ReputationDispute: {},
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {},
}));
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  const startSession = jest.fn(async () => ({
    withTransaction: async (fn: () => Promise<unknown>) => fn(),
    endSession: async () => undefined,
  }));
  const patched = { ...actual, startSession };
  return { __esModule: true, ...patched, default: patched };
});

import reputationService from '../reputation.service';

const ACTIVE_USER_ID = new Types.ObjectId();
const ARCHIVED_USER_ID = new Types.ObjectId();
const RESTRICTED_USER_ID = new Types.ObjectId();

function eligibleStages() {
  return [
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $match: {
        'user.accountStatus': { $ne: 'archived' },
        'user.reputationTier': { $ne: 'restricted' },
      },
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAggregate.mockImplementation(async (pipeline: Record<string, unknown>[]) => {
    const hasCount = pipeline.some((stage) => '$count' in stage);
    if (hasCount) {
      return [{ total: 1 }];
    }
    return [
      {
        total: 500,
        trustTier: 'trusted',
        userId: {
          _id: ACTIVE_USER_ID,
          username: 'trusted_user',
          name: { displayName: 'Trusted User' },
          avatar: 'avatar1',
          publicKey: 'pk1',
        },
      },
    ];
  });
});

describe('reputationService.getLeaderboard', () => {
  it('joins users and excludes archived/restricted accounts', async () => {
    const { items, total } = await reputationService.getLeaderboard(10, 0);

    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]?.userId).toMatchObject({
      _id: ACTIVE_USER_ID,
      username: 'trusted_user',
    });

    const listPipeline = mockAggregate.mock.calls[0]?.[0] as Record<string, unknown>[];
    expect(listPipeline.slice(0, 3)).toEqual(eligibleStages());
    expect(listPipeline).toEqual(
      expect.arrayContaining([
        { $sort: { total: -1 } },
        { $skip: 0 },
        { $limit: 10 },
      ]),
    );

    const countPipeline = mockAggregate.mock.calls[1]?.[0] as Record<string, unknown>[];
    expect(countPipeline.slice(0, 3)).toEqual(eligibleStages());
    expect(countPipeline).toEqual(expect.arrayContaining([{ $count: 'total' }]));
  });

  it('returns an empty leaderboard when no eligible users match', async () => {
    mockAggregate.mockResolvedValue([]);

    const { items, total } = await reputationService.getLeaderboard(10, 0);

    expect(items).toEqual([]);
    expect(total).toBe(0);
  });
});
