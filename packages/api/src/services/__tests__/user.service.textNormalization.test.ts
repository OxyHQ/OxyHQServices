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
import { INVALID_USERNAME_MESSAGE } from '../../utils/username';

const mockUser = User as jest.Mocked<typeof User>;

/**
 * The reported bug, at the profile write path: a remote page served its `<title>`
 * across indented source lines, so the string carried a real newline plus six
 * spaces of indentation.
 */
const INDENTED_REMOTE_TITLE = '\n      Mi título\n    ';

/**
 * Stand in for the Mongoose document `updateUserProfile` loads and saves. `set`
 * is the assertion surface: it receives exactly what will be persisted.
 */
function mockUserDocument(overrides: Record<string, unknown> = {}) {
  const set = jest.fn();
  const save = jest.fn().mockResolvedValue(undefined);
  const toObject = jest.fn().mockReturnValue({ _id: 'user-1' });
  const doc = {
    _id: 'user-1',
    username: 'alice',
    email: 'user@example.com',
    set,
    save,
    toObject,
    ...overrides,
  };
  (mockUser.findById as jest.Mock).mockReturnValueOnce({
    select: jest.fn().mockReturnValue(doc),
  });
  return { set, save };
}

describe('UserService.updateUserProfile text normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('collapses a run of spaces in the NATIVE display name (was stored verbatim)', async () => {
    const { set, save } = mockUserDocument();

    await userService.updateUserProfile('user-1', {
      name: { first: `Ana${' '.repeat(20)}`, last: 'Gómez' },
    });

    expect(set).toHaveBeenCalledWith('name', { first: 'Ana', last: 'Gómez' });
    expect(save).toHaveBeenCalled();
  });

  it('normalizes an indented multi-line remote title in linksMetadata', async () => {
    const { set } = mockUserDocument();

    await userService.updateUserProfile('user-1', {
      linksMetadata: [
        {
          url: 'https://example.com',
          title: INDENTED_REMOTE_TITLE,
          description: 'Una   descripción\ncon salto',
        },
      ],
    });

    expect(set).toHaveBeenCalledWith('linksMetadata', [
      {
        url: 'https://example.com',
        title: 'Mi título',
        description: 'Una descripción con salto',
      },
    ]);
  });

  it('normalizes the place name and address of a location', async () => {
    const { set } = mockUserDocument();

    await userService.updateUserProfile('user-1', {
      locations: [
        {
          id: 'loc-1',
          name: '  Plaça   de Catalunya ',
          label: 'Home\noffice',
          address: { formattedAddress: 'Plaça de Catalunya,\n  Barcelona' },
        },
      ],
    });

    expect(set).toHaveBeenCalledWith('locations', [
      {
        id: 'loc-1',
        name: 'Plaça de Catalunya',
        label: 'Home office',
        address: { formattedAddress: 'Plaça de Catalunya, Barcelona' },
      },
    ]);
  });

  it('trims profile links and drops empty entries', async () => {
    const { set } = mockUserDocument();

    await userService.updateUserProfile('user-1', {
      links: [' https://example.com ', '   '],
    });

    expect(set).toHaveBeenCalledWith('links', ['https://example.com']);
  });

  it('strips the trailing whitespace of a bio line so blank lines collapse', async () => {
    const { set } = mockUserDocument();

    await userService.updateUserProfile('user-1', {
      bio: 'Primera línea\n   \n   \nSegunda línea',
    });

    expect(set).toHaveBeenCalledWith('bio', 'Primera línea\n\nSegunda línea');
  });

  describe('username policy', () => {
    it('rejects a username with interior whitespace', async () => {
      mockUserDocument();

      await expect(
        userService.updateUserProfile('user-1', { username: 'al ice' })
      ).rejects.toMatchObject({ statusCode: 400, message: INVALID_USERNAME_MESSAGE });
    });

    it('rejects a username with punctuation', async () => {
      mockUserDocument();

      await expect(
        userService.updateUserProfile('user-1', { username: 'al.ice' })
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it('accepts a clean username change and stores it trimmed', async () => {
      const { set } = mockUserDocument();

      await userService.updateUserProfile('user-1', { username: '  bob99 ' });

      expect(set).toHaveBeenCalledWith('username', 'bob99');
    });

    it('does not re-validate an unchanged legacy username echoed back by the client', async () => {
      // A client that PUTs the whole profile sends the stored username back. A
      // value that predates the policy must not make an unrelated bio edit fail.
      const { set, save } = mockUserDocument({ username: 'legacy.user' });

      await userService.updateUserProfile('user-1', {
        username: 'legacy.user',
        bio: 'Hola',
      });

      expect(set).toHaveBeenCalledWith('username', 'legacy.user');
      expect(save).toHaveBeenCalled();
    });
  });
});
