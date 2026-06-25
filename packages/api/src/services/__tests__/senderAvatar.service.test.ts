jest.mock('../../models/SenderAvatar', () => ({
  SenderAvatar: {
    findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
    find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
    updateOne: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })) })),
  },
}));

jest.mock('dns/promises', () => ({
  resolveTxt: jest.fn().mockRejectedValue(new Error('no bimi')),
}));

import { getAvatarPath } from '../senderAvatar.service';

describe('senderAvatar.service', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({ ok: false, headers: { get: jest.fn() } });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does not fetch sender-controlled favicon hosts from the API server', async () => {
    const avatarPath = await getAvatarPath('sender@example.com');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('https://www.gravatar.com/avatar/');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('example.com/favicon.ico'))).toBe(false);
    expect(avatarPath).toBe(`/email/proxy?url=${Buffer.from('https://example.com/favicon.ico').toString('base64')}`);
  });

  it('rejects localhost and private IP domains for favicon fallback', async () => {
    await expect(getAvatarPath('attacker@localhost')).resolves.toBeNull();
    await expect(getAvatarPath('attacker@127.0.0.1')).resolves.toBeNull();
    await expect(getAvatarPath('attacker@10.0.0.5')).resolves.toBeNull();

    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('www.gravatar.com'))).toBe(true);
  });
});
