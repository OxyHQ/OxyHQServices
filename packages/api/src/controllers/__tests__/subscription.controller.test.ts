const mockFindOneAndUpdate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockInvalidate = jest.fn();
const mockBillingFindOne = jest.fn();
const mockSubscriptionFindOne = jest.fn();

jest.mock('../../models/BillingSubscription', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockBillingFindOne(...args),
  },
}));

jest.mock('../../models/Subscription', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockSubscriptionFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
  },
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: (...args: unknown[]) => mockInvalidate(...args) },
}));

jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth';
import { cancelSubscription, getSubscription } from '../subscription.controller';

describe('getSubscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the billing subscription when Stripe billing is active', async () => {
    mockBillingFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        userId: 'user-1',
        status: 'active',
        currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
        cancelAtPeriodEnd: false,
        plan: { name: 'pro', creditsPerMonth: 1000, price: 1000, currency: 'usd' },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    });
    mockSubscriptionFindOne.mockResolvedValue(null);

    const json = jest.fn();
    const req = {
      params: { userId: 'user-1' },
      user: { _id: { toString: () => 'user-1' } },
    } as unknown as AuthRequest;
    const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;

    await getSubscription(req, res);

    expect(mockBillingFindOne).toHaveBeenCalledWith({
      userId: 'user-1',
      status: { $in: ['active', 'trialing'] },
    });
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      plan: 'pro',
      status: 'active',
      userId: 'user-1',
    }));
  });
});

describe('cancelSubscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('revokes analyticsSharing and busts user cache', async () => {
    const subscription = { userId: 'user-1', status: 'canceled' };
    mockFindOneAndUpdate.mockResolvedValue(subscription);
    mockFindByIdAndUpdate.mockResolvedValue({});

    const json = jest.fn();
    const req = {
      params: { userId: 'user-1' },
      user: { _id: { toString: () => 'user-1' } },
    } as unknown as AuthRequest;
    const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;

    await cancelSubscription(req, res);

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('user-1', {
      $set: { 'privacySettings.analyticsSharing': false },
    });
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
    expect(json).toHaveBeenCalledWith(subscription);
  });
});
