/**
 * Scoped delivery of new-mail push notifications to Inbox installations only.
 *
 * Push tokens are registered per-application (`clientId` → `applicationId`), so
 * email delivery must target only the Inbox app's registrations — never every
 * push token the identity owns (which would leak mail alerts to Commons and any
 * other Oxy app on the same account).
 */

import { INBOX_EMAIL_PUSH_CHANNEL, INBOX_EMAIL_PUSH_TYPE } from '@oxyhq/contracts';
import { PushToken } from '../models/PushToken';
import { pushService } from './push.service';
import { resolveApplicationIdFromClientId } from '../utils/resolveApplicationFromClientId';
import { logger } from '../utils/logger';

/** Production Inbox `ApplicationCredential.publicKey` — overridable per env. */
const INBOX_CLIENT_ID =
  process.env.INBOX_CLIENT_ID ?? 'oxy_dk_19cf17069d097a6ebf17a622709a53d13692ee69487224e3';

export type InboxEmailPushPayload = {
  type: typeof INBOX_EMAIL_PUSH_TYPE;
  messageId: string;
  mailboxId: string;
};

async function resolveInboxPushTokens(userId: string): Promise<string[]> {
  const applicationId = await resolveApplicationIdFromClientId(INBOX_CLIENT_ID);
  if (!applicationId) {
    return [];
  }

  const installs = await PushToken.find({ userId, applicationId })
    .select('token')
    .lean<{ token: string }[]>();

  return installs.map((install) => install.token);
}

/**
 * Push a new-mail notification to the user's Inbox installations only.
 * Fire-and-forget — never throws.
 */
export async function sendInboxEmailPush(params: {
  userId: string;
  title: string;
  body: string;
  messageId: string;
  mailboxId: string;
}): Promise<void> {
  const { userId, title, body, messageId, mailboxId } = params;

  try {
    const tokens = await resolveInboxPushTokens(userId);
    if (tokens.length === 0) {
      return;
    }

    const data: InboxEmailPushPayload = {
      type: INBOX_EMAIL_PUSH_TYPE,
      messageId,
      mailboxId,
    };

    await pushService.sendPushToTokens({
      userId,
      tokens,
      title,
      body,
      channelId: INBOX_EMAIL_PUSH_CHANNEL,
      data,
    });
  } catch (err) {
    logger.warn('[EmailPush] Inbox push delivery failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
