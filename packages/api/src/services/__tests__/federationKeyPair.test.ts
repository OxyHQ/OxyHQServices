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

import { getUserKeyPair } from '../federation.service';

describe('getUserKeyPair username normalization', () => {
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

  it('lowercases mixed-case usernames in the keyId lookup', async () => {
    await getUserKeyPair('Bob', 'mention.earth');

    expect(mockFindOne).toHaveBeenCalledWith({
      keyId: 'https://mention.earth/ap/users/bob#main-key',
    });
  });
});
