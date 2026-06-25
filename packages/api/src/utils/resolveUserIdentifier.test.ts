import { exactCaseInsensitiveUsernameRegex, resolveUserByIdentifier } from './resolveUserIdentifier';
import { User } from '../models/User';

jest.mock('../models/User', () => ({
  User: {
    findOne: jest.fn(),
    find: jest.fn(),
  },
}));

const mockedUser = User as jest.Mocked<typeof User>;

describe('resolveUserByIdentifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds an escaped, anchored, case-insensitive username regex', () => {
    const regex = exactCaseInsensitiveUsernameRegex('a.b+');

    expect(regex.test('A.B+')).toBe(true);
    expect(regex.test('xa.b+')).toBe(false);
    expect(regex.test('aZb+')).toBe(false);
  });

  it('resolves a username only when the case-insensitive match is unambiguous', async () => {
    const user = { _id: 'user-id', username: 'alice' };
    (mockedUser.find as jest.Mock).mockReturnValue({
      limit: jest.fn().mockResolvedValue([user]),
    });

    await expect(resolveUserByIdentifier('Alice')).resolves.toBe(user);
    expect(mockedUser.find).toHaveBeenCalledWith({ username: /^Alice$/i });
  });

  it('does not resolve ambiguous case-colliding usernames to an arbitrary account', async () => {
    (mockedUser.find as jest.Mock).mockReturnValue({
      limit: jest.fn().mockResolvedValue([
        { _id: 'victim-id', username: 'alice' },
        { _id: 'attacker-id', username: 'Alice' },
      ]),
    });

    await expect(resolveUserByIdentifier('alice')).resolves.toBeNull();
  });
});
