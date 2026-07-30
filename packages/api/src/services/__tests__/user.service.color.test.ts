// The global jest.setup.cjs mocks `mongoose` wholesale, stripping `Schema.Types`.
// `user.service.ts` imports the real `Follow` model (not mocked here), whose
// schema references `Schema.Types.ObjectId` at module load — so restore the
// actual mongoose module. The User model IS mocked below.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock('../../utils/subscriptionPlan', () => ({
  __esModule: true,
  resolveUserSubscriptionPlan: jest.fn(),
  isPremiumSubscriptionPlan: jest.fn((plan: string) => plan === 'pro' || plan === 'business'),
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn() },
}));

jest.mock('../securityActivityService', () => ({
  __esModule: true,
  default: { logEmailChange: jest.fn(), logProfileUpdate: jest.fn() },
}));

import User from '../../models/User';
import {
  isPremiumSubscriptionPlan,
  resolveUserSubscriptionPlan,
} from '../../utils/subscriptionPlan';
import { userService } from '../user.service';

const mockUser = User as jest.Mocked<typeof User>;
const mockResolveUserSubscriptionPlan = resolveUserSubscriptionPlan as jest.MockedFunction<
  typeof resolveUserSubscriptionPlan
>;
const mockIsPremiumSubscriptionPlan = isPremiumSubscriptionPlan as jest.MockedFunction<
  typeof isPremiumSubscriptionPlan
>;

describe('UserService.updateUserProfile color authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPremiumSubscriptionPlan.mockImplementation(
      (plan) => plan === 'pro' || plan === 'business',
    );
  });

  it.each(['oxy', 'OXY', 'OxY', ' oxy '])(
    'requires premium access before saving normalized oxy color variant %p',
    async (color) => {
      (mockUser.findById as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ username: 'regular-user' }),
        }),
      });
      mockResolveUserSubscriptionPlan.mockResolvedValue('basic');

      await expect(userService.updateUserProfile('user-1', { color })).rejects.toThrow(
        'The oxy color is exclusive to premium subscribers'
      );

      expect(mockResolveUserSubscriptionPlan).toHaveBeenCalledWith('user-1');
      expect(mockUser.findById).toHaveBeenCalledTimes(1);
    }
  );

  it('persists non-premium color using the same normalization as the schema', async () => {
    const set = jest.fn();
    const save = jest.fn().mockResolvedValue(undefined);
    const toObject = jest.fn().mockReturnValue({ _id: 'user-1', color: 'blue' });

    (mockUser.findById as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnValue({ email: 'user@example.com', set, save, toObject }),
    });

    await userService.updateUserProfile('user-1', { color: ' Blue ' });

    expect(set).toHaveBeenCalledWith('color', 'blue');
    expect(save).toHaveBeenCalled();
    expect(mockResolveUserSubscriptionPlan).not.toHaveBeenCalled();
  });
});
