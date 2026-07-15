/**
 * Managed/org (keyless, publicKey-less) account profile serialization.
 *
 * Regression for the PUT /users/me 500 ("User must have a publicKey or _id")
 * when editing a managed/org account while switched (X-Acting-As). The User
 * schema's toObject transform deletes `_id` and folds the identifier into `id`;
 * a keyless account has no `publicKey`, so the object reaching the server-side
 * `formatUserResponse` serializer must still be identifiable.
 *
 * Asserts:
 *  - updateUserProfile re-attaches `_id` to its returned object so a keyless
 *    account serializes,
 *  - formatUserResponse identifies a keyless account from `_id`,
 *  - formatUserResponse also tolerates an already-transformed object that only
 *    carries `id` (defensive — no publicKey, no _id).
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

const mockUser = User as jest.Mocked<typeof User>;

describe('UserService.formatUserResponse — keyless accounts', () => {
  it('identifies a keyless (publicKey-less) account from _id', () => {
    const _id = new Types.ObjectId();
    const dto = userService.formatUserResponse({
      _id,
      username: 'acme-org',
      name: { first: 'Acme', last: 'Org' },
    } as never);
    expect(dto.id).toBe(_id.toString());
    expect(dto.username).toBe('acme-org');
  });

  it('tolerates an already-transformed object that only carries `id`', () => {
    // The toObject transform deletes `_id` and sets `id`; a keyless account then
    // has neither publicKey nor _id — only `id`.
    const dto = userService.formatUserResponse({
      id: '6a2f9d8989b795cfdfac350f',
      username: 'acme-org',
      name: { first: 'Acme' },
    } as never);
    expect(dto.id).toBe('6a2f9d8989b795cfdfac350f');
  });
});

describe('UserService.formatUserResponse — key-anchored accounts (with publicKey)', () => {
  it('serializes id as the stable _id, NOT the publicKey', () => {
    // Regression: once a self-custody user links a Commons identity (gains a
    // `publicKey`), the public DTO `id` used to flip from the Mongo `_id` to the
    // publicKey. The whole social graph (Mention `Post.oxyUserId === _id`, follow
    // edges, client follow-state maps) is keyed on the ObjectId, so a publicKey
    // `id` made author-feed/follow lookups miss and the user's posts vanished.
    // The DTO `id` MUST stay the ObjectId; key identity is exposed separately.
    const _id = new Types.ObjectId();
    const publicKey = '048295c4a1b2c3d4e5f6a7b8c9d0e1f2';
    const dto = userService.formatUserResponse({
      _id,
      publicKey,
      username: 'nate',
      name: { first: 'Nate' },
    } as never);
    expect(dto.id).toBe(_id.toString());
    expect(dto.id).not.toBe(publicKey);
  });
});

describe('UserService.updateUserProfile — keyless account return shape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('re-attaches _id (stripped by the schema transform) so the result serializes', async () => {
    const _id = new Types.ObjectId();
    const set = jest.fn();
    const save = jest.fn().mockResolvedValue(undefined);
    // Simulate the REAL schema transform: `_id` removed, identifier folded to `id`.
    const toObject = jest.fn().mockReturnValue({
      id: _id.toString(),
      username: 'acme-org',
      name: { first: 'Acme', last: 'Org' },
    });

    (mockUser.findById as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnValue({ _id, email: undefined, set, save, toObject }),
    });

    const result = await userService.updateUserProfile(_id.toString(), {
      name: { first: 'Acme', last: 'Org' },
    });

    // _id re-attached → server-side serializer can identify the account.
    expect(result._id).toBe(_id);
    const dto = userService.formatUserResponse(result);
    expect(dto.id).toBe(_id.toString());
  });
});
