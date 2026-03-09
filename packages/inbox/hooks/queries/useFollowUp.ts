/**
 * Hook to identify sent emails that may need follow-up.
 *
 * Cross-references sent messages with inbox messages to exclude
 * threads that already have replies. No separate API call needed —
 * uses the already-cached inbox messages.
 */

import { useMemo } from 'react';
import { useMessages } from '@/hooks/queries/useMessages';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { SPECIAL_USE } from '@/constants/mailbox';
import type { Message } from '@/services/emailApi';
import type { Commitment } from './useCommitmentDetection';

// Re-export commitment detection for use with follow-up messages
export { useCommitmentReminders } from './useCommitmentDetection';
export type { Commitment };

export interface FollowUpMessage extends Message {
  commitments?: Commitment[];
}

interface UseFollowUpResult {
  messages: FollowUpMessage[];
  count: number;
  isLoading: boolean;
}

// Days without reply to consider for follow-up
const FOLLOW_UP_DAYS = 3;

/**
 * @param inboxMessages — already-cached inbox messages used to detect replies (avoids extra API call)
 * @param limit — max number of follow-up candidates to return
 */
export function useFollowUp(inboxMessages: Message[] | undefined, limit = 5): UseFollowUpResult {
  const { data: mailboxes = [] } = useMailboxes();
  const sentMailboxId = useMemo(
    () => mailboxes.find(m => m.specialUse === SPECIAL_USE.SENT)?._id,
    [mailboxes]
  );

  const { data, isLoading } = useMessages(
    sentMailboxId ? { mailboxId: sentMailboxId } : {},
  );

  const result = useMemo(() => {
    if (!data || isLoading) {
      return { messages: [], count: 0 };
    }

    const allSentMessages = data.pages.flatMap(p => p.data);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - FOLLOW_UP_DAYS);

    // Build a set of messageIds that have been replied to (inbox messages referencing sent messageIds)
    const repliedMessageIds = new Set<string>();
    if (inboxMessages) {
      for (const msg of inboxMessages) {
        if (msg.inReplyTo) {
          repliedMessageIds.add(msg.inReplyTo);
        }
        if (msg.references) {
          for (const ref of msg.references) {
            repliedMessageIds.add(ref);
          }
        }
      }
    }

    const needsFollowUp = allSentMessages.filter(msg => {
      const msgDate = new Date(msg.date);

      // Must be older than cutoff
      if (msgDate > cutoff) return false;

      // Skip if sent to no-reply addresses
      const toAddresses = msg.to.map(a => a.address.toLowerCase()).join(' ');
      if (/noreply|no-reply|donotreply/.test(toAddresses)) return false;

      // Skip automated/marketing recipients
      if (/newsletter|support|info@|sales@|team@/.test(toAddresses)) return false;

      // Skip if there's already a reply in the inbox referencing this message
      if (msg.messageId && repliedMessageIds.has(msg.messageId)) return false;

      return true;
    });

    // Sort by date descending (most recent first)
    const sorted = [...needsFollowUp].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return {
      messages: sorted.slice(0, limit),
      count: sorted.length,
    };
  }, [data, isLoading, limit, inboxMessages]);

  return {
    ...result,
    isLoading,
  };
}
