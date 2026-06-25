const mockResolveTxt = jest.fn();
const mockSenderAvatarFindOne = jest.fn();
const mockSenderAvatarUpdateOne = jest.fn();
const mockUserFindOne = jest.fn();

jest.mock('dns/promises', () => ({
  __esModule: true,
  default: { resolveTxt: (...args: unknown[]) => mockResolveTxt(...args) },
}));

jest.mock('../../models/SenderAvatar', () => ({
  SenderAvatar: {
    findOne: (...args: unknown[]) => mockSenderAvatarFindOne(...args),
    updateOne: (...args: unknown[]) => mockSenderAvatarUpdateOne(...args),
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: { findOne: (...args: unknown[]) => mockUserFindOne(...args) },
}));

import { getAvatarPath } from '../senderAvatar.service';

describe('senderAvatar.service', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    mockSenderAvatarFindOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    mockSenderAvatarUpdateOne.mockResolvedValue({ acknowledged: true });
    mockUserFindOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, headers: { get: jest.fn() } }) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('bounds BIMI DNS lookups so unresolved domains do not stall avatar resolution', async () => {
    jest.useFakeTimers();
    mockResolveTxt.mockReturnValue(new Promise(() => undefined));

    const avatarPromise = getAvatarPath('attacker@slow.example');

    await jest.advanceTimersByTimeAsync(1500);
    await expect(avatarPromise).resolves.toBeNull();

    expect(mockResolveTxt).toHaveBeenCalledWith('default._bimi.slow.example');
    expect(mockSenderAvatarUpdateOne).toHaveBeenCalledWith(
      { email: 'attacker@slow.example' },
      expect.objectContaining({ $set: expect.objectContaining({ avatarPath: null, source: 'none' }) }),
      { upsert: true },
    );
  });
});
