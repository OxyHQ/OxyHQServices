jest.mock('../../models/BillingSubscription', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

jest.mock('../../models/Subscription', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

import BillingSubscription from '../../models/BillingSubscription';
import Subscription from '../../models/Subscription';
import {
  isPremiumSubscriptionPlan,
  resolveUserSubscriptionPlan,
} from '../subscriptionPlan';
import { inForceSubscriptionFilter } from '../subscriptionStatus';

const mockBillingSubscription = BillingSubscription as jest.Mocked<typeof BillingSubscription>;
const mockSubscription = Subscription as jest.Mocked<typeof Subscription>;

describe('resolveUserSubscriptionPlan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns pro when BillingSubscription has an active Pro plan', async () => {
    (mockBillingSubscription.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ plan: { name: 'Pro' } }),
      }),
    });

    await expect(resolveUserSubscriptionPlan('user-1')).resolves.toBe('pro');
    expect(mockSubscription.findOne).not.toHaveBeenCalled();
  });

  it('falls back to legacy Subscription when billing has no active row', async () => {
    (mockBillingSubscription.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    (mockSubscription.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ plan: 'business' }),
      }),
    });

    await expect(resolveUserSubscriptionPlan('user-1')).resolves.toBe('business');
  });

  it('asks for rows that are in force by DATE, never for a stored active status', async () => {
    // A lapsed row keeps `status: 'active'` until the lifecycle sweep reconciles
    // it. Querying on that stored value is what would hand a premium entitlement
    // to a subscription whose period has already ended.
    const now = new Date('2026-07-31T12:00:00.000Z');
    (mockBillingSubscription.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    (mockSubscription.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    await resolveUserSubscriptionPlan('user-1', now);

    expect(mockSubscription.findOne).toHaveBeenCalledWith({
      userId: 'user-1',
      ...inForceSubscriptionFilter(now),
      plan: { $in: ['pro', 'business'] },
    });
  });

  it('returns basic when neither billing nor legacy has a premium plan', async () => {
    (mockBillingSubscription.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    (mockSubscription.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    await expect(resolveUserSubscriptionPlan('user-1')).resolves.toBe('basic');
  });
});

describe('isPremiumSubscriptionPlan', () => {
  it('treats pro and business as premium', () => {
    expect(isPremiumSubscriptionPlan('pro')).toBe(true);
    expect(isPremiumSubscriptionPlan('business')).toBe(true);
    expect(isPremiumSubscriptionPlan('basic')).toBe(false);
  });
});
