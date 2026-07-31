const mockFindOneAndUpdate = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockInvalidate = jest.fn();
const mockBillingFindOne = jest.fn();
const mockFindCurrentSubscription = jest.fn();
const mockStripeSubscriptionsUpdate = jest.fn();

jest.mock('../../models/BillingSubscription', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockBillingFindOne(...args),
  },
}));

jest.mock('../../models/Subscription', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
  },
}));

// The "which row represents this user's standing" decision (and its lazy expiry)
// belongs to the lifecycle service and is covered by its own suite.
jest.mock('../../services/subscriptionLifecycle.service', () => ({
  __esModule: true,
  findCurrentSubscription: (...args: unknown[]) => mockFindCurrentSubscription(...args),
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

jest.mock('../../utils/stripeClient', () => ({
  getStripe: () => ({
    subscriptions: {
      update: (...args: unknown[]) => mockStripeSubscriptionsUpdate(...args),
    },
  }),
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
    mockFindCurrentSubscription.mockResolvedValue(null);

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

  it('reads the legacy row through the lifecycle service so history cannot masquerade as current', async () => {
    mockBillingFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockFindCurrentSubscription.mockResolvedValue(null);

    const json = jest.fn();
    const req = {
      params: { userId: 'user-1' },
      user: { _id: { toString: () => 'user-1' } },
    } as unknown as AuthRequest;
    const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;

    await getSubscription(req, res);

    expect(mockFindCurrentSubscription).toHaveBeenCalledWith('user-1');
    expect(json).toHaveBeenCalledWith({ plan: 'basic' });
  });
});

describe('cancelSubscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByIdAndUpdate.mockResolvedValue({});
  });

  it('cancels an active Stripe billing subscription at period end', async () => {
    const billingSubscription = {
      userId: 'user-1',
      status: 'active',
      stripeSubscriptionId: 'sub_123',
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
      plan: { name: 'pro' },
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockBillingFindOne.mockResolvedValue(billingSubscription);
    mockFindOneAndUpdate.mockResolvedValue(null);
    mockStripeSubscriptionsUpdate.mockResolvedValue({});

    const json = jest.fn();
    const req = {
      params: { userId: 'user-1' },
      user: { _id: { toString: () => 'user-1' } },
    } as unknown as AuthRequest;
    const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;

    await cancelSubscription(req, res);

    expect(mockStripeSubscriptionsUpdate).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: true,
    });
    expect(billingSubscription.cancelAtPeriodEnd).toBe(true);
    expect(billingSubscription.save).toHaveBeenCalled();
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('user-1', {
      $set: { 'privacySettings.analyticsSharing': false },
    });
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      plan: 'pro',
      status: 'active',
      autoRenew: false,
    }));
  });

  it('cancels a legacy-only subscription and revokes analytics sharing', async () => {
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    mockBillingFindOne.mockResolvedValue(null);
    mockFindOneAndUpdate.mockResolvedValue({
      userId: 'user-1',
      status: 'canceled',
      plan: 'pro',
      endDate,
      toJSON: () => ({
        userId: 'user-1',
        status: 'canceled',
        plan: 'pro',
        endDate,
      }),
    });

    const json = jest.fn();
    const req = {
      params: { userId: 'user-1' },
      user: { _id: { toString: () => 'user-1' } },
    } as unknown as AuthRequest;
    const res = { json, status: jest.fn().mockReturnThis() } as unknown as Response;

    await cancelSubscription(req, res);

    expect(mockStripeSubscriptionsUpdate).not.toHaveBeenCalled();
    // Only an IN-FORCE row can be cancelled: a row that already lapsed is
    // history, and rewriting it to `canceled` would falsify why it ended.
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'user-1', status: { $ne: 'canceled' }, endDate: { $gt: expect.any(Date) } },
      { status: 'canceled' },
      { new: true, sort: { endDate: -1 } },
    );
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith('user-1', {
      $set: { 'privacySettings.analyticsSharing': false },
    });
    expect(mockInvalidate).toHaveBeenCalledWith('user-1');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      plan: 'pro',
      status: 'canceled',
    }));
  });

  it('returns 404 when no billing or legacy subscription exists', async () => {
    mockBillingFindOne.mockResolvedValue(null);
    mockFindOneAndUpdate.mockResolvedValue(null);

    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const req = {
      params: { userId: 'user-1' },
      user: { _id: { toString: () => 'user-1' } },
    } as unknown as AuthRequest;
    const res = { json, status } as unknown as Response;

    await cancelSubscription(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ message: 'Subscription not found' });
  });
});
