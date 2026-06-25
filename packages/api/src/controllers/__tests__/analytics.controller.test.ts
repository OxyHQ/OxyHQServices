const mockAnalyticsFind = jest.fn();
const mockAnalyticsAggregate = jest.fn();
const mockAnalyticsFindOneAndUpdate = jest.fn();
const mockUserFindById = jest.fn();
const mockUserAggregate = jest.fn();

jest.mock('../../models/Analytics', () => ({
  __esModule: true,
  default: {
    find: mockAnalyticsFind,
    aggregate: mockAnalyticsAggregate,
    findOneAndUpdate: mockAnalyticsFindOneAndUpdate,
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findById: mockUserFindById,
    aggregate: mockUserAggregate,
  },
}));

jest.mock('../utils/dateUtils', () => ({
  getDateRange: jest.fn(() => ({
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-01-31T00:00:00.000Z'),
  })),
}));

jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

import type { Response } from 'express';
import {
  getAnalytics,
  getContentViewers,
  getFollowerDetails,
  updateAnalytics,
} from '../analytics.controller';
import type { AuthRequest } from '../../middleware/auth';

describe('analytics.controller', () => {
  const authenticatedUserId = 'authenticated-user-id';
  const attackerSuppliedUserId = 'victim-user-id';
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  const makeRequest = (overrides: Partial<AuthRequest> = {}): AuthRequest => ({
    user: { _id: authenticatedUserId } as AuthRequest['user'],
    query: { userID: attackerSuppliedUserId, period: 'weekly' },
    body: { userID: attackerSuppliedUserId, type: 'profileViews', data: { 'stats.reach.impressions': 1 } },
    ...overrides,
  } as AuthRequest);

  it('reads analytics for the authenticated user, ignoring query userID', async () => {
    const sort = jest.fn().mockResolvedValue([]);
    mockAnalyticsFind.mockReturnValue({ sort });
    mockUserFindById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _count: { followers: 1 } }) });

    await getAnalytics(makeRequest(), res as Response);

    expect(mockAnalyticsFind).toHaveBeenCalledWith(expect.objectContaining({
      userID: authenticatedUserId,
      period: 'weekly',
    }));
    expect(mockUserFindById).toHaveBeenCalledWith(authenticatedUserId);
    expect(mockAnalyticsFind).not.toHaveBeenCalledWith(expect.objectContaining({ userID: attackerSuppliedUserId }));
  });

  it('updates analytics for the authenticated user, ignoring body userID', async () => {
    mockAnalyticsFindOneAndUpdate.mockResolvedValue({});

    await updateAnalytics(makeRequest(), res as Response);

    expect(mockAnalyticsFindOneAndUpdate).toHaveBeenCalledTimes(4);
    for (const call of mockAnalyticsFindOneAndUpdate.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ userID: authenticatedUserId }));
      expect(call[0]).not.toEqual(expect.objectContaining({ userID: attackerSuppliedUserId }));
    }
  });

  it('reads content viewers for the authenticated user, ignoring query userID', async () => {
    mockAnalyticsAggregate.mockResolvedValue([]);

    await getContentViewers(makeRequest(), res as Response);

    expect(mockAnalyticsAggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        $match: expect.objectContaining({ userID: authenticatedUserId }),
      }),
    ]));
  });

  it('reads follower details for the authenticated user, ignoring query userID', async () => {
    mockUserAggregate.mockResolvedValue([]);

    await getFollowerDetails(makeRequest(), res as Response);

    expect(mockUserAggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $match: { _id: authenticatedUserId } },
    ]));
  });

  it('rejects analytics access without an authenticated user id', async () => {
    await getAnalytics(makeRequest({ user: undefined }), res as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockAnalyticsFind).not.toHaveBeenCalled();
  });
});
