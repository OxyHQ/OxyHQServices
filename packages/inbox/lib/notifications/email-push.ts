/**
 * The UNTRUSTED new-mail push payload.
 *
 * The server sends a deliberately minimal notification:
 *
 *   { type: 'oxy_inbox_new_message', messageId, mailboxId }
 *
 * Tapping can only OPEN the conversation for `messageId`. Nothing from the
 * payload is rendered — the detail screen re-fetches the message server-side.
 */

import { INBOX_EMAIL_PUSH_TYPE } from '@oxyhq/contracts';

/**
 * Extract the message id from a notification's `content.data`.
 *
 * @returns The message id, or `null` when this is not a usable Inbox mail push.
 */
export function emailMessageIdFromPush(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null;
  }

  const { type, messageId } = data as { type?: unknown; messageId?: unknown };
  if (type !== INBOX_EMAIL_PUSH_TYPE || typeof messageId !== 'string' || messageId.length === 0) {
    return null;
  }

  return messageId;
}

const claimedEmailMessageIds = new Set<string>();

/** Claim a message id for navigation (dedupes cold-launch vs warm tap). */
export function claimEmailMessageId(messageId: string): boolean {
  if (claimedEmailMessageIds.has(messageId)) {
    return false;
  }
  claimedEmailMessageIds.add(messageId);
  return true;
}

/** Test-only reset for duplicate-claim specs. */
export function __resetClaimedEmailMessageIds(): void {
  claimedEmailMessageIds.clear();
}
