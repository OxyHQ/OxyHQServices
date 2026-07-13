/**
 * `updateUserProfile` account-languages handling.
 *
 * Asserts the update path accepts a `languages` array, normalizes each entry to
 * its canonical BCP-47 locale (`@oxyhq/core` normalizeLocale), de-dupes, rejects
 * unsupported/bare/non-array input with a 400, persists the canonical array, and
 * ignores the removed singular `language` field.
 */

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: { findById: jest.fn(), findOne: jest.fn() },
}));

jest.mock('../../models/Subscription', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn() },
}));

jest.mock('../securityActivityService', () => ({
  __esModule: true,
  default: { logEmailChange: jest.fn(), logProfileUpdate: jest.fn() },
}));

import { Types } from 'mongoose';
import User from '../../models/User';
import { userService } from '../user.service';
import { BadRequestError } from '../../utils/error';

const mockUser = User as jest.Mocked<typeof User>;

interface MockDoc {
  _id: Types.ObjectId;
  email: undefined;
  set: jest.Mock;
  save: jest.Mock;
  toObject: jest.Mock;
}

function mockDocument(_id: Types.ObjectId): MockDoc {
  const doc: MockDoc = {
    _id,
    email: undefined,
    set: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    toObject: jest.fn().mockReturnValue({ id: _id.toString(), username: 'lang-user' }),
  };
  (mockUser.findById as jest.Mock).mockReturnValueOnce({
    select: jest.fn().mockReturnValue(doc),
  });
  return doc;
}

describe('UserService.updateUserProfile — account languages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts and persists a valid locales array', async () => {
    const _id = new Types.ObjectId();
    const doc = mockDocument(_id);

    await userService.updateUserProfile(_id.toString(), { languages: ['en-US', 'es-ES'] });

    expect(doc.set).toHaveBeenCalledWith('languages', ['en-US', 'es-ES']);
    expect(doc.save).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes case and de-dupes before persisting', async () => {
    const _id = new Types.ObjectId();
    const doc = mockDocument(_id);

    await userService.updateUserProfile(_id.toString(), {
      languages: ['EN-us', 'es-ES', 'es-es'],
    });

    expect(doc.set).toHaveBeenCalledWith('languages', ['en-US', 'es-ES']);
  });

  it('rejects a bare (region-less) language code with a 400', async () => {
    const _id = new Types.ObjectId();

    await expect(
      userService.updateUserProfile(_id.toString(), { languages: ['en'] }),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(mockUser.findById).not.toHaveBeenCalled();
  });

  it('rejects an unsupported locale with a 400 before writing', async () => {
    const _id = new Types.ObjectId();

    await expect(
      userService.updateUserProfile(_id.toString(), { languages: ['en-US', 'zz-ZZ'] }),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(mockUser.findById).not.toHaveBeenCalled();
  });

  it('rejects a non-array languages value with a 400', async () => {
    const _id = new Types.ObjectId();

    await expect(
      userService.updateUserProfile(_id.toString(), {
        languages: 'en-US' as unknown as string[],
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('ignores the removed singular `language` field', async () => {
    const _id = new Types.ObjectId();
    const doc = mockDocument(_id);

    await userService.updateUserProfile(_id.toString(), {
      language: 'es-ES',
    } as unknown as { languages?: string[] });

    // Neither the legacy field nor a derived array is written.
    expect(doc.set).not.toHaveBeenCalledWith('language', expect.anything());
    expect(doc.set).not.toHaveBeenCalledWith('languages', expect.anything());
  });
});
