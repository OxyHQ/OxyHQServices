/**
 * Scoped Inbox email push delivery tests.
 */

const mockPushTokenFind = jest.fn();
const mockSendPushToTokens = jest.fn();

jest.mock('../../models/PushToken', () => ({
  __esModule: true,
  PushToken: { find: mockPushTokenFind },
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: jest.fn() },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findById: jest.fn() },
}));

jest.mock('../push.service', () => ({
  pushService: { sendPushToTokens: mockSendPushToTokens },
}));

jest.mock('../../utils/credentialUsability', () => ({
  isCredentialUsable: jest.fn(() => true),
}));

import { ApplicationCredential } from '../../models/ApplicationCredential';
import { Application } from '../../models/Application';
import { sendInboxEmailPush } from '../emailPushDelivery.service';
import { INBOX_EMAIL_PUSH_CHANNEL, INBOX_EMAIL_PUSH_TYPE } from '@oxyhq/contracts';

const mockCredentialFindOne = ApplicationCredential.findOne as jest.Mock;
const mockApplicationFindById = Application.findById as jest.Mock;

function findChain(rows: { token: string }[]) {
  return { select: () => ({ lean: () => Promise.resolve(rows) }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendPushToTokens.mockResolvedValue({ targeted: 1, accepted: 1 });
  mockCredentialFindOne.mockResolvedValue({
    applicationId: 'app-inbox',
    status: 'active',
  });
  mockApplicationFindById.mockResolvedValue({ _id: 'app-inbox', status: 'active' });
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
    mockCredentialFindOne.mockResolvedValue(null);

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
