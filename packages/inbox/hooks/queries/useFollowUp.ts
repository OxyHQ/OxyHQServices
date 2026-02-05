/**
 * Hook to identify sent emails that may need follow-up.
 *
 * Tracks emails you sent that haven't received a reply after a certain period.
 */

import { useMemo } from 'react';
import { useMessages } from '@/hooks/queries/useMessages';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { SPECIAL_USE } from '@/constants/mailbox';
import type { Message } from '@/services/emailApi';

interface UseFollowUpResult {
  messages: Message[];
  count: number;
  isLoading: boolean;
}

// Days without reply to consider for follow-up
const FOLLOW_UP_DAYS = 3;

export function useFollowUp(limit = 5): UseFollowUpResult {
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

    // Filter messages that are:
    // 1. Older than FOLLOW_UP_DAYS
    // 2. Not part of a thread with a reply (simplified - check references)
    // 3. Not to no-reply addresses
    const needsFollowUp = allSentMessages.filter(msg => {
      const msgDate = new Date(msg.date);

      // Must be older than cutoff
      if (msgDate > cutoff) return false;

      // Skip if sent to no-reply addresses
      const toAddresses = msg.to.map(a => a.address.toLowerCase()).join(' ');
      if (/noreply|no-reply|donotreply/.test(toAddresses)) return false;

      // Skip automated/marketing recipients
      if (/newsletter|support|info@|sales@|team@/.test(toAddresses)) return false;

      // Note: Ideally we'd check if there's a reply in the inbox,
      // but that requires cross-referencing threads
      // For now, just surface old sent emails as candidates
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
  }, [data, isLoading, limit]);

  return {
    ...result,
    isLoading,
  };
}
