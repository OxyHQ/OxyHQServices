jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock('../../models/Subscription', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
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
import Subscription from '../../models/Subscription';
import { userService } from '../user.service';

const mockUser = User as jest.Mocked<typeof User>;
const mockSubscription = Subscription as jest.Mocked<typeof Subscription>;

describe('UserService.updateUserProfile color authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['oxy', 'OXY', 'OxY', ' oxy '])(
    'requires premium access before saving normalized oxy color variant %p',
    async (color) => {
      (mockUser.findById as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ username: 'regular-user' }),
        }),
      });
      (mockSubscription.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(userService.updateUserProfile('user-1', { color })).rejects.toThrow(
        'The oxy color is exclusive to premium subscribers'
      );

      expect(mockSubscription.findOne).toHaveBeenCalledWith({
        userId: 'user-1',
        status: 'active',
        plan: { $in: ['pro', 'business'] },
      });
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
    expect(mockSubscription.findOne).not.toHaveBeenCalled();
  });
});
