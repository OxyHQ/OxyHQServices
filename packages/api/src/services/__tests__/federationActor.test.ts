const mockFindOne = jest.fn();
const mockCreate = jest.fn();

jest.mock('mongoose', () => {
  class Schema {
    virtual() {
      return { get: () => this };
    }
    index() {
      return this;
    }
    pre() {
      return this;
    }
  }
  return {
    __esModule: true,
    default: {
      Schema,
      models: {},
      model: jest.fn(() => ({
        findOne: mockFindOne,
        create: mockCreate,
      })),
    },
    Schema,
    models: {},
    model: jest.fn(() => ({
      findOne: mockFindOne,
      create: mockCreate,
    })),
  };
});

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findById: jest.fn() },
}));

jest.mock('../assetService', () => ({
  __esModule: true,
  AssetService: class {},
}));

jest.mock('../s3Service', () => ({
  createS3Service: jest.fn(),
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn() },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { getUserActor } from '../federation.service';

describe('getUserActor username normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        keyId: 'https://mention.earth/ap/users/bob#main-key',
        publicKeyPem: 'PUBLIC',
        privateKeyPem: 'PRIVATE',
      }),
    });
  });

  it('lowercases mixed-case usernames in actor id and publicKey.owner', async () => {
    const actor = await getUserActor(
      {
        username: 'Bob',
        name: { displayName: 'Bob Example' },
        bio: '',
        kind: 'personal',
      } as never,
      'mention.earth',
    );

    expect(actor).toMatchObject({
      id: 'https://mention.earth/ap/users/bob',
      preferredUsername: 'bob',
      publicKey: {
        id: 'https://mention.earth/ap/users/bob#main-key',
        owner: 'https://mention.earth/ap/users/bob',
      },
    });
  });
});
