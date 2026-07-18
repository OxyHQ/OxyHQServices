const mockBlockFindOne = jest.fn();
const mockRestrictedFindOne = jest.fn();

jest.mock('../../models/Block', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockBlockFindOne(...args),
  },
}));

jest.mock('../../models/User', () => ({
  User: {
    findById: jest.fn(),
  },
}));

jest.mock('../../models/Restricted', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockRestrictedFindOne(...args),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
  },
}));

jest.mock('../../utils/blockCache', () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => null),
    set: jest.fn(),
  },
  restrictCache: {
    get: jest.fn(() => null),
    set: jest.fn(),
  },
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => null),
    set: jest.fn(),
  },
}));

const { MediaPrivacyService } = jest.requireActual('../mediaPrivacyService') as typeof import(
  '../mediaPrivacyService'
);

const createFile = (
  ownerUserId: string,
  visibility: 'public' | 'private' | 'unlisted' = 'public'
) => ({
  ownerUserId: { toString: () => ownerUserId },
  visibility,
});

describe('MediaPrivacyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBlockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockRestrictedFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
  });

  it('denies authenticated blocked viewers before allowing public files without context', async () => {
    const ownerId = '0123456789abcdef01234567';
    const viewerId = 'fedcba987654321001234567';
    mockBlockFindOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({ userId: ownerId, blockedId: viewerId }),
    });
    mockBlockFindOne.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) });

    const result = await new MediaPrivacyService().checkMediaAccess(
      createFile(ownerId),
      viewerId
    );

    expect(result).toEqual({ allowed: false, reason: 'blocked' });
    expect(mockBlockFindOne).toHaveBeenCalledTimes(2);
  });

  it('denies authenticated restricted viewers before allowing public files without context', async () => {
    const ownerId = '0123456789abcdef01234567';
    const viewerId = 'fedcba987654321001234567';
    mockRestrictedFindOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({ userId: ownerId, restrictedId: viewerId }),
    });

    const result = await new MediaPrivacyService().checkMediaAccess(
      createFile(ownerId),
      viewerId
    );

    expect(result).toEqual({ allowed: false, reason: 'restricted' });
    expect(mockRestrictedFindOne).toHaveBeenCalledWith({
      userId: ownerId,
      restrictedId: viewerId,
    });
    expect(mockBlockFindOne).toHaveBeenCalledTimes(2);
  });

  it('does not deny viewers the owner has not restricted (asymmetric)', async () => {
    const ownerId = '0123456789abcdef01234567';
    const viewerId = 'fedcba987654321001234567';

    const result = await new MediaPrivacyService().checkMediaAccess(
      createFile(ownerId),
      viewerId
    );

    expect(result).toEqual({ allowed: true, isPublic: true });
    expect(mockRestrictedFindOne).toHaveBeenCalledWith({
      userId: ownerId,
      restrictedId: viewerId,
    });
  });

  it('still allows unauthenticated public files without context without querying blocks', async () => {
    const result = await new MediaPrivacyService().checkMediaAccess(
      createFile('0123456789abcdef01234567')
    );

    expect(result).toEqual({ allowed: true, isPublic: true });
    expect(mockBlockFindOne).not.toHaveBeenCalled();
  });

  it('allows synthetic public owners after the ObjectId block guard skips invalid IDs', async () => {
    const result = await new MediaPrivacyService().checkMediaAccess(
      createFile('__federation__'),
      'fedcba987654321001234567'
    );

    expect(result).toEqual({ allowed: true, isPublic: true });
    expect(mockBlockFindOne).not.toHaveBeenCalled();
  });
});
