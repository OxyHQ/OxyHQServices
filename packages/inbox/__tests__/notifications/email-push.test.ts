import { INBOX_EMAIL_PUSH_TYPE } from '@oxyhq/contracts';

import {
  __resetClaimedEmailMessageIds,
  claimEmailMessageId,
  emailMessageIdFromPush,
} from '@/lib/notifications/email-push';

describe('emailMessageIdFromPush', () => {
  it('accepts a well-formed Inbox mail push payload', () => {
    expect(
      emailMessageIdFromPush({
        type: INBOX_EMAIL_PUSH_TYPE,
        messageId: 'msg-1',
        mailboxId: 'mbox-1',
      }),
    ).toBe('msg-1');
  });

  it('rejects payloads without the type discriminator', () => {
    expect(emailMessageIdFromPush({ messageId: 'msg-1', mailboxId: 'mbox-1' })).toBeNull();
  });

  it('rejects foreign or malformed payloads', () => {
    expect(emailMessageIdFromPush(null)).toBeNull();
    expect(emailMessageIdFromPush({ type: 'other', messageId: 'msg-1' })).toBeNull();
    expect(emailMessageIdFromPush({ type: INBOX_EMAIL_PUSH_TYPE, messageId: '' })).toBeNull();
  });
});

describe('claimEmailMessageId', () => {
  beforeEach(() => {
    __resetClaimedEmailMessageIds();
  });

  it('claims a message id once per session', () => {
    expect(claimEmailMessageId('msg-1')).toBe(true);
    expect(claimEmailMessageId('msg-1')).toBe(false);
  });
});
