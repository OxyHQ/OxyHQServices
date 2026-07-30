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
