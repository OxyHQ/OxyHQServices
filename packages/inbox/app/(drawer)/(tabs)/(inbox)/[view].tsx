/**
 * Dynamic route for mailbox views.
 *
 * Handles: /inbox, /sent, /drafts, /trash, /spam, /archive, /starred
 * Also handles labels: /label/[name]
 *
 * Desktop: shows empty state (list is in layout)
 * Mobile: shows the inbox list
 */

import React, { useEffect } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { InboxList } from '@/components/InboxList';
import { MessageDetailEmpty } from '@/components/MessageDetailEmpty';
import { useEmailStore } from '@/hooks/useEmail';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useLabels } from '@/hooks/queries/useLabels';
import { SPECIAL_USE } from '@/constants/mailbox';

const VIEW_TO_SPECIAL_USE: Record<string, string> = {
  inbox: SPECIAL_USE.INBOX,
  sent: SPECIAL_USE.SENT,
  drafts: SPECIAL_USE.DRAFTS,
  trash: SPECIAL_USE.TRASH,
  spam: SPECIAL_USE.SPAM,
  archive: SPECIAL_USE.ARCHIVE,
};

export default function MailboxViewRoute() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const { view } = useLocalSearchParams<{ view: string }>();
  const { data: mailboxes = [] } = useMailboxes();
  const { data: labels = [] } = useLabels();

  const selectMailbox = useEmailStore((s) => s.selectMailbox);
  const selectStarred = useEmailStore((s) => s.selectStarred);
  const selectLabel = useEmailStore((s) => s.selectLabel);

  // Sync route to Zustand state
  useEffect(() => {
    if (!view || mailboxes.length === 0) return;

    const viewLower = view.toLowerCase();

    if (viewLower === 'starred') {
      selectStarred();
    } else if (viewLower.startsWith('label-')) {
      // Handle label routes: /label-work, /label-personal
      const labelName = view.slice(6); // Remove 'label-' prefix
      const label = labels.find((l) => l.name.toLowerCase() === labelName.toLowerCase());
      if (label) {
        selectLabel(label._id, label.name);
      }
    } else {
      const specialUse = VIEW_TO_SPECIAL_USE[viewLower];
      if (specialUse) {
        const mailbox = mailboxes.find((m) => m.specialUse === specialUse);
        if (mailbox) {
          selectMailbox(mailbox);
        }
      }
    }
  }, [view, mailboxes, labels, selectMailbox, selectStarred, selectLabel]);

  if (isDesktop) {
    return <MessageDetailEmpty />;
  }

  return <InboxList />;
}
