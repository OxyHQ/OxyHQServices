/**
 * Push service tests.
 *
 * Two things are pinned here:
 *
 *  1. **The email notification is byte-for-byte what it always was.** The
 *     hardcoded `channelId: 'email'` became a caller-supplied channel; the wire
 *     payload for the email caller must not have moved a single byte. The
 *     expected request body below is an exact string, not a shape.
 *  2. **The channel is caller-supplied and never defaulted**, and the explicit
 *     token-targeting entry point delivers to exactly the tokens it is given
 *     (used by identity-approval delivery, where the CALLER owns the targeting).
 *
 * Batching and `DeviceNotRegistered` pruning are exercised too — they must
 * survive the parameterisation.
 */

const mockPushTokenFind = jest.fn();
const mockPushTokenDeleteOne = jest.fn();

jest.mock('../../models/PushToken', () => ({
  __esModule: true,
  PushToken: { find: mockPushTokenFind, deleteOne: mockPushTokenDeleteOne },
  default: { find: mockPushTokenFind, deleteOne: mockPushTokenDeleteOne },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { pushService } from '../push.service';

/** `PushToken.find(...).select(...).lean()` chain. */
function findChain(rows: { token: string }[]) {
  return { select: () => ({ lean: () => Promise.resolve(rows) }) };
}

function okTickets(count: number) {
  return {
    ok: true,
    json: () => Promise.resolve({ data: Array.from({ length: count }, () => ({ status: 'ok' })) }),
  };
}

const originalFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockPushTokenDeleteOne.mockResolvedValue({ deletedCount: 1 });
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('pushService.sendPushNotification — email notification is unchanged', () => {
  it('sends the exact same wire payload the email caller always sent', async () => {
    mockPushTokenFind.mockReturnValue(findChain([{ token: 'ExponentPushToken[email-device]' }]));
    fetchMock.mockResolvedValue(okTickets(1));

    // Exactly what `email.service.ts` passes on an inbound non-spam message.
    await pushService.sendPushNotification({
      userId: 'user-1',
      title: 'Ada Lovelace',
      body: 'Analytical Engine notes',
      channelId: 'email',
      data: { messageId: 'msg-1', mailboxId: 'mbox-1' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    });

    // Byte-for-byte: same keys, same order, same values as before the change.
    expect(init.body).toBe(
      '[{"to":"ExponentPushToken[email-device]","title":"Ada Lovelace","body":"Analytical Engine notes",'
      + '"data":{"messageId":"msg-1","mailboxId":"mbox-1"},"sound":"default","channelId":"email"}]',
    );
  });

  it('targets every install of the user and reports accepted counts', async () => {
    mockPushTokenFind.mockReturnValue(findChain([{ token: 'tok-a' }, { token: 'tok-b' }]));
    fetchMock.mockResolvedValue(okTickets(2));

    const result = await pushService.sendPushNotification({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      channelId: 'email',
    });

    expect(mockPushTokenFind).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(result).toEqual({ targeted: 2, accepted: 2 });
  });

  it('does not call the push API when the user has no installs', async () => {
    mockPushTokenFind.mockReturnValue(findChain([]));

    const result = await pushService.sendPushNotification({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      channelId: 'email',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ targeted: 0, accepted: 0 });
  });
});

describe('pushService — caller-supplied channel', () => {
  it('uses the channel the caller passed, with no default of its own', async () => {
    fetchMock.mockResolvedValue(okTickets(1));

    await pushService.sendPushToTokens({
      userId: 'user-1',
      tokens: ['tok-a'],
      title: 'Sign-in request',
      body: 'Open Commons to review this request.',
      channelId: 'auth-approval',
      data: { type: 'oxy_commons_auth_request', approvalUrl: 'oxycommons://approve?v=1&code=abc' },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;

    expect(sent).toHaveLength(1);
    expect(sent[0].channelId).toBe('auth-approval');
    // No `categoryId` — an iOS category is what binds action buttons to a
    // notification, and an approval notification must never carry one.
    expect(Object.keys(sent[0]).sort()).toEqual(['body', 'channelId', 'data', 'sound', 'title', 'to']);
  });
});

describe('pushService.sendPushToTokens — explicit targeting', () => {
  it('delivers to exactly the tokens it was given (never a registry lookup)', async () => {
    fetchMock.mockResolvedValue(okTickets(2));

    const result = await pushService.sendPushToTokens({
      userId: 'user-1',
      tokens: ['tok-a', 'tok-b'],
      title: 'T',
      body: 'B',
      channelId: 'auth-approval',
    });

    expect(mockPushTokenFind).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as Array<{ to: string }>;
    expect(sent.map((m) => m.to)).toEqual(['tok-a', 'tok-b']);
    expect(result).toEqual({ targeted: 2, accepted: 2 });
  });

  it('does not throw and reports zero accepted when the transport fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(
      pushService.sendPushToTokens({
        userId: 'user-1',
        tokens: ['tok-a'],
        title: 'T',
        body: 'B',
        channelId: 'auth-approval',
      }),
    ).resolves.toEqual({ targeted: 1, accepted: 0 });
  });

  it('does not throw and reports zero accepted on a non-OK push API response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({}) });

    await expect(
      pushService.sendPushToTokens({
        userId: 'user-1',
        tokens: ['tok-a'],
        title: 'T',
        body: 'B',
        channelId: 'auth-approval',
      }),
    ).resolves.toEqual({ targeted: 1, accepted: 0 });
  });

  it('prunes DeviceNotRegistered tokens and still counts the accepted ones', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { status: 'ok' },
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
        ],
      }),
    });

    const result = await pushService.sendPushToTokens({
      userId: 'user-1',
      tokens: ['tok-live', 'tok-dead'],
      title: 'T',
      body: 'B',
      channelId: 'auth-approval',
    });

    expect(mockPushTokenDeleteOne).toHaveBeenCalledTimes(1);
    expect(mockPushTokenDeleteOne).toHaveBeenCalledWith({ userId: 'user-1', token: 'tok-dead' });
    expect(result).toEqual({ targeted: 2, accepted: 1 });
  });

  it('batches at 100 messages per request', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okTickets(100)));

    const tokens = Array.from({ length: 150 }, (_, i) => `tok-${i}`);
    await pushService.sendPushToTokens({
      userId: 'user-1',
      tokens,
      title: 'T',
      body: 'B',
      channelId: 'auth-approval',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as unknown[];
    const second = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as unknown[];
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(50);
  });
});
