/**
 * Scoped Inbox email push delivery tests.
 *
 * The subject here is the SCOPING — that a new-mail push reaches the Inbox
 * app's installs and nothing else — so `resolveApplicationIdFromClientId` is
 * mocked at its own boundary rather than through the two Mongoose models it used
 * to reach. It no longer touches either: it is one join over `application_credentials`
 * and `applications`, and its contract (including the uuid-v7 application id
 * that made the Mongoose version THROW instead of returning null) is held
 * against a real Postgres by `utils/__tests__/resolveApplicationFromClientId.test.ts`.
 *
 * `PushToken` is still the Mongoose model — that half is not ported yet.
 */

const mockPushTokenFind = jest.fn();
const mockSendPushToTokens = jest.fn();
const mockResolveApplicationId = jest.fn();

jest.mock('../../models/PushToken', () => ({
  __esModule: true,
  PushToken: { find: mockPushTokenFind },
}));

jest.mock('../../utils/resolveApplicationFromClientId', () => ({
  __esModule: true,
  resolveApplicationIdFromClientId: (...args: unknown[]) => mockResolveApplicationId(...args),
}));

jest.mock('../push.service', () => ({
  pushService: { sendPushToTokens: mockSendPushToTokens },
}));

import { sendInboxEmailPush } from '../emailPushDelivery.service';
import { INBOX_EMAIL_PUSH_CHANNEL, INBOX_EMAIL_PUSH_TYPE } from '@oxyhq/contracts';

function findChain(rows: { token: string }[]) {
  return { select: () => ({ lean: () => Promise.resolve(rows) }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendPushToTokens.mockResolvedValue({ targeted: 1, accepted: 1 });
  mockResolveApplicationId.mockResolvedValue('app-inbox');
});

describe('sendInboxEmailPush', () => {
  it('delivers only to Inbox-scoped push tokens', async () => {
    mockPushTokenFind.mockReturnValue(findChain([{ token: 'ExponentPushToken[inbox]' }]));

    await sendInboxEmailPush({
      userId: 'user-1',
      title: 'Ada Lovelace',
      body: 'Analytical Engine notes',
      messageId: 'msg-1',
      mailboxId: 'mbox-1',
    });

    expect(mockPushTokenFind).toHaveBeenCalledWith({
      userId: 'user-1',
      applicationId: 'app-inbox',
    });
    expect(mockSendPushToTokens).toHaveBeenCalledWith({
      userId: 'user-1',
      tokens: ['ExponentPushToken[inbox]'],
      title: 'Ada Lovelace',
      body: 'Analytical Engine notes',
      channelId: INBOX_EMAIL_PUSH_CHANNEL,
      data: {
        type: INBOX_EMAIL_PUSH_TYPE,
        messageId: 'msg-1',
        mailboxId: 'mbox-1',
      },
    });
  });

  it('sends nothing when the user has no Inbox installs', async () => {
    mockPushTokenFind.mockReturnValue(findChain([]));

    await sendInboxEmailPush({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      messageId: 'msg-1',
      mailboxId: 'mbox-1',
    });

    expect(mockSendPushToTokens).not.toHaveBeenCalled();
  });

  it('sends nothing when the Inbox application cannot be resolved', async () => {
    mockResolveApplicationId.mockResolvedValue(null);

    await sendInboxEmailPush({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      messageId: 'msg-1',
      mailboxId: 'mbox-1',
    });

    expect(mockPushTokenFind).not.toHaveBeenCalled();
    expect(mockSendPushToTokens).not.toHaveBeenCalled();
  });

  it('never throws when the push transport fails', async () => {
    mockPushTokenFind.mockReturnValue(findChain([{ token: 'tok-a' }]));
    mockSendPushToTokens.mockRejectedValue(new Error('network down'));

    await expect(
      sendInboxEmailPush({
        userId: 'user-1',
        title: 'T',
        body: 'B',
        messageId: 'msg-1',
        mailboxId: 'mbox-1',
      }),
    ).resolves.toBeUndefined();
  });
});
