/**
 * Dynamic route for system mailbox views.
 *
 * Handles: /inbox, /sent, /drafts, /trash, /spam, /archive, /starred, /snoozed
 *
 * Labels live at `/label/<name>` and are owned by `label/[name].tsx` — they
 * are intentionally NOT handled here.
 *
 * Desktop: shows empty state (list is in layout)
 * Mobile: shows the inbox list
 */

import React, { useEffect, useMemo } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';

import { InboxList } from '@/components/InboxList';
import { MessageDetailEmpty } from '@/components/MessageDetailEmpty';
import { useEmailStore } from '@/hooks/useEmail';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useMessages } from '@/hooks/queries/useMessages';
import { SPECIAL_USE } from '@/constants/mailbox';
import { useTranslation } from '@/lib/i18n';

/** Map a `/[view]` segment to a `drawer.mailboxes.*` translation key. */
const VIEW_TO_LABEL_KEY: Record<string, string> = {
  inbox: 'drawer.mailboxes.Inbox',
  sent: 'drawer.mailboxes.Sent',
  drafts: 'drawer.mailboxes.Drafts',
  trash: 'drawer.mailboxes.Trash',
  spam: 'drawer.mailboxes.Spam',
  archive: 'drawer.mailboxes.Archive',
  snoozed: 'drawer.mailboxes.Snoozed',
  starred: 'drawer.mailboxes.Starred',
};

const VIEW_TO_SPECIAL_USE: Record<string, string> = {
  inbox: SPECIAL_USE.INBOX,
  sent: SPECIAL_USE.SENT,
  drafts: SPECIAL_USE.DRAFTS,
  trash: SPECIAL_USE.TRASH,
  spam: SPECIAL_USE.SPAM,
  archive: SPECIAL_USE.ARCHIVE,
  snoozed: SPECIAL_USE.SNOOZED,
};

export default function MailboxViewRoute() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const { view } = useLocalSearchParams<{ view: string }>();
  const { data: mailboxes = [] } = useMailboxes();
  const { t } = useTranslation();

  const selectMailbox = useEmailStore((s) => s.selectMailbox);
  const selectStarred = useEmailStore((s) => s.selectStarred);
  const currentMailbox = useEmailStore((s) => s.currentMailbox);

  const { data: messagesData } = useMessages({ mailboxId: currentMailbox?._id });

  const viewLabel = useMemo(() => {
    if (!view) return t('drawer.mailboxes.Inbox');
    const viewLower = view.toLowerCase();
    const labelKey = VIEW_TO_LABEL_KEY[viewLower];
    if (labelKey) return t(labelKey);
    return view.charAt(0).toUpperCase() + view.slice(1);
  }, [view, t]);

  const unreadCount = useMemo(() => {
    const messages = messagesData?.pages.flatMap((p) => p.data) ?? [];
    return messages.filter((m) => !m.flags?.seen).length;
  }, [messagesData]);

  const pageTitle = useMemo(() => {
    const suffix = t('app.titleSuffix');
    if (unreadCount > 0) return `(${unreadCount}) ${viewLabel} ${suffix}`;
    return `${viewLabel} ${suffix}`;
  }, [unreadCount, viewLabel, t]);

  // Sync route to Zustand state
  useEffect(() => {
    if (!view || mailboxes.length === 0) return;

    const viewLower = view.toLowerCase();

    if (viewLower === 'starred') {
      selectStarred();
      return;
    }

    const specialUse = VIEW_TO_SPECIAL_USE[viewLower];
    if (specialUse) {
      const mailbox = mailboxes.find((m) => m.specialUse === specialUse);
      if (mailbox) {
        selectMailbox(mailbox);
      }
    }
  }, [view, mailboxes, selectMailbox, selectStarred]);

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      {isDesktop ? <MessageDetailEmpty /> : <InboxList />}
    </>
  );
}
