// The global jest.setup.cjs mocks `mongoose` wholesale, stripping `Schema.Types`.
// `user.service.ts` imports the real `Follow` model (not mocked here), whose
// schema references `Schema.Types.ObjectId` at module load — so restore the
// actual mongoose module. The User/Subscription models ARE mocked below.
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
import { userService } from '../user.service';
import { BadRequestError } from '../../utils/error';

const mockUser = User as jest.Mocked<typeof User>;

const INVALID_NAME_MESSAGE = 'Name may only contain letters, spaces and apostrophes.';

describe('UserService.updateUserProfile display-name policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    { name: { first: 'nixCraft 🐧' } },
    { name: { last: 'Laura :bongoCat:' } },
    { name: { first: 'Dabid ⁂', last: 'OK' } },
    { name: { first: 'Agent007' } },
  ])('rejects an invalid name %p with a 400 before any DB write', async (updates) => {
    await expect(userService.updateUserProfile('user-1', updates)).rejects.toMatchObject({
      statusCode: 400,
      message: INVALID_NAME_MESSAGE,
    });
    await expect(userService.updateUserProfile('user-1', updates)).rejects.toBeInstanceOf(
      BadRequestError
    );
    // Validation short-circuits before the document fetch.
    expect(mockUser.findById).not.toHaveBeenCalled();
  });

  it('persists a clean name unchanged (apostrophe is not escaped)', async () => {
    const set = jest.fn();
    const save = jest.fn().mockResolvedValue(undefined);
    const toObject = jest.fn().mockReturnValue({
      _id: 'user-1',
      name: { first: 'Renée', last: "O'Brien" },
    });

    (mockUser.findById as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnValue({ email: 'user@example.com', set, save, toObject }),
    });

    await userService.updateUserProfile('user-1', {
      name: { first: 'Renée', last: "O'Brien" },
    });

    expect(set).toHaveBeenCalledWith('name', { first: 'Renée', last: "O'Brien" });
    expect(save).toHaveBeenCalled();
  });
});
